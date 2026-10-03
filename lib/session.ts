/** Session constants shared by the server actions and the edge middleware. */

export const SESSION_COOKIE_NAME = 'crypto-sentinel-session'

/** 30 days. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000

export interface SessionPayload {
  /** Session id, for correlating logs. */
  sid: string
  /** Expiry as a millisecond timestamp. */
  exp: number
}