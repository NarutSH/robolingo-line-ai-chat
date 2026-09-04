import { describe, expect, it } from 'vitest'
import { GET as listConversationsRoute } from '@/app/api/conversations/route'
import { GET as readThread } from '@/app/api/conversations/[id]/messages/route'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import {
  handOffToHuman,
  setConversationMode,
  type ConversationSummary,
} from '@/lib/data/conversations'
import { conversationState } from '@/lib/types'
import { createAdminClient } from '@/lib/supabase/server'
import { seedLineConversation } from './helpers/db'
import { withCookie } from './support/request-context'

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

/** The list is ordered by recency within a group, so the clock has to be staged. */
async function setLastMessageAt(conversationId: string, iso: string): Promise<void> {
  await createAdminClient()
    .from('conversations')
    .update({ last_message_at: iso })
    .eq('id', conversationId)
}

async function inbox(): Promise<ConversationSummary[]> {
  const res = await listConversationsRoute()
  expect(res.status).toBe(200)
  return ((await res.json()) as { conversations: ConversationSummary[] }).conversations
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('knowing who is waiting for a person', () => {
  it('tells an escalation apart from a conversation someone chose to take', async () => {
    signIn()
    const escalated = await seedLineConversation({ mode: 'ai' })
    const takenOver = await seedLineConversation({ mode: 'ai' })

    await handOffToHuman(escalated.conversationId, 'ลูกค้าถามส่วนผสมที่ FAQ ไม่ได้ระบุ')
    await setConversationMode(takenOver.conversationId, 'manual')

    const listed = await inbox()
    const a = listed.find((c) => c.id === escalated.conversationId)!
    const b = listed.find((c) => c.id === takenOver.conversationId)!

    // Both are in manual. Only the reason distinguishes them, which is the whole
    // point: one is a queue of unanswered questions, the other is work in hand.
    expect(a.mode).toBe('manual')
    expect(b.mode).toBe('manual')
    expect(a.handoffReason).toBe('ลูกค้าถามส่วนผสมที่ FAQ ไม่ได้ระบุ')
    expect(a.handoffAt).not.toBeNull()
    expect(b.handoffReason).toBeNull()

    expect(conversationState(a)).toBe('escalated')
    expect(conversationState(b)).toBe('manual')
  })

  it('floats an old escalation above a conversation the AI is happily handling', async () => {
    signIn()
    const escalated = await seedLineConversation({ mode: 'ai' })
    const busy = await seedLineConversation({ mode: 'ai' })

    await handOffToHuman(escalated.conversationId, 'ขอคุยกับพนักงาน')
    // The escalation is an hour stale; the AI conversation just moved.
    await setLastMessageAt(escalated.conversationId, new Date(Date.now() - 3600_000).toISOString())
    await setLastMessageAt(busy.conversationId, new Date().toISOString())

    const listed = await inbox()
    const positions = listed.map((c) => c.id)
    expect(positions.indexOf(escalated.conversationId)).toBeLessThan(
      positions.indexOf(busy.conversationId)
    )
  })

  it('hands the reason back once the AI is answering again', async () => {
    signIn()
    const seeded = await seedLineConversation({ mode: 'ai' })
    await handOffToHuman(seeded.conversationId, 'ลูกค้ากำลังไม่พอใจ')
    await setConversationMode(seeded.conversationId, 'ai')

    const entry = (await inbox()).find((c) => c.id === seeded.conversationId)!
    expect(entry.handoffReason).toBeNull()
    expect(conversationState(entry)).toBe('ai')
  })

  it('shows the reason on the conversation itself, not only in the list', async () => {
    signIn()
    const seeded = await seedLineConversation({ mode: 'ai' })
    await handOffToHuman(seeded.conversationId, 'ต้องเช็คของในร้านก่อน')

    const res = await readThread(new Request('https://webchat.test/x'), params(seeded.conversationId))
    const json = (await res.json()) as { mode: string; handoffReason: string | null }

    expect(json.mode).toBe('manual')
    expect(json.handoffReason).toBe('ต้องเช็คของในร้านก่อน')
  })
})
