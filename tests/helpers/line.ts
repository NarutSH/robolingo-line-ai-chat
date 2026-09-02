import { createHmac, randomUUID } from 'node:crypto'
import { calls, type Handler } from './fetch-fake'

/** Reserved so test contacts are recognisable and sweepable. LINE ids are 'U' + 32 hex. */
export const TEST_USER_PREFIX = 'Utest'
export const TEST_EVENT_PREFIX = '01TEST'

function hex(length: number): string {
  return randomUUID().replace(/-/g, '').slice(0, length)
}

export function newTestUserId(): string {
  return TEST_USER_PREFIX + hex(33 - TEST_USER_PREFIX.length)
}

export function newTestEventId(): string {
  return TEST_EVENT_PREFIX + hex(20).toUpperCase()
}

export interface WebhookOptions {
  text?: string
  userId?: string
  eventId?: string
  messageId?: string
  replyToken?: string
  isRedelivery?: boolean
  /** Replaces the whole events array, for follow/unfollow or an empty verify ping. */
  events?: unknown[]
}

function webhookBody(options: WebhookOptions): string {
  return JSON.stringify({
    destination: 'Uoaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    events:
      options.events ?? [
        {
          type: 'message',
          mode: 'active',
          timestamp: Date.now(),
          webhookEventId: options.eventId ?? newTestEventId(),
          deliveryContext: { isRedelivery: options.isRedelivery ?? false },
          source: { type: 'user', userId: options.userId ?? newTestUserId() },
          replyToken: options.replyToken ?? hex(32),
          message: {
            type: 'text',
            id: options.messageId ?? String(Date.now()),
            text: options.text ?? 'สวัสดีครับ',
            quoteToken: 'q',
          },
        },
      ],
  })
}

const WEBHOOK_URL = 'https://webchat.test/api/line/webhook'

/**
 * Signed with the real channel secret, so the signature path is exercised rather
 * than bypassed. The body is serialised once and used for both the HMAC and the
 * request, because the signature covers those exact bytes.
 */
export function signedWebhook(options: WebhookOptions = {}): Request {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret) throw new Error('LINE_CHANNEL_SECRET is required to sign a test webhook')

  const body = webhookBody(options)
  const signature = createHmac('SHA256', secret).update(body).digest('base64')

  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  })
}

/** Same body, wrong or missing signature. */
export function tamperedWebhook(options: WebhookOptions & { signature?: string } = {}): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.signature !== undefined) headers['x-line-signature'] = options.signature

  return new Request(WEBHOOK_URL, { method: 'POST', headers, body: webhookBody(options) })
}

/** Answers replies, pushes and profile lookups the way LINE would. */
export function lineOk(): Handler {
  return (request) => {
    if (request.url.pathname.includes('/profile/')) {
      const userId = request.url.pathname.split('/').pop()
      return {
        userId,
        displayName: 'Test Contact',
        pictureUrl: 'https://profile.line-scdn.net/test',
        language: 'th',
      }
    }
    return { sentMessages: [{ id: String(Date.now()), quoteToken: 'q' }] }
  }
}

/** LINE refusing the send, so the failure path can be asserted. */
export function lineRejects(status = 500, message = 'Internal server error'): Handler {
  return (request) => {
    if (request.url.pathname.includes('/profile/')) return lineOk()(request) as Record<string, unknown>
    return Response.json({ message }, { status })
  }
}

export interface SentMessage {
  via: 'reply' | 'push'
  to?: string
  replyToken?: string
  text: string
  retryKey?: string
}

/** What actually went out to LINE, in order. */
export function sentToLine(): SentMessage[] {
  return calls('api.line.me')
    .filter((c) => c.url.pathname.endsWith('/message/reply') || c.url.pathname.endsWith('/message/push'))
    .map((c) => {
      const body = (c.body ?? {}) as {
        to?: string
        replyToken?: string
        messages?: Array<{ text?: string }>
      }
      return {
        via: c.url.pathname.endsWith('/message/reply') ? ('reply' as const) : ('push' as const),
        to: body.to,
        replyToken: body.replyToken,
        text: body.messages?.[0]?.text ?? '',
        retryKey: c.headers.get('x-line-retry-key') ?? undefined,
      }
    })
}
