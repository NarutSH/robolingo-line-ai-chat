import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/line/webhook/route'
import { claimAiRun } from '@/lib/data/conversations'
import { fakeFetch } from './helpers/fetch-fake'
import { lineOk, sentToLine, signedWebhook } from './helpers/line'
import { lastModelRequest, modelCalls, openRouter, openRouterFails } from './helpers/openrouter'
import { getConversation, messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter } from './support/request-context'

describe('the AI answering on LINE', () => {
  it('answers the customer and records what it said', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'ร้านเปิด 07:00–19:00 ทุกวันครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    const response = await POST(signedWebhook({ userId: seeded.lineUserId, text: 'เปิดกี่โมง' }))
    await flushAfter()

    expect(response.status).toBe(200)

    const messages = await messagesIn(seeded.conversationId)
    expect(messages).toHaveLength(2)
    expect(messages[1].sender).toBe('ai')
    expect(messages[1].direction).toBe('outbound')
    expect(messages[1].content).toBe('ร้านเปิด 07:00–19:00 ทุกวันครับ')
    expect(messages[1].delivery_status).toBe('sent')

    const sent = sentToLine()
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toBe('ร้านเปิด 07:00–19:00 ทุกวันครับ')
    // The run starts seconds after the webhook, inside after(), so the reply
    // token is still alive — which costs no push quota.
    expect(sent[0].via).toBe('reply')
  })

  it('consults the FAQ before it answers', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(
        { call: { name: 'search_faq', args: { question: 'มีที่จอดรถไหม' } } },
        { say: 'มีที่จอดรถหน้าร้าน 4 คันครับ' }
      ),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'มีที่จอดรถไหม' }))
    await flushAfter()

    // Two round trips: ask for the tool, then answer with what came back.
    expect(modelCalls()).toBe(2)

    const toolResults = lastModelRequest().messages.filter((m) => m.role === 'tool')
    expect(toolResults).toHaveLength(1)
    expect(String(toolResults[0].content)).toContain('4 คัน')

    expect(sentToLine()[0].text).toBe('มีที่จอดรถหน้าร้าน 4 คันครับ')
  })

  it('says nothing on a conversation a human is handling', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'this should never be sent' }),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })

    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ขอคุยกับพนักงาน' }))
    await flushAfter()

    expect(modelCalls()).toBe(0)
    expect(sentToLine()).toHaveLength(0)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
  })

  it('leaves a failed run visible instead of sending something broken', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouterFails(400, 'no credit'),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    const response = await POST(signedWebhook({ userId: seeded.lineUserId, text: 'สวัสดี' }))
    await flushAfter()

    // The customer's message still arrived; only the answer failed.
    expect(response.status).toBe(200)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
    expect(sentToLine()).toHaveLength(0)

    const conversation = await getConversation(seeded.conversationId)
    expect(conversation!.ai_status).toBe('error')
  })

  it('recovers on the next message after a failed run', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouterFails(400, 'no credit'),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })
    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ครั้งแรก' }))
    await flushAfter()

    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'ได้ครับ' }),
    })
    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ครั้งที่สอง' }))
    await flushAfter()

    // One bad model call must not silence the conversation until the stale
    // window expires — the customer is still waiting.
    expect(sentToLine()).toHaveLength(1)
    expect(sentToLine()[0].text).toBe('ได้ครับ')
  })

  /**
   * Below the route seam on purpose: two webhooks arriving at the same instant
   * cannot be staged through sequential handler calls, and this claim is the one
   * thing standing between the customer and two answers to one question. Like
   * the FAQ ranking, the guarantee lives in the database.
   */
  it('lets only one run claim a conversation at a time', async () => {
    const seeded = await seedLineConversation({ mode: 'ai' })

    const claims = await Promise.all([
      claimAiRun(seeded.conversationId),
      claimAiRun(seeded.conversationId),
      claimAiRun(seeded.conversationId),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('will not claim a conversation a human is handling', async () => {
    const seeded = await seedLineConversation({ mode: 'manual' })

    expect(await claimAiRun(seeded.conversationId)).toBeNull()
  })
})
