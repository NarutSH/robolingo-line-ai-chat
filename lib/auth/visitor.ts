import 'server-only'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * A web visitor's identity, which is nothing more than "the same browser as
 * last time". No name, no email, no account — asking for any of those would
 * cost more than a quick question is worth to the person asking it.
 *
 * The cookie is signed with the same secret as the operator session but over a
 * different input space, so neither cookie can ever be replayed as the other.
 */
export const VISITOR_COOKIE = 'web_visitor'
const TTL_MS = 30 * 24 * 60 * 60 * 1000
const PURPOSE = 'visitor:'

function sign(payload: string): string {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured')
  return createHmac('sha256', env.SESSION_SECRET).update(PURPOSE + payload).digest('base64url')
}

/** Length-checked first — timingSafeEqual throws on a mismatch. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export function issueVisitorSession(): { sessionId: string; value: string } {
  const sessionId = randomUUID()
  const payload = `${sessionId}.${Date.now() + TTL_MS}`
  return { sessionId, value: `${payload}.${sign(payload)}` }
}

/** The session id the cookie carries, or null if it is absent, stale or forged. */
export function readVisitorSession(value: string | undefined | null): string | null {
  if (!value) return null

  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [sessionId, expiresAt, signature] = parts

  if (!/^[0-9a-f-]{36}$/.test(sessionId)) return null
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return null

  try {
    return safeEqual(signature, sign(`${sessionId}.${expiresAt}`)) ? sessionId : null
  } catch {
    return null
  }
}

export async function currentVisitorSession(): Promise<string | null> {
  const store = await cookies()
  return readVisitorSession(store.get(VISITOR_COOKIE)?.value)
}

export const visitorCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: TTL_MS / 1000,
}
