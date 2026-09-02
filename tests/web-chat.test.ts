import { describe, expect, it } from 'vitest'
import { GET as readChat, POST as sendChat } from '@/app/api/chat/messages/route'
import { GET as listConversations } from '@/app/api/conversations/route'
import { POST as operatorReply } from '@/app/api/conversations/[id]/messages/route'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import type { ChatMessage } from '@/lib/types'
import type { ConversationSummary } from '@/lib/data/conversations'
import { fakeFetch } from './helpers/fetch-fake'
import { lineOk, sentToLine } from './helpers/line'
import { openRouter } from './helpers/openrouter'
import {
  flushAfter,
  readVisitorCookie,
  resetRequestContext,
  withCookie,
} from './support/request-context'

function visitorMessage(text: string): Request {
  return new Request('https://webchat.test/api/chat/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

async function readVisitorMessages(): Promise<ChatMessage[]> {
  const response = await readChat()
  return ((await response.json()) as { messages: ChatMessage[] }).messages
}

describe('the web chat widget', () => {
  it('answers a visitor who gave no details at all', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'เปิด 07:00–19:00 ทุกวันครับ' }) })

    const response = await sendChat(visitorMessage('เปิดกี่โมง'))
    await flushAfter()

    expect(response.status).toBe(200)

    const messages = await readVisitorMessages()
    expect(messages).toHaveLength(2)
    expect(messages[0].sender).toBe('web_visitor')
    expect(messages[1].sender).toBe('ai')
    expect(messages[1].content).toBe('เปิด 07:00–19:00 ทุกวันครับ')

    // Nothing here has anything to do with LINE.
    expect(sentToLine()).toHaveLength(0)
  })

  it('remembers the conversation across a reload', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'ครับผม' }) })

    await sendChat(visitorMessage('สวัสดี'))
    await flushAfter()

    // A reload is a fresh GET carrying the same cookie.
    expect(await readVisitorMessages()).toHaveLength(2)
  })

  it('shows nothing to a browser that has never written in', async () => {
    expect(await readVisitorMessages()).toHaveLength(0)
  })

  it('never shows one visitor another visitor’s conversation', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'ครับ' }) })

    await sendChat(visitorMessage('ความลับของฉัน'))
    await flushAfter()
    const first = await readVisitorMessages()
    expect(first.some((m) => m.content === 'ความลับของฉัน')).toBe(true)

    // A different browser: no cookie, so a different session entirely.
    resetRequestContext()
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'ครับ' }) })
    await sendChat(visitorMessage('ฉันเป็นคนอื่น'))
    await flushAfter()

    const second = await readVisitorMessages()
    expect(second.some((m) => m.content === 'ความลับของฉัน')).toBe(false)
    expect(second.some((m) => m.content === 'ฉันเป็นคนอื่น')).toBe(true)
  })

  it('refuses an empty message and an absurdly long one', async () => {
    expect((await sendChat(visitorMessage('   '))).status).toBe(400)
    expect((await sendChat(visitorMessage('x'.repeat(2001)))).status).toBe(400)
  })

  it('puts the visitor in the operator’s inbox, marked as web', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'ครับ' }) })
    await sendChat(visitorMessage('อยากถามเรื่องเมนู'))
    await flushAfter()

    withCookie(SESSION_COOKIE, issueSessionValue())
    const response = await listConversations()
    const { conversations } = (await response.json()) as { conversations: ConversationSummary[] }

    const web = conversations.filter((c) => c.channel === 'web')
    expect(web.length).toBeGreaterThan(0)
    expect(web[0].lineUserId).toBeNull()
  })

  it('delivers an operator reply to the browser without touching LINE', async () => {
    fakeFetch({ 'api.line.me': lineOk(), 'openrouter.ai': openRouter({ say: 'ครับ' }) })
    await sendChat(visitorMessage('มีที่จอดรถไหม'))
    await flushAfter()

    const before = await readVisitorMessages()
    const conversationId = before[0].conversationId

    withCookie(SESSION_COOKIE, issueSessionValue())
    const reply = await operatorReply(
      new Request('https://webchat.test/api/conversations/x/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'มีครับ 4 คัน' }),
      }),
      { params: Promise.resolve({ id: conversationId }) }
    )

    expect(reply.status).toBe(200)
    expect(sentToLine()).toHaveLength(0)

    const after = await readVisitorMessages()
    expect(after.at(-1)!.sender).toBe('operator')
    expect(after.at(-1)!.content).toBe('มีครับ 4 คัน')
  })
})

describe('a forged visitor cookie', () => {
  it('grants nothing', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'ครับ' }) })
    await sendChat(visitorMessage('ของจริง'))
    await flushAfter()

    const genuine = (await readChat().then((r) => r.json())) as { messages: ChatMessage[] }
    expect(genuine.messages.length).toBeGreaterThan(0)

    // Same session id, signature tampered with. The routes take no conversation
    // id from the client, so this is the only handle an attacker has — and it
    // has to be worthless.
    const [sessionId, expiresAt] = readVisitorCookie()!.split('.')
    resetRequestContext()
    withCookie('web_visitor', `${sessionId}.${expiresAt}.notarealsignature`)

    expect(await readVisitorMessages()).toHaveLength(0)
  })
})
