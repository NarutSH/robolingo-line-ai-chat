import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { env } from '@/lib/env'

/**
 * One operator, one shared password, one signed cookie.
 *
 * This is deliberately not a user system — the brief asks for a working
 * webchat, not identity management. It exists because the deployed URL gets
 * handed to a stranger and the console shows real LINE users' names and photos.
 */
export const SESSION_COOKIE = 'op_session'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function sign(payload: string): string {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not configured')
  return createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url')
}

/** Length-checked before the constant-time compare — timingSafeEqual throws otherwise. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export function issueSessionValue(): string {
  const expiresAt = String(Date.now() + TTL_MS)
  return `${expiresAt}.${sign(expiresAt)}`
}

export function isValidSessionValue(value: string | undefined | null): boolean {
  if (!value) return false
  const separator = value.indexOf('.')
  if (separator < 1) return false

  const expiresAt = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!/^\d+$/.test(expiresAt)) return false
  if (Number(expiresAt) < Date.now()) return false

  try {
    return safeEqual(signature, sign(expiresAt))
  } catch {
    return false
  }
}

export function passwordMatches(candidate: string): boolean {
  if (!env.OPERATOR_PASSWORD) return false
  return safeEqual(candidate, env.OPERATOR_PASSWORD)
}

/** Authoritative check. Every protected API route calls this; proxy.ts only guesses. */
export async function requireOperator(): Promise<boolean> {
  const store = await cookies()
  return isValidSessionValue(store.get(SESSION_COOKIE)?.value)
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: TTL_MS / 1000,
}
