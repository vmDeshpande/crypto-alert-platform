import { NextResponse } from "next/server";
import { db, pool } from "@/lib/db";
import {
  apiCredentials,
  priceHistory,
  indicatorData,
  alerts,
  notificationChannels,
  watchlists,
} from "@/lib/db/schema";
import { createDeltaClient } from "@/lib/delta-exchange";
import { decryptText } from "@/lib/encryption";
import { calculateIndicators, DEFAULT_RSI_PERIOD, FAST_EMA_PERIOD, SLOW_EMA_PERIOD } from "@/lib/indicators";
import { eq, desc } from "drizzle-orm";

/**
 * Multi-subsystem health check.
 *
 * Intentionally unauthenticated so uptime monitors can reach it without
 * credentials. No secrets are returned, but the response does reveal
 * configuration shape — restrict it to your monitoring network on a public
 * deployment. See docs/health-check.md.
 *
 * Returns 503 when a critical subsystem (database, deltaExchange) is unhealthy;
 * otherwise 200 with a `degraded` overall status.
 */

export const dynamic = "force-dynamic";

/** Price data older than this is reported as degraded. */
const STALE_PRICE_HOURS = 24;
/** Below this many candles the indicator check reports degraded instead of healthy. */
const MIN_CANDLES_FOR_INDICATORS = 15;

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  subsystems: {
    database: SubsystemStatus;
    deltaExchange: SubsystemStatus;
    priceCollection: SubsystemStatus;
    indicators: SubsystemStatus;
    alertEvaluation: SubsystemStatus;
    discord: SubsystemStatus;
  };
  summary: string;
}

interface SubsystemStatus {
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  details?: Record<string, unknown>;
  lastCheck?: string;
  error?: string;
}

