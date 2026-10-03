import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME, type SessionPayload } from '@/lib/session'
import { verifyValue } from '@/lib/cookie-signature'

const PUBLIC_PATHS = new Set(['/login'])

/**
 * Gate every UI route behind a valid session cookie.
 *
 * Only enforced when `APP_PASSWORD_HASH` is set — a private single-user
 * deployment can run without a login.
 *
 * `/api/*` is excluded here and protected per-route with `ALERT_API_KEY`
 * instead (see `lib/api-auth.ts`): the external cron service authenticates with
 * a bearer token and has no session cookie.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname) || !process.env.APP_PASSWORD_HASH) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  const session = token ? await verifyValue<SessionPayload>(token) : null

  if (!session?.sid || session.exp < Date.now()) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * All paths except:
     * - /api (protected per-route with ALERT_API_KEY)
     * - /_next/static, /_next/image
     * - /favicon.ico
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}