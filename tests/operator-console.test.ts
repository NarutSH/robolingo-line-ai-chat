import { describe, expect, it } from 'vitest'
import { GET as listConversations } from '@/app/api/conversations/route'
import { POST as sendMessage } from '@/app/api/conversations/[id]/messages/route'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import { fakeFetch } from './helpers/fetch-fake'
import { lineOk, lineRejects, sentToLine } from './helpers/line'
import { messagesIn, seedLineConversation } from './helpers/db'
import { withCookie } from './support/request-context'

/** Next hands route handlers their params as a promise. */
function messageContext(conversationId: string) {
  return { params: Promise.resolve({ id: conversationId }) }
}

function composed(text: string): Request {
  return new Request('https://webchat.test/api/conversations/x/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

describe('the operator console', () => {
  it('will not list conversations without a session', async () => {
    expect((await listConversations()).status).toBe(401)
  })

  it('lists conversations for a signed-in operator', async () => {
    signIn()
    const response = await listConversations()

    expect(response.status).toBe(200)
    const body = (await response.json()) as { conversations: unknown[] }
    expect(Array.isArray(body.conversations)).toBe(true)
  })

  it('will not send a message without a session, and writes nothing', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const seeded = await seedLineConversation()

    const response = await sendMessage(composed('สวัสดีครับ'), messageContext(seeded.conversationId))

    expect(response.status).toBe(401)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(0)
    expect(sentToLine()).toHaveLength(0)
  })

  it('pushes an operator reply to LINE with an idempotency key', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    signIn()
    const seeded = await seedLineConversation()

    const response = await sendMessage(
      composed('ร้านเปิด 8 โมงครับ'),
      messageContext(seeded.conversationId)
    )

    expect(response.status).toBe(200)

    const sent = sentToLine()
    expect(sent).toHaveLength(1)
    // The operator replies long after the inbound webhook, so any reply token is
    // dead: this always pushes, and the retry key stops a retry double-sending.
    expect(sent[0].via).toBe('push')
    expect(sent[0].to).toBe(seeded.lineUserId)
    expect(sent[0].text).toBe('ร้านเปิด 8 โมงครับ')
    expect(sent[0].retryKey).toBeTruthy()

    const messages = await messagesIn(seeded.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0].sender).toBe('operator')
    expect(messages[0].direction).toBe('outbound')
    expect(messages[0].delivery_status).toBe('sent')
  })

  it('keeps a rejected message visible in the thread instead of losing it', async () => {
    fakeFetch({ 'api.line.me': lineRejects(500, 'The property, gw, is not supported') })
    signIn()
    const seeded = await seedLineConversation()

    const response = await sendMessage(composed('ส่งไม่ผ่าน'), messageContext(seeded.conversationId))

    expect(response.status).toBe(502)

    const messages = await messagesIn(seeded.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0].delivery_status).toBe('failed')
    expect(messages[0].delivery_error).toBeTruthy()
  })

  it('refuses an empty message', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    signIn()
    const seeded = await seedLineConversation()

    const response = await sendMessage(composed('   '), messageContext(seeded.conversationId))

    expect(response.status).toBe(400)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(0)
  })

  it('refuses a conversation that does not exist', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    signIn()

    const response = await sendMessage(
      composed('ไปไหน'),
      messageContext('00000000-0000-0000-0000-000000000000')
    )

    expect(response.status).toBe(404)
  })
})
