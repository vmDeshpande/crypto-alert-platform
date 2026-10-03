import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Bearer-token guard for the internal API.
 *
 * The same `ALERT_API_KEY` authorises the external cron service and the
 * pipeline's own internal calls, which is why these routes sit outside the
 * session-cookie middleware.
 *
 * Fails closed in production when `ALERT_API_KEY` is unset. In development the
 * check is skipped so you can drive the endpoints from a terminal without
 * exporting a secret first.
 */
export function isAuthorized(request: Request): boolean {
  const expected = process.env.ALERT_API_KEY

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[crypto-sentinel] ALERT_API_KEY is not set — refusing API request',
      )
      return false
    }
    return true
  }

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  const providedBytes = Buffer.from(provided)
  const expectedBytes = Buffer.from(expected)
  if (providedBytes.length !== expectedBytes.length) return false

  return timingSafeEqual(providedBytes, expectedBytes)
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

/** Convenience guard: returns a 401 response when the token is missing or wrong. */
export function rejectUnauthorized(request: Request): NextResponse | null {
  return isAuthorized(request) ? null : unauthorized()
}