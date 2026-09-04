import 'server-only'
import { lineClient } from '@/lib/line/client'

/**
 * Reply tokens are valid for one minute and are single-use; replies do not
 * count against the push quota. Push has no expiry but does count.
 *
 * So the rule, in exactly one place:
 *   - AI auto-reply runs inside after() seconds after the webhook  → reply
 *   - Operator replies from the console, minutes later             → push
 *   - Web→LINE relay has no inbound event, so no token exists      → push
 *
 * The margin is 50s rather than 60 so a slow model call cannot land us just
 * past the boundary with a token LINE has already expired.
 */
const REPLY_TOKEN_TTL_MS = 50_000

export interface SendResult {
  lineMessageId?: string
  via: 'reply' | 'push'
}

export async function sendToLine(opts: {
  to: string
  text: string
  /**
   * When present this goes out as an image message and `text` is not sent —
   * LINE has no caption on an image, so a caption would have to be a second
   * message, and the caller is the one who knows whether it wants two.
   */
  imageUrl?: string | null
  replyToken?: string | null
  replyTokenIssuedAt?: Date | string | null
  /** Becomes X-Line-Retry-Key so a retried push cannot double-send. */
  idempotencyKey: string
}): Promise<SendResult> {
  const client = lineClient()
  const messages = opts.imageUrl
    ? [
        {
          type: 'image' as const,
          originalContentUrl: opts.imageUrl,
          // LINE requires a preview and will not derive one. The stored file is
          // already capped well under the limit, so it stands in for both
          // rather than us maintaining a second rendition of every picture.
          previewImageUrl: opts.imageUrl,
        },
      ]
    : [{ type: 'text' as const, text: opts.text.slice(0, 5000) }]

  const issuedAt = opts.replyTokenIssuedAt ? new Date(opts.replyTokenIssuedAt) : null
  const tokenIsFresh =
    Boolean(opts.replyToken) && issuedAt !== null && Date.now() - issuedAt.getTime() < REPLY_TOKEN_TTL_MS

  if (tokenIsFresh) {
    try {
      const res = await client.replyMessage({ replyToken: opts.replyToken!, messages })
      return { lineMessageId: res.sentMessages?.[0]?.id, via: 'reply' }
    } catch {
      // Used or expired token — fall through to push rather than losing the message.
    }
  }

  const res = await client.pushMessage({ to: opts.to, messages }, opts.idempotencyKey)
  return { lineMessageId: res.sentMessages?.[0]?.id, via: 'push' }
}
