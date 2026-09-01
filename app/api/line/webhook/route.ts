import { after } from 'next/server'
import type { webhook } from '@line/bot-sdk'
import { verifyLineSignature } from '@/lib/line/verify'
import { ingestLineMessage } from '@/lib/line/ingest'
import { refreshProfile } from '@/lib/line/profile'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Bounds the after() work. This is a deliberate reduction from Vercel's 300s
 * Fluid default: it caps runaway spend and lines up with the one-minute life
 * of a LINE reply token.
 */
export const maxDuration = 60

/** LINE only guarantees text; everything else is stored as a labelled placeholder. */
function describeMessage(message: webhook.MessageContent): {
  contentType: string
  content: string
  quotedLineMessageId: string | null
} {
  if (message.type === 'text') {
    const text = message as webhook.TextMessageContent
    return {
      contentType: 'text',
      content: text.text ?? '',
      quotedLineMessageId: text.quotedMessageId ?? null,
    }
  }
  const label: Record<string, string> = {
    sticker: '[sticker]', image: '[image]', video: '[video]',
    audio: '[audio]', file: '[file]', location: '[location]',
  }
  return {
    contentType: message.type ?? 'unsupported',
    content: label[message.type ?? ''] ?? '[unsupported message]',
    quotedLineMessageId: null,
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get('x-line-signature')

  // Read the raw body exactly once — the signature is computed over these exact
  // bytes, and calling request.json() afterwards would throw.
  const raw = await request.text()

  if (!verifyLineSignature(raw, signature)) {
    // 401 rather than a silent 200, so it shows up in LINE's error statistics.
    return new Response('Invalid signature', { status: 401 })
  }

  let body: webhook.CallbackRequest
  try {
    body = JSON.parse(raw) as webhook.CallbackRequest
  } catch {
    return new Response('Malformed JSON', { status: 400 })
  }

  // The console's "Verify" button posts `{ destination, events: [] }`,
  // which falls through this loop and returns 200 naturally.
  for (const event of body.events ?? []) {
    if (event.source?.type !== 'user' || !event.source.userId) continue
    const lineUserId = event.source.userId
    const isRedelivery = Boolean(event.deliveryContext?.isRedelivery)

    if (event.type === 'unfollow') {
      after(async () => {
        await createAdminClient()
          .from('line_users')
          .update({ is_friend: false, updated_at: new Date().toISOString() })
          .eq('line_user_id', lineUserId)
      })
      continue
    }

    if (event.type === 'follow') {
      after(() => refreshProfile(lineUserId))
      continue
    }

    if (event.type !== 'message') continue
    const messageEvent = event as webhook.MessageEvent
    const described = describeMessage(messageEvent.message)

    const result = await ingestLineMessage({
      webhookEventId: event.webhookEventId,
      eventType: event.type,
      isRedelivery,
      lineUserId,
      lineMessageId: messageEvent.message.id ?? null,
      content: described.content,
      contentType: described.contentType,
      quotedLineMessageId: described.quotedLineMessageId,
      replyToken: messageEvent.replyToken ?? null,
      raw: event,
    })

    if (result.isDuplicate) continue

    // Everything slow happens after the 200 is already on the wire.
    if (result.needsProfile) {
      after(() =>
        refreshProfile(lineUserId).catch((error) => {
          console.error('[line] profile refresh failed', error)
        })
      )
    }
  }

  return new Response('ok', { status: 200 })
}
