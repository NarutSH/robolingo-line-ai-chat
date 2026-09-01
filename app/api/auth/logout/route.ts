import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'

export async function POST() {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions, maxAge: 0 })
  return Response.json({ ok: true })
}
