import { NextRequest, NextResponse } from "next/server";
import { rejectUnauthorized } from "@/lib/api-auth";
import { db } from "@/lib/db";
import {
  apiCredentials,
  priceHistory,
  watchlists,
  indicatorData,
} from "@/lib/db/schema";
import { createDeltaClient } from "@/lib/delta-exchange";
import { decryptText } from "@/lib/encryption";
import {
  calculateIndicators,
  DEFAULT_RSI_PERIOD,
  FAST_EMA_PERIOD,
  SLOW_EMA_PERIOD,
} from "@/lib/indicators";
import { eq, desc, lte } from "drizzle-orm";

export const dynamic = "force-dynamic";

const CANDLE_INTERVAL_SECONDS = 3600;
const CANDLE_LIMIT = 50;
const RETENTION_DAYS = 365;

interface CollectionFailure {
  symbol: string;
  error: string;
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}

export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  try {
    const credentials = await db
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.isActive, true));

    if (credentials.length === 0) {
      return NextResponse.json({
        success: true,
        collected: 0,
        message: "No active API credentials configured",
      });
    }

    const allWatchlists = await db.select().from(watchlists);
    const symbols = new Set<string>(
      allWatchlists.flatMap((watchlist) => watchlist.symbols ?? []).filter(Boolean),
    );

    if (symbols.size === 0) {
      return NextResponse.json({
        success: true,
        collected: 0,
        message: "No symbols in watchlists",
      });
    }

    const credential = credentials[0];
    const deltaClient = createDeltaClient(
      decryptText(credential.encryptedApiKey),
      decryptText(credential.encryptedApiSecret),
    );

    const collectedSymbols: string[] = [];
    const failedSymbols: CollectionFailure[] = [];

    for (const symbol of symbols) {
      try {
        const collected = await collectSymbol(deltaClient, symbol);
        if (collected) collectedSymbols.push(symbol);
      } catch (error) {
        console.error(`[crypto-sentinel] Error collecting price for ${symbol}:`, error);
        failedSymbols.push({ symbol, error: String(error) });
      }
    }

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.delete(priceHistory).where(lte(priceHistory.timestamp, cutoff));

    return NextResponse.json({
      success: true,
      collected: collectedSymbols.length,
      symbols: collectedSymbols,
      failed: failedSymbols.length,
      failedSymbols,
    });
  } catch (error) {
    console.error("[crypto-sentinel] Price data collection error:", error);
    return NextResponse.json(
      { error: "Failed to collect price data", details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * Pulls candles for a single symbol, stores only the ones newer than what is
 * already on disk, and recomputes indicators over the full 50-candle window.
 * Returns false when the exchange had nothing new.
 */
async function collectSymbol(
  deltaClient: ReturnType<typeof createDeltaClient>,
  symbol: string,
): Promise<boolean> {
  const candles = await deltaClient.getCandles(
    symbol,
    CANDLE_INTERVAL_SECONDS,
    CANDLE_LIMIT,
  );

  if (!candles || candles.length === 0) return false;

  // Delta returns newest-first; indicators and history rows expect oldest-first.
  const ordered = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const latest = ordered[ordered.length - 1];

  const existing = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.symbol, symbol))
    .orderBy(desc(priceHistory.timestamp))
    .limit(1);

  const lastTimestamp = existing[0]?.timestamp ?? null;
  const fresh = lastTimestamp
    ? ordered.filter((candle) => candle.timestamp > lastTimestamp.getTime())
    : ordered;

  if (fresh.length === 0) return false;

  await db.insert(priceHistory).values(
    fresh.map((candle) => ({
      symbol,
      timestamp: new Date(candle.timestamp),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: BigInt(Math.floor(candle.volume)),
    })),
  );

  const indicators = calculateIndicators(ordered.map((candle) => candle.close));
  const timestamp = new Date(latest.timestamp);

  await db.insert(indicatorData).values([
    {
      symbol,
      indicatorType: "rsi",
      timestamp,
      value: indicators.rsi,
      metadata: { period: DEFAULT_RSI_PERIOD },
    },
    {
      symbol,
      indicatorType: "ema",
      timestamp,
      value: indicators.ema12,
      metadata: { period: FAST_EMA_PERIOD },
    },
    {
      symbol,
      indicatorType: "ema",
      timestamp,
      value: indicators.ema26,
      metadata: { period: SLOW_EMA_PERIOD },
    },
    {
      symbol,
      indicatorType: "macd",
      timestamp,
      value: indicators.macd.macd,
      metadata: {
        signal: indicators.macd.signal,
        histogram: indicators.macd.histogram,
      },
    },
  ]);

  return true;
}