import { describe, expect, it } from 'vitest'
import { PATCH as setMode } from '@/app/api/conversations/[id]/route'
import { POST as suggest } from '@/app/api/conversations/[id]/suggest/route'
import { POST as webhook } from '@/app/api/line/webhook/route'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import { setConversationMode } from '@/lib/data/conversations'
import { fakeFetch, type Handler } from './helpers/fetch-fake'
import { lineOk, sentToLine, signedWebhook } from './helpers/line'
import { lastModelRequest, openRouter, openRouterFails } from './helpers/openrouter'
import { getConversation, messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter, withCookie } from './support/request-context'

function context(conversationId: string) {
  return { params: Promise.resolve({ id: conversationId }) }
}

function modeRequest(mode: string): Request {
  return new Request('https://webchat.test/api/conversations/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
}

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

describe('taking a conversation over', () => {
  it('refuses to change the mode without a session', async () => {
    const seeded = await seedLineConversation({ mode: 'ai' })

    const response = await setMode(modeRequest('manual'), context(seeded.conversationId))

    expect(response.status).toBe(401)
    expect((await getConversation(seeded.conversationId))!.mode).toBe('ai')
  })

  it('lets an operator take over', async () => {
    signIn()
    const seeded = await seedLineConversation({ mode: 'ai' })

    const response = await setMode(modeRequest('manual'), context(seeded.conversationId))

    expect(response.status).toBe(200)
    expect((await getConversation(seeded.conversationId))!.mode).toBe('manual')
  })

  it('clears the handoff reason when the AI is handed the conversation back', async () => {
    signIn()
    const seeded = await seedLineConversation({ mode: 'ai' })

    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(
        { call: { name: 'handoff_to_human', args: { reason: 'Wants a refund.' } } },
        { say: 'เดี๋ยวพนักงานติดต่อกลับครับ' }
      ),
    })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'ขอเงินคืน' }))
    await flushAfter()

    expect((await getConversation(seeded.conversationId))!.handoff_reason).toBeTruthy()

    await setMode(modeRequest('ai'), context(seeded.conversationId))

    const conversation = await getConversation(seeded.conversationId)
    expect(conversation!.mode).toBe('ai')
    // The reason described a handover that is over; leaving it would keep
    // explaining a state the conversation is no longer in.
    expect(conversation!.handoff_reason).toBeNull()
  })

  it('rejects a mode it does not have', async () => {
    signIn()
    const seeded = await seedLineConversation({ mode: 'ai' })

    expect((await setMode(modeRequest('supervised'), context(seeded.conversationId))).status).toBe(400)
    expect((await getConversation(seeded.conversationId))!.mode).toBe('ai')
  })

  it('throws away the answer if the operator takes over mid-run', async () => {
    const seeded = await seedLineConversation({ mode: 'ai' })
    const model = openRouter({ say: 'the AI got there first' })

    // The fake runs at exactly the moment the model is being called, which is
    // the only window where this race actually exists.
    const takeOverWhileThinking: Handler = async (request) => {
      await setConversationMode(seeded.conversationId, 'manual')
      return model(request)
    }

    fakeFetch({ 'api.line.me': lineOk(), 'openrouter.ai': takeOverWhileThinking })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'เปิดกี่โมง' }))
    await flushAfter()

    expect(sentToLine()).toHaveLength(0)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
  })
})

describe('suggesting a reply', () => {
  it('refuses to draft without a session', async () => {
    const seeded = await seedLineConversation({ mode: 'manual' })

    expect((await suggest(new Request('https://webchat.test/s', { method: 'POST' }), context(seeded.conversationId))).status).toBe(401)
  })

  it('returns a draft without writing or sending anything', async () => {
    signIn()
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'เปิด 07:00–19:00 ทุกวันครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'เปิดกี่โมง' }))

    const response = await suggest(
      new Request('https://webchat.test/s', { method: 'POST' }),
      context(seeded.conversationId)
    )

    expect(response.status).toBe(200)
    expect((await response.json()).text).toBe('เปิด 07:00–19:00 ทุกวันครับ')

    // The operator has not pressed send, so nothing may have happened yet.
    expect(sentToLine()).toHaveLength(0)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
  })

  it('does not offer the agent a way to hand off to itself', async () => {
    signIn()
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'ครับผม' }),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'สวัสดี' }))

    await suggest(new Request('https://webchat.test/s', { method: 'POST' }), context(seeded.conversationId))

    // The operator is already the human a handoff would reach.
    expect(lastModelRequest().toolNames).toEqual(['search_faq'])
  })

  it('says what went wrong rather than silently producing nothing', async () => {
    signIn()
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouterFails(400, 'no credit'),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'สวัสดี' }))

    const response = await suggest(
      new Request('https://webchat.test/s', { method: 'POST' }),
      context(seeded.conversationId)
    )

    expect(response.status).toBe(502)
    expect((await response.json()).error).toContain('no credit')
  })
})
