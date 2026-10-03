import { cookies } from 'next/headers'
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS, type SessionPayload } from '@/lib/session'
import { signValue, verifyValue } from '@/lib/cookie-signature'
import { isPasswordProtected, verifyPasswordAgainstConfig } from '@/lib/password'

/**
 * Session handling.
 *
 * Sessions are stateless: the cookie carries a signed `{ sid, exp }` payload and
 * nothing is stored server-side. That keeps the dashboard working on serverless
 * runtimes and across restarts, where an in-memory or database-backed session
 * store would have to be shared between instances.
 *
 * The same signing code runs in `proxy.ts` (edge) and here (Node).
 */

export { isPasswordProtected }

function createSessionId(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createSession(): Promise<string> {
  const sessionId = createSessionId()
  const payload: SessionPayload = {
    sid: sessionId,
    exp: Date.now() + SESSION_DURATION_MS,
  }

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, await signValue(JSON.stringify(payload)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS / 1000,
  })

  return sessionId
}

/** Returns the session id when the cookie is present, authentic and unexpired. */
export async function getSession(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const payload = await verifyValue<SessionPayload>(token)
  return payload?.sid ?? null
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

/**
 * Checks a submitted password against `APP_PASSWORD_HASH`.
 * Returns true when no password is configured.
 */
export async function validatePassword(password: string): Promise<boolean> {
  return verifyPasswordAgainstConfig(password)
}