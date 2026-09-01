import 'server-only'
import { validateSignature } from '@line/bot-sdk'
import { env } from '@/lib/env'

/**
 * The webhook URL is public, so without this anyone could POST fabricated
 * messages into the system. LINE signs the raw body with the channel secret
 * (HMAC-SHA256, base64).
 *
 * This delegates to the SDK rather than hand-rolling the compare, because
 * `crypto.timingSafeEqual` *throws* on a length mismatch — a truncated or
 * garbage signature would then return 500 instead of 401, and LINE retries
 * 5xx forever. The SDK checks length before the constant-time compare.
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !env.LINE_CHANNEL_SECRET) return false
  try {
    return validateSignature(rawBody, env.LINE_CHANNEL_SECRET, signature)
  } catch {
    return false
  }
}
