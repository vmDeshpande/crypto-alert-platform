import { db } from "@/lib/db";
import { rejectUnauthorized } from "@/lib/api-auth";
import { alerts, priceHistory, alertLogs, indicatorData } from "@/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Minimum gap between two triggers of the same alert. */
const COOLDOWN_MS = 5 * 60 * 1000;

const PRICE_HISTORY_LIMIT = 50;
const INDICATOR_HISTORY_LIMIT = 4;

interface AlertEvaluationRequest {
  alertIds?: string[];
  symbol?: string;
}

interface EvaluationResult {
  triggered: boolean;
  reason?: string;
}

type ConditionType =
  | "price_above"
  | "price_below"
  | "price_change_percent"
  | "volume_spike"
  | "rsi_overbought"
  | "rsi_oversold"
  | "moving_average_cross"
  | "macd_cross";

type AlertRow = {
  id: string;
  name: string;
  symbol: string;
  conditionType: ConditionType;
  conditionValue: number | null;
  secondConditionType: ConditionType | null;
  secondConditionValue: number | null;
  comparisonOperator: "AND" | "OR" | null;
  notificationChannels: string[];
  lastTriggeredAt: Date | null;
};

interface PricePoint {
  close: number;
  volume: string | number | bigint;
}

interface Metrics {
  rsi?: number;
  ema12?: number;
  ema26?: number;
  macdHistogram?: number;
}

export async function GET() {
  return NextResponse.json({ error: "POST only" }, { status: 405 });
}

export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request);
  if (denied) return denied;

  try {
    const body: AlertEvaluationRequest = await request.json().catch(() => ({}));
    const { alertIds, symbol } = body;

    const filters = [eq(alerts.isActive, true)];
    if (alertIds?.length) filters.push(inArray(alerts.id, alertIds));
    if (symbol) filters.push(eq(alerts.symbol, symbol));

    const alertsToEvaluate = (await db
      .select()
      .from(alerts)
      .where(and(...filters))) as AlertRow[];

    const triggeredAlerts: Record<string, unknown>[] = [];
    const evaluationDetails: Record<string, unknown>[] = [];

    for (const alert of alertsToEvaluate) {
      try {
        const detail = await evaluateSingleAlert(alert);
        evaluationDetails.push(detail);

        if (detail.status === "triggered") {
          triggeredAlerts.push({
            id: alert.id,
            name: alert.name,
            symbol: alert.symbol,
            triggeredValue: detail.triggeredValue,
            condition: alert.conditionType,
            notificationChannels: alert.notificationChannels,
          });
        }
      } catch (error) {
        console.error(`[crypto-sentinel] Error evaluating alert ${alert.id}:`, error);
        evaluationDetails.push({
          alertId: alert.id,
          status: "error",
          reason: String(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      evaluated: alertsToEvaluate.length,
      triggered: triggeredAlerts.length,
      alerts: triggeredAlerts,
      details: evaluationDetails,
    });
  } catch (error) {
    console.error("[crypto-sentinel] Alert evaluation error:", error);
    return NextResponse.json(
      { error: "Failed to evaluate alerts" },
      { status: 500 },
    );
  }
}

/**
 * Evaluates one alert against the latest stored price and indicator data.
 * Records the trigger in `alert_logs` and stamps `last_triggered_at`.
 */
async function evaluateSingleAlert(alert: AlertRow) {
  const priceData = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.symbol, alert.symbol))
    .orderBy(desc(priceHistory.timestamp))
    .limit(PRICE_HISTORY_LIMIT);

  if (priceData.length === 0) {
    return {
      alertId: alert.id,
      status: "no_data",
      reason: "No price data available",
    };
  }

  const prices = priceData.reverse() as PricePoint[];
  const currentPrice = prices[prices.length - 1].close;
  const previousPrice = prices.length > 1 ? prices[prices.length - 2].close : null;

  const result = evaluateAlert(
    alert,
    currentPrice,
    previousPrice,
    prices,
    await loadMetrics(alert.symbol),
  );

  if (!result.triggered) {
    return {
      alertId: alert.id,
      status: "not_triggered",
      reason: result.reason || "Condition not met",
    };
  }

  await db.insert(alertLogs).values({
    alertId: alert.id,
    symbol: alert.symbol,
    triggeredValue: currentPrice,
    notificationStatus: "pending",
  });

  await db
    .update(alerts)
    .set({ lastTriggeredAt: new Date() })
    .where(eq(alerts.id, alert.id));

  return {
    alertId: alert.id,
    status: "triggered",
    reason: result.reason,
    triggeredValue: currentPrice,
  };
}

