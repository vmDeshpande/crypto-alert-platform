'use server'

import { db } from '@/lib/db'
import { alerts, alertLogs, priceHistory } from '@/lib/db/schema'
import { eq, gte, and, desc } from 'drizzle-orm'

/** Aggregate counts used by the dashboard stat cards. */
export async function getAlertStatistics() {
  try {
    const [allAlerts, activeAlerts, triggeredAlerts] = await Promise.all([
      db.select().from(alerts),
      db.select().from(alerts).where(eq(alerts.isActive, true)),
      db.select().from(alertLogs),
    ])

    const triggeredLast24h = await db
      .select()
      .from(alertLogs)
      .where(gte(alertLogs.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))

    return {
      data: {
        totalAlerts: allAlerts.length,
        activeAlerts: activeAlerts.length,
        totalTriggered: triggeredAlerts.length,
        triggeredLast24h: triggeredLast24h.length,
        alertsByCondition: countBy(allAlerts, (alert) => alert.conditionType),
        topSymbols: topSymbols(allAlerts),
      },
      error: null,
    }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch alert statistics:', error)
    return { data: null, error: 'Failed to fetch alert statistics' }
  }
}

/** High/low/close range, volume totals and standard deviation over a window. */
export async function getPriceStatistics(symbol: string, hoursBack: number = 24) {
  try {
    const prices = await db
      .select()
      .from(priceHistory)
      .where(
        and(
          eq(priceHistory.symbol, symbol),
          gte(priceHistory.timestamp, new Date(Date.now() - hoursBack * 60 * 60 * 1000)),
        ),
      )
      .orderBy(priceHistory.timestamp)

    if (prices.length === 0) {
      return { data: null, error: 'No price data found' }
    }

    const closes = prices.map((row) => row.close)
    const volumes = prices.map((row) => Number(row.volume))

    return {
      data: {
        symbol,
        period: `${hoursBack}h`,
        priceRange: {
          high: Math.max(...prices.map((row) => row.high)),
          low: Math.min(...prices.map((row) => row.low)),
          current: closes[closes.length - 1],
        },
        priceChange: {
          absolute: closes[closes.length - 1] - closes[0],
          percent: ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100,
        },
        volume: {
          total: volumes.reduce((sum, value) => sum + value, 0),
          average: volumes.reduce((sum, value) => sum + value, 0) / volumes.length,
        },
        volatility: standardDeviation(closes),
        dataPoints: prices.length,
      },
      error: null,
    }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch price statistics:', error)
    return { data: null, error: 'Failed to fetch price statistics' }
  }
}

/** Most recent alert triggers with their alert name, newest first. */
export async function getRecentTriggers(limit: number = 10) {
  try {
    const rows = await db
      .select({
        id: alertLogs.id,
        alertId: alertLogs.alertId,
        alertName: alerts.name,
        symbol: alertLogs.symbol,
        triggeredValue: alertLogs.triggeredValue,
        createdAt: alertLogs.createdAt,
      })
      .from(alertLogs)
      .leftJoin(alerts, eq(alertLogs.alertId, alerts.id))
      .orderBy(desc(alertLogs.createdAt))
      .limit(limit)

    return { data: rows, error: null }
  } catch (error) {
    console.error('[crypto-sentinel] Failed to fetch recent triggers:', error)
    return { data: null, error: 'Failed to fetch recent triggers' }
  }
}

function countBy<T>(rows: T[], key: (row: T) => string | null): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = key(row)
    if (value) acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

function topSymbols(rows: { symbol: string }[], limit = 10) {
  return Object.entries(countBy(rows, (row) => row.symbol))
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([symbol, count]) => ({ symbol, count }))
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length
  return Math.sqrt(variance)
}