import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/session'

/**
 * Cheap presence check only — a redirect so signed-out operators land on the
 * login page instead of an empty console.
 *
 * The Next.js docs warn that proxy runs separately from render code and must
 * not rely on shared modules or globals, so the *authoritative* HMAC
 * verification lives in every protected API route via requireOperator().
 * Forging this cookie gets you a rendered shell and 401s from every endpoint.
 */
export function proxy(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)
  if (hasCookie) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/console/:path*'],
}
