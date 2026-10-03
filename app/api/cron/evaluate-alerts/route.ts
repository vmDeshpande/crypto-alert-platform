import { NextRequest, NextResponse } from 'next/server'
import { rejectUnauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ error: 'POST only' }, { status: 405 })
}

/**
 * Runs the full pipeline: collect prices, evaluate alerts, send notifications.
 *
 * Each stage is called over HTTP against this deployment's own public base URL
 * rather than imported directly, so stages stay independently callable and
 * testable. Requires `APP_URL` (or a Vercel-provided URL) outside development.
 */
export async function POST(request: NextRequest) {
  const denied = rejectUnauthorized(request)
  if (denied) return denied

  const baseUrl = resolveBaseUrl()
  if (!baseUrl) {
    return NextResponse.json(
      { error: 'Unable to determine base URL — set APP_URL' },
      { status: 500 },
    )
  }

  const internalFetch = (path: string, body: Record<string, unknown> = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ALERT_API_KEY ?? ''}`,
      },
      body: JSON.stringify(body),
    })

  const results: {
    priceCollection: unknown
    alertEvaluation: unknown
    notifications: { sent: number; failed: number }
    timestamp: string
  } = {
    priceCollection: null,
    alertEvaluation: null,
    notifications: { sent: 0, failed: 0 },
    timestamp: new Date().toISOString(),
  }

  // Stage 1 — refresh candles and indicators.
  console.log('[crypto-sentinel] Collecting price data...')
  try {
    const response = await internalFetch('/api/data/collect-prices')
    results.priceCollection = await response.json()
  } catch (error) {
    console.error('[crypto-sentinel] Price collection failed:', error)
    results.priceCollection = { success: false, error: String(error) }
  }

  // Stage 2 — evaluate active alerts against the freshest data.
  console.log('[crypto-sentinel] Evaluating alerts...')
  const evaluateResponse = await internalFetch('/api/alerts/evaluate')
  const evaluated = await evaluateResponse.json()
  results.alertEvaluation = evaluated

  if (!evaluateResponse.ok) {
    console.error('[crypto-sentinel] Alert evaluation failed:', evaluated)
    return NextResponse.json(
      { error: 'Failed to evaluate alerts', details: evaluated },
      { status: 500 },
    )
  }

  console.log('[crypto-sentinel] Alert evaluation complete:', {
    evaluated: evaluated.evaluated,
    triggered: evaluated.triggered,
  })

  // Stage 3 — fan out notifications for each trigger.
  for (const alert of evaluated.alerts ?? []) {
    const response = await internalFetch('/api/notifications/send', {
      alertId: alert.id,
      alertName: alert.name,
      symbol: alert.symbol,
      triggeredValue: alert.triggeredValue,
      channelIds: alert.notificationChannels ?? [],
    })

    if (!response.ok) {
      results.notifications.failed += 1
      console.error(
        `[crypto-sentinel] Notification request failed for alert ${alert.id}`,
      )
      continue
    }

    const notified = await response.json()
    results.notifications.sent += notified.sent ?? 0
    results.notifications.failed += notified.failed ?? 0
  }

  return NextResponse.json({
    success: true,
    message: `Evaluated ${evaluated.evaluated} alerts, triggered ${evaluated.triggered}, sent ${results.notifications.sent} notifications`,
    results,
  })
}

/** Public base URL of this deployment, used for the internal pipeline calls. */
function resolveBaseUrl(): string | null {
  const candidates = [
    process.env.APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
  ]

  const explicit = candidates.find((value): value is string => Boolean(value))
  if (explicit) return explicit.replace(/\/$/, '')

  return process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
}