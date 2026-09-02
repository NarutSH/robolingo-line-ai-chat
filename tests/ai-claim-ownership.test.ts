import { describe, expect, it } from 'vitest'
import { POST as webhook } from '@/app/api/line/webhook/route'
import { claimAiRun, setConversationMode } from '@/lib/data/conversations'
import { fakeFetch, type Handler } from './helpers/fetch-fake'
import { lineOk, sentToLine, signedWebhook } from './helpers/line'
import { openRouter } from './helpers/openrouter'
import { messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter } from './support/request-context'

describe('a run that no longer owns its conversation', () => {
  it('does not send after an operator took over and handed back mid-run', async () => {
    const seeded = await seedLineConversation({ mode: 'ai' })
    const model = openRouter({ say: 'stale run speaking' })

    // Everything that can happen while the model is thinking, staged at the one
    // moment it can actually happen: the operator takes over, changes their
    // mind and hands back, and the next message starts a run of its own.
    const churnWhileThinking: Handler = async (request) => {
      await setConversationMode(seeded.conversationId, 'manual')
      await setConversationMode(seeded.conversationId, 'ai')
      const newer = await claimAiRun(seeded.conversationId)
      expect(newer).not.toBeNull()
      return model(request)
    }

    fakeFetch({ 'api.line.me': lineOk(), 'openrouter.ai': churnWhileThinking })
    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'เปิดกี่โมง' }))
    await flushAfter()

    // The mode is back to 'ai', so checking only the mode would let this
    // through — and the newer run will answer the same question again.
    expect(sentToLine()).toHaveLength(0)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(1)
  })
})
