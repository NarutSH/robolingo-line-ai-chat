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
  replyToken?: string | null
  replyTokenIssuedAt?: Date | string | null
  /** Becomes X-Line-Retry-Key so a retried push cannot double-send. */
  idempotencyKey: string
}): Promise<SendResult> {
  const client = lineClient()
  const messages = [{ type: 'text' as const, text: opts.text.slice(0, 5000) }]

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
