import { describe, expect, it } from 'vitest'
import { POST } from '@/app/api/line/webhook/route'
import { clearCalls, fakeFetch } from './helpers/fetch-fake'
import { lineOk, sentToLine, signedWebhook } from './helpers/line'
import { openRouter } from './helpers/openrouter'
import { getConversation, messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter } from './support/request-context'

const HANDOFF = {
  call: { name: 'handoff_to_human', args: { reason: 'Asked about a lost wallet; not in the FAQ.' } },
}

describe('the AI handing over to a person', () => {
  it('flips the conversation to a human and records why', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(HANDOFF, { say: 'เดี๋ยวพนักงานติดต่อกลับนะครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ลืมกระเป๋าไว้ที่ร้าน' }))
    await flushAfter()

    const conversation = await getConversation(seeded.conversationId)
    expect(conversation!.mode).toBe('manual')
    expect(conversation!.handoff_reason).toContain('lost wallet')
    expect(conversation!.handoff_at).toBeTruthy()
  })

  it('leaves a note in the thread saying why it stepped back', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(HANDOFF, { say: 'เดี๋ยวพนักงานติดต่อกลับนะครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ลืมกระเป๋าไว้ที่ร้าน' }))
    await flushAfter()

    const notes = (await messagesIn(seeded.conversationId)).filter((m) => m.sender === 'system')
    expect(notes).toHaveLength(1)
    expect(notes[0].content).toContain('lost wallet')
  })

  it('still tells the customer someone is coming', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(HANDOFF, { say: 'เดี๋ยวพนักงานติดต่อกลับนะครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ลืมกระเป๋าไว้ที่ร้าน' }))
    await flushAfter()

    // Silence would read to the customer as being ignored, which is the thing
    // the handoff exists to avoid.
    const sent = sentToLine()
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toBe('เดี๋ยวพนักงานติดต่อกลับนะครับ')
  })

  it('stays quiet on everything the customer sends afterwards', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(HANDOFF, { say: 'เดี๋ยวพนักงานติดต่อกลับนะครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })
    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ลืมกระเป๋าไว้ที่ร้าน' }))
    await flushAfter()

    clearCalls()
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'this must never be sent' }),
    })
    await POST(signedWebhook({ userId: seeded.lineUserId, text: 'ยังอยู่ไหมครับ' }))
    await flushAfter()

    expect(sentToLine()).toHaveLength(0)
  })
})
