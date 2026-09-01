import 'server-only'
import { messagingApi } from '@line/bot-sdk'
import { env } from '@/lib/env'

/**
 * Per Supabase/Vercel Fluid compute guidance, clients are created per call
 * rather than held in a module-level singleton.
 */
export function lineClient() {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured')
  }
  return new messagingApi.MessagingApiClient({
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
  })
}
