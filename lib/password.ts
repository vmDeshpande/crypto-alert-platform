import bcrypt from 'bcryptjs'

/**
 * Dashboard access is a single shared password.
 *
 * The bcrypt hash lives in `APP_PASSWORD_HASH`. When it is unset the dashboard
 * is open, which is the default for a private single-user deployment — set it
 * before exposing the app to a network you do not control.
 */

export async function isPasswordProtected(): Promise<boolean> {
  return Boolean(process.env.APP_PASSWORD_HASH)
}

/**
 * Compares a submitted password against `APP_PASSWORD_HASH`.
 * Returns true when no password is configured (no protection requested).
 */
export async function verifyPasswordAgainstConfig(password: string): Promise<boolean> {
  const hash = process.env.APP_PASSWORD_HASH
  if (!hash) return true

  try {
    return await bcrypt.compare(password, hash)
  } catch (error) {
    console.error('[crypto-sentinel] Password validation failed:', error)
    return false
  }
}