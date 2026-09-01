import { cookies } from 'next/headers'
import { issueSessionValue, passwordMatches, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'
import { featureReady } from '@/lib/env'

export async function POST(request: Request) {
  if (!featureReady.operatorAuth) {
    return Response.json({ error: 'Operator login is not configured on this deployment.' }, { status: 503 })
  }

  const form = await request.formData().catch(() => null)
  const password = String(form?.get('password') ?? '')

  if (!passwordMatches(password)) {
    return Response.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const store = await cookies()
  store.set(SESSION_COOKIE, issueSessionValue(), sessionCookieOptions)
  return Response.json({ ok: true })
}