/** Reads the newest indicator rows for a symbol into a flat lookup object. */
async function loadMetrics(symbol: string): Promise<Metrics> {
  const rows = await db
    .select()
    .from(indicatorData)
    .where(eq(indicatorData.symbol, symbol))
    .orderBy(desc(indicatorData.timestamp))
    .limit(INDICATOR_HISTORY_LIMIT);

  const metrics: Metrics = {};
  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (row.indicatorType === "rsi") metrics.rsi = row.value;
    if (row.indicatorType === "ema" && metadata.period === 12) metrics.ema12 = row.value;
    if (row.indicatorType === "ema" && metadata.period === 26) metrics.ema26 = row.value;
    if (row.indicatorType === "macd") {
      metrics.macdHistogram = (metadata.histogram as number) ?? 0;
    }
  }

  return metrics;
}

function evaluateAlert(
  alert: AlertRow,
  currentPrice: number,
  previousPrice: number | null,
  prices: PricePoint[],
  metrics: Metrics,
): EvaluationResult {
  if (
    alert.lastTriggeredAt &&
    Date.now() - new Date(alert.lastTriggeredAt).getTime() < COOLDOWN_MS
  ) {
    return { triggered: false, reason: "Alert on cooldown" };
  }

  const threshold = alert.conditionValue ?? 0;
  const primary = checkPrimary(alert.conditionType, threshold, {
    currentPrice,
    previousPrice,
    prices,
    metrics,
  });

  if (!alert.secondConditionType) {
    return primary.triggered
      ? { triggered: true, reason: primary.reason }
      : { triggered: false, reason: "" };
  }

  const operator = alert.comparisonOperator ?? "AND";
  const secondary = checkSecondary(alert.secondConditionType, alert.secondConditionValue, currentPrice);
  const triggered = operator === "OR" ? primary.triggered || secondary : primary.triggered && secondary;

  if (!triggered) return { triggered: false, reason: "" };

  return {
    triggered: true,
    reason: `${primary.reason} ${operator} ${alert.secondConditionType} ${alert.secondConditionValue ?? 0}`,
  };
}

function checkPrimary(
  condition: ConditionType,
  threshold: number,
  ctx: {
    currentPrice: number;
    previousPrice: number | null;
    prices: PricePoint[];
    metrics: Metrics;
  },
): { triggered: boolean; reason: string } {
  const { currentPrice, previousPrice, prices, metrics } = ctx;
  const yes = (reason: string) => ({ triggered: true, reason });
  const no = () => ({ triggered: false, reason: "" });

  switch (condition) {
    case "price_above":
      return currentPrice > threshold
        ? yes(`Price $${currentPrice.toFixed(2)} > $${threshold}`)
        : no();

    case "price_below":
      return currentPrice < threshold
        ? yes(`Price $${currentPrice.toFixed(2)} < $${threshold}`)
        : no();

    case "price_change_percent": {
      if (!previousPrice || previousPrice <= 0) return no();
      const change = ((currentPrice - previousPrice) / previousPrice) * 100;
      return Math.abs(change) > threshold
        ? yes(`Price change ${change.toFixed(2)}% > ${threshold}%`)
        : no();
    }

    case "volume_spike": {
      if (prices.length < 2) return no();
      const currentVolume = Number(prices[prices.length - 1].volume) || 0;
      const window = prices.slice(-10);
      const avgVolume =
        window.reduce((sum, point) => sum + (Number(point.volume) || 0), 0) / window.length;
      if (avgVolume <= 0) return no();
      const spikePercent = ((currentVolume - avgVolume) / avgVolume) * 100;
      const limit = threshold || 50;
      return spikePercent > limit ? yes(`Volume spike ${spikePercent.toFixed(0)}%`) : no();
    }

    case "rsi_overbought": {
      if (metrics.rsi === undefined) return no();
      const limit = threshold || 70;
      return metrics.rsi > limit ? yes(`RSI ${metrics.rsi.toFixed(2)} > ${limit}`) : no();
    }

    case "rsi_oversold": {
      if (metrics.rsi === undefined) return no();
      const limit = threshold || 30;
      return metrics.rsi < limit ? yes(`RSI ${metrics.rsi.toFixed(2)} < ${limit}`) : no();
    }

    case "macd_cross": {
      if (metrics.macdHistogram === undefined) return no();
      return metrics.macdHistogram > 0
        ? yes(`MACD histogram ${metrics.macdHistogram.toFixed(2)}`)
        : no();
    }

    case "moving_average_cross": {
      if (metrics.ema12 === undefined || metrics.ema26 === undefined) return no();
      return metrics.ema12 > metrics.ema26
        ? yes(`EMA${12} ${metrics.ema12.toFixed(2)} > EMA${26} ${metrics.ema26.toFixed(2)}`)
        : no();
    }

    default:
      return no();
  }
}

/** The optional second condition only supports price thresholds. */
function checkSecondary(
  condition: ConditionType,
  threshold: number | null,
  currentPrice: number,
): boolean {
  const limit = threshold ?? 0;
  if (condition === "price_above") return currentPrice > limit;
  if (condition === "price_below") return currentPrice < limit;
  return false;
}