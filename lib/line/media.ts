import 'server-only'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/server'
import {
  conversationMediaPrefix,
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  storeImage,
} from '@/lib/media/store'

/**
 * Message content lives on a different host from the rest of the Messaging API.
 *
 * Fetched directly rather than through the SDK's blob client, which hands back
 * a Node stream: `fetch` gives the response headers this needs, and keeps the
 * call inside the one boundary the tests intercept.
 */
const CONTENT_ENDPOINT = 'https://api-data.line.me/v2/bot/message'

/**
 * Fetches the picture a customer sent and keeps a copy.
 *
 * LINE holds message content for a limited window and only releases it to the
 * channel token, so the operator's browser cannot fetch it directly — a URL
 * pointing at LINE would be both unauthorised and, before long, expired. The
 * bytes are copied into our own bucket once, and the row then points at
 * something that still resolves next month.
 *
 * Runs inside after(), so none of this can delay the webhook's 200. Every
 * failure is logged and swallowed: the message row already exists and reads as
 * '[image]', which is exactly what it said before this function existed. A
 * picture that could not be copied is worth less than the conversation.
 */
export async function captureInboundImage(params: {
  messageRowId: string
  conversationId: string
  lineMessageId: string
}): Promise<void> {
  try {
    const response = await fetch(`${CONTENT_ENDPOINT}/${params.lineMessageId}/content`, {
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    })

    if (!response.ok) {
      console.error('[line] content fetch refused', response.status)
      return
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!isAcceptedImageType(contentType)) {
      console.warn('[line] inbound image is not a type we store', contentType)
      return
    }

    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      console.warn('[line] inbound image is larger than we store', bytes.byteLength)
      return
    }

    const stored = await storeImage({
      prefix: conversationMediaPrefix(params.conversationId),
      bytes,
      contentType,
    })

    await createAdminClient()
      .from('messages')
      .update({ media_url: stored.url })
      .eq('id', params.messageRowId)
  } catch (cause) {
    console.error('[line] could not copy an inbound image', cause)
  }
}