async function checkDatabase(): Promise<SubsystemStatus> {
  try {
    // Smoke-test a real query rather than trusting the pool alone.
    await db.select().from(apiCredentials).limit(1);

    const poolStatus = {
      totalConnectionCount: pool.totalCount,
      idleConnectionCount: pool.idleCount,
      waitingRequestCount: pool.waitingCount,
    };

    return {
      status: "healthy",
      message: "Database connection successful",
      details: {
        ...poolStatus,
        queryTest: "SELECT * FROM api_credentials LIMIT 1",
      },
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Database connection failed",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkDeltaExchange(): Promise<SubsystemStatus> {
  try {
    // Get first active credential
    const credentials = await db
      .select()
      .from(apiCredentials)
      .where(eq(apiCredentials.isActive, true))
      .limit(1);

    if (credentials.length === 0) {
      return {
        status: "degraded",
        message: "No active Delta Exchange credentials configured",
        details: {
          hasCredentials: false,
          configured: false,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    const credential = credentials[0];
    const apiKey = decryptText(credential.encryptedApiKey);
    const apiSecret = decryptText(credential.encryptedApiSecret);

    // Test connection with a simple ticker request
    const deltaClient = createDeltaClient(apiKey, apiSecret);
    const watchlistsData = await db.select().from(watchlists);

    const symbols = watchlistsData.flatMap((w) => w.symbols || []);

    if (symbols.length === 0) {
      return {
        status: "degraded",
        message: "No watchlist symbols configured",
        lastCheck: new Date().toISOString(),
      };
    }

    const testSymbol = symbols[0];
    const ticker = await deltaClient.getTicker(testSymbol);

    return {
      status: "healthy",
      message: "Delta Exchange API connection successful",
      details: {
        credentialName: credential.name,
        testSymbol,
        lastPrice: ticker.lastPrice,
        bid: ticker.bid,
        ask: ticker.ask,
        volume24h: ticker.volume24h,
      },
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Delta Exchange API connection failed",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkPriceCollection(): Promise<SubsystemStatus> {
  try {
    // Check if we have price history data
    const priceData = await db
      .select()
      .from(priceHistory)
      .orderBy(desc(priceHistory.timestamp))
      .limit(1);

    if (priceData.length === 0) {
      return {
        status: "degraded",
        message: "No price data collected yet",
        details: {
          dataPoints: 0,
          ready: false,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    const latestPrice = priceData[0];
    const allPrices = await db.select().from(priceHistory);

const ageHours =
    (Date.now() - latestPrice.timestamp.getTime()) / (1000 * 60 * 60);

  const status = ageHours > STALE_PRICE_HOURS ? "degraded" : "healthy";

  return {
    status,
    message:
      ageHours > STALE_PRICE_HOURS
        ? `Price data is stale (${ageHours.toFixed(1)} hours old)`
        : "Price collection is working",
    details: {
      totalDataPoints: allPrices.length,
      lastPrice: {
        symbol: latestPrice.symbol,
        close: latestPrice.close,
        timestamp: latestPrice.timestamp.toISOString(),
      },
      priceAgeHours: ageHours.toFixed(2),
      uniqueSymbols: allPrices
        .map((p) => p.symbol)
        .filter((v, i, a) => a.indexOf(v) === i).length,
    },
    lastCheck: new Date().toISOString(),
  };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Price collection check failed",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkIndicators(): Promise<SubsystemStatus> {
  try {
    const recentIndicators = await db
      .select()
      .from(indicatorData)
      .orderBy(desc(indicatorData.createdAt))
      .limit(10);

    if (recentIndicators.length === 0) {
      return {
        status: "degraded",
        message: "No indicator data calculated yet",
        details: {
          dataPoints: 0,
          ready: false,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    const priceData = await db
      .select()
      .from(priceHistory)
      .orderBy(desc(priceHistory.timestamp))
      .limit(50);

    if (priceData.length < MIN_CANDLES_FOR_INDICATORS) {
      return {
        status: "degraded",
        message: "Indicators exist but historical price data is limited",
        details: {
          indicatorRows: recentIndicators.length,
          priceDataPoints: priceData.length,
          requiredForValidation: MIN_CANDLES_FOR_INDICATORS,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    const sample = calculateIndicators(priceData.reverse().map((p) => p.close));

    const indicatorTypes = recentIndicators
      .map((row) => row.indicatorType)
      .filter((value, index, all) => all.indexOf(value) === index);

    return {
      status: "healthy",
      message: "Indicator calculation is working",
      details: {
        totalDataPoints: recentIndicators.length,
        indicatorTypes,
        testCalculations: {
          rsi: sample.rsi.toFixed(2),
          ema12: sample.ema12.toFixed(2),
          ema26: sample.ema26.toFixed(2),
          macdHistogram: sample.macd.histogram.toFixed(2),
        },
        periods: {
          rsi: DEFAULT_RSI_PERIOD,
          fastEma: FAST_EMA_PERIOD,
          slowEma: SLOW_EMA_PERIOD,
        },
      },
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Indicator calculation check failed",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkAlertEvaluation(): Promise<SubsystemStatus> {
  try {
    // Check if we have alerts configured
    const alertList = await db.select().from(alerts).limit(10);
    const activeAlerts = alertList.filter((a) => a.isActive);

    if (alertList.length === 0) {
      return {
        status: "degraded",
        message: "No alerts configured",
        details: {
          totalAlerts: 0,
          activeAlerts: 0,
          configured: false,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    // Check price and indicator data availability
    const priceCount = await db.select().from(priceHistory).limit(1);
    const indicatorCount = await db.select().from(indicatorData).limit(1);

    const hasPriceData = priceCount.length > 0;
    const hasIndicators = indicatorCount.length > 0;

    const canEvaluate =
      hasPriceData && hasIndicators && activeAlerts.length > 0;

    return {
      status: canEvaluate ? "healthy" : "degraded",
      message: canEvaluate
        ? "Alert evaluation is ready"
        : "Alert evaluation waiting for price/indicator data",
      details: {
        totalAlerts: alertList.length,
        activeAlerts: activeAlerts.length,
        priceDataAvailable: hasPriceData,
        indicatorDataAvailable: hasIndicators,
        canEvaluate,
      },
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "unhealthy",
      message: "Alert evaluation check failed",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkDiscordWebhook(): Promise<SubsystemStatus> {
  try {
    // Check if Discord webhook is configured
    const discordChannels = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.channelType, "discord"));

    if (discordChannels.length === 0) {
      return {
        status: "degraded",
        message: "No Discord webhook configured",
        details: {
          configured: false,
          activeChannels: 0,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    const activeDiscordChannels = discordChannels.filter((c) => c.isActive);

    if (activeDiscordChannels.length === 0) {
      return {
        status: "degraded",
        message: "Discord webhook configured but inactive",
        details: {
          configured: true,
          totalChannels: discordChannels.length,
          activeChannels: 0,
        },
        lastCheck: new Date().toISOString(),
      };
    }

    // Probe the webhook with a read-only GET so no message is posted.
    let webhookValid = false;
    let testResult = "No webhook URL found on active channels";

    for (const channel of activeDiscordChannels) {
      const config = channel.config as { webhookUrl?: string } | null;
      if (!config?.webhookUrl) continue;

      try {
        const response = await fetch(config.webhookUrl, { method: "GET" });
        webhookValid = response.ok;
        testResult = `Webhook responded with HTTP ${response.status}`;
      } catch (error) {
        testResult = `Webhook request failed: ${String(error)}`;
      }
      break;
    }

    return {
      status: webhookValid ? "healthy" : "degraded",
      message: webhookValid
        ? "Discord webhook is valid and accessible"
        : "Discord webhook exists but may not be accessible",
      details: {
        configured: true,
        totalChannels: discordChannels.length,
        activeChannels: activeDiscordChannels.length,
        webhookValid,
        testResult,
      },
      lastCheck: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "degraded",
      message: "Discord webhook check encountered an error",
      error: String(error),
      lastCheck: new Date().toISOString(),
    };
  }
}

export async function GET() {
  try {
    // Run all health checks in parallel
    const [
      database,
      deltaExchange,
      priceCollection,
      indicators,
      alertEvaluation,
      discord,
    ] = await Promise.all([
      checkDatabase(),
      checkDeltaExchange(),
      checkPriceCollection(),
      checkIndicators(),
      checkAlertEvaluation(),
      checkDiscordWebhook(),
    ]);

    // Determine overall system status
    const allStatuses = [
      database,
      deltaExchange,
      priceCollection,
      indicators,
      alertEvaluation,
      discord,
    ];
    const unhealthyCount = allStatuses.filter(
      (s) => s.status === "unhealthy",
    ).length;
    const degradedCount = allStatuses.filter(
      (s) => s.status === "degraded",
    ).length;

    let overallStatus: "healthy" | "degraded" | "unhealthy";
    const criticalSubsystems = [database, deltaExchange];

    const criticalFailures = criticalSubsystems.filter(
      (s) => s.status === "unhealthy",
    ).length;

    if (criticalFailures > 0) {
      overallStatus = "unhealthy";
    } else if (degradedCount > 0) {
      overallStatus = "degraded";
    } else {
      overallStatus = "healthy";
    }

    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      subsystems: {
        database,
        deltaExchange,
        priceCollection,
        indicators,
        alertEvaluation,
        discord,
      },
      summary: generateSummary(overallStatus, unhealthyCount, degradedCount),
    };

    const statusCode = overallStatus === "unhealthy" ? 503 : 200;

    return NextResponse.json(response, { status: statusCode });
  } catch (error) {
    console.error("[crypto-sentinel] Health check failed:", error);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        subsystems: {
          database: {
            status: "unhealthy",
            message: "Health check failed",
            error: String(error),
          },
          deltaExchange: { status: "unknown", message: "Not tested" },
          priceCollection: { status: "unknown", message: "Not tested" },
          indicators: { status: "unknown", message: "Not tested" },
          alertEvaluation: { status: "unknown", message: "Not tested" },
          discord: { status: "unknown", message: "Not tested" },
        },
        summary: "System health check failed catastrophically",
      },
      { status: 503 },
    );
  }
}

function generateSummary(
  status: "healthy" | "degraded" | "unhealthy",
  unhealthyCount: number,
  degradedCount: number,
): string {
  if (status === "healthy") {
    return "All subsystems operational and ready for alert processing";
  } else if (status === "degraded") {
    return `System operational with ${degradedCount} degraded subsystem(s) - some features may be limited`;
  } else {
    return `System unhealthy - ${unhealthyCount} critical subsystem(s) down - alert processing may be affected`;
  }
}

export async function POST() {
  return GET();
}
