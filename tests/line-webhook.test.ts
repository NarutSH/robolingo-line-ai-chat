import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/line/webhook/route'
import { fakeFetch, calls } from './helpers/fetch-fake'
import {
  lineOk,
  newTestEventId,
  newTestUserId,
  sentToLine,
  signedWebhook,
  tamperedWebhook,
} from './helpers/line'
import { conversationForLineUser, messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter } from './support/request-context'

describe('the LINE webhook', () => {
  it('refuses a body whose signature does not match, and stores nothing', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const userId = newTestUserId()

    const response = await POST(tamperedWebhook({ userId, signature: 'not-a-real-signature' }))

    expect(response.status).toBe(401)
    expect(await conversationForLineUser(userId)).toBeNull()
  })

  it('refuses a body with no signature at all', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const userId = newTestUserId()

    const response = await POST(tamperedWebhook({ userId }))

    expect(response.status).toBe(401)
    expect(await conversationForLineUser(userId)).toBeNull()
  })

  it('records a first-time contact, their conversation, and their message', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const userId = newTestUserId()

    const response = await POST(signedWebhook({ userId, text: 'เปิดกี่โมงครับ' }))
    await flushAfter()

    expect(response.status).toBe(200)

    const conversation = await conversationForLineUser(userId)
    expect(conversation).not.toBeNull()
    expect(conversation!.channel).toBe('line')

    const messages = await messagesIn(conversation!.id)
    expect(messages).toHaveLength(1)
    expect(messages[0].direction).toBe('inbound')
    expect(messages[0].sender).toBe('line_user')
    expect(messages[0].content).toBe('เปิดกี่โมงครับ')
  })

  it('treats a redelivered event as already handled', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const userId = newTestUserId()
    const eventId = newTestEventId()

    const first = await POST(signedWebhook({ userId, eventId, text: 'ซ้ำ' }))
    await flushAfter()
    const second = await POST(
      signedWebhook({ userId, eventId, text: 'ซ้ำ', isRedelivery: true })
    )
    await flushAfter()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const conversation = await conversationForLineUser(userId)
    const messages = await messagesIn(conversation!.id)
    expect(messages).toHaveLength(1)
  })

  it('stores a message on a manual conversation without answering it', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const seeded = await seedLineConversation({ mode: 'manual' })

    const response = await POST(
      signedWebhook({ userId: seeded.lineUserId, text: 'มีที่จอดรถไหม' })
    )
    await flushAfter()

    expect(response.status).toBe(200)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
    expect(sentToLine()).toHaveLength(0)
  })

  it('rejects a correctly signed body that is not JSON', async () => {
    const secret = process.env.LINE_CHANNEL_SECRET!
    const { createHmac } = await import('node:crypto')
    const body = 'this is not json'
    const request = new Request('https://webchat.test/api/line/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': createHmac('SHA256', secret).update(body).digest('base64'),
      },
      body,
    })

    expect((await POST(request)).status).toBe(400)
  })

  it("answers the console's verify ping, which carries no events", async () => {
    fakeFetch({ 'api.line.me': lineOk() })

    const response = await POST(signedWebhook({ events: [] }))

    expect(response.status).toBe(200)
    expect(calls('api.line.me')).toHaveLength(0)
  })
})
