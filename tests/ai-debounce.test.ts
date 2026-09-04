import { describe, expect, it } from 'vitest'
import { POST as webhook } from '@/app/api/line/webhook/route'
import { POST as sendFromWidget } from '@/app/api/chat/messages/route'
import { fakeFetch } from './helpers/fetch-fake'
import { lineOk, newTestEventId, sentToLine, signedWebhook } from './helpers/line'
import { modelCalls, lastModelRequest, openRouter } from './helpers/openrouter'
import { messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter } from './support/request-context'

/**
 * The wait itself is set to zero for the suite (see tests/support/load-env.ts).
 * What is under test is the decision the wait exists to enable: three webhooks
 * record their messages, and only then do the runs go looking to see whether
 * they are still the newest. That is the same ordering the real pause produces,
 * without spending four seconds a test to watch a timer run down.
 */
function visitorMessage(text: string): Request {
  return new Request('https://webchat.test/api/chat/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

describe('a customer who sends their question in pieces', () => {
  it('answers all of it once, not each piece separately', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'เปิด 07:00–19:00 และมีที่จอดรถ 4 คันครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    // Three messages land before any run gets to speak, which is what the
    // pause makes true in production.
    for (const text of ['ขอถามหน่อยครับ', 'ร้านเปิดกี่โมง', 'แล้วมีที่จอดรถไหม']) {
      await webhook(
        signedWebhook({
          userId: seeded.lineUserId,
          text,
          eventId: newTestEventId(),
          messageId: `m-${text}`,
        })
      )
    }
    await flushAfter()

    // One reply, not three.
    const sent = sentToLine()
    expect(sent).toHaveLength(1)
    expect(sent[0].text).toBe('เปิด 07:00–19:00 และมีที่จอดรถ 4 คันครับ')

    // And one model run: the two earlier runs stood down before spending money.
    expect(modelCalls()).toBe(1)

    const messages = await messagesIn(seeded.conversationId)
    expect(messages.filter((m) => m.direction === 'inbound')).toHaveLength(3)
    expect(messages.filter((m) => m.direction === 'outbound')).toHaveLength(1)
  })

  it('shows the model everything the customer said, in order', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'ได้ครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    for (const text of ['อันแรก', 'อันที่สอง']) {
      await webhook(
        signedWebhook({
          userId: seeded.lineUserId,
          text,
          eventId: newTestEventId(),
          messageId: `m-${text}`,
        })
      )
    }
    await flushAfter()

    const asked = lastModelRequest().messages.filter((m) => m.role === 'user')
    expect(asked.map((m) => m.content)).toEqual(['อันแรก', 'อันที่สอง'])
  })

  it('still answers a customer who only says one thing', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'สวัสดีครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'สวัสดี' }))
    await flushAfter()

    expect(sentToLine()).toHaveLength(1)
    expect(modelCalls()).toBe(1)
  })

  it('batches the same way for a web visitor', async () => {
    fakeFetch({ 'openrouter.ai': openRouter({ say: 'รับทราบทั้งสองข้อครับ' }) })

    await sendFromWidget(visitorMessage('ข้อแรก'))
    const second = await sendFromWidget(visitorMessage('ข้อสอง'))
    expect(second.status).toBe(200)

    await flushAfter()

    expect(modelCalls()).toBe(1)
  })
})
