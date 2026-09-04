import { createAdminClient } from '@/lib/supabase/server'
import { removeConversationMedia } from '@/lib/media/store'
import { newTestUserId, TEST_EVENT_PREFIX, TEST_USER_PREFIX } from './line'

/**
 * Pictures live in a bucket, and a bucket does not cascade. So the files have to
 * be found before the rows that name them are gone — after the delete there is
 * nothing left to say which conversations were ours.
 */
async function sweepMediaFor(conversationIds: string[]): Promise<void> {
  await Promise.all(conversationIds.map((id) => removeConversationMedia(id)))
}

/**
 * Tests share the one cloud project with the demo data, so isolation is by
 * convention: every test contact is minted under a reserved prefix and removed
 * by cascade. The sweep also runs before the suite, so a crashed run cannot
 * leave rows sitting in the inbox a reviewer will open.
 */
export async function sweepTestData(): Promise<void> {
  const supabase = createAdminClient()

  const { data: doomed } = await supabase
    .from('conversations')
    .select('id, line_users!inner(line_user_id)')
    .like('line_users.line_user_id', `${TEST_USER_PREFIX}%`)
  await sweepMediaFor((doomed ?? []).map((row) => row.id))

  await supabase.from('line_users').delete().like('line_user_id', `${TEST_USER_PREFIX}%`)
  await supabase.from('line_webhook_events').delete().like('webhook_event_id', `${TEST_EVENT_PREFIX}%`)
}

/**
 * Anonymous web conversations, removed by the session ids the routes minted.
 * Cascade takes their messages with them.
 */
export async function sweepVisitorConversations(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return
  const supabase = createAdminClient()

  const { data: doomed } = await supabase
    .from('conversations')
    .select('id')
    .in('web_session_id', sessionIds)
  await sweepMediaFor((doomed ?? []).map((row) => row.id))

  await supabase.from('conversations').delete().in('web_session_id', sessionIds)
}

export interface SeededConversation {
  lineUserId: string
  contactId: string
  conversationId: string
}

/** A LINE contact and their conversation, ready to receive messages. */
export async function seedLineConversation(
  options: { mode?: 'ai' | 'manual'; displayName?: string; lineUserId?: string } = {}
): Promise<SeededConversation> {
  const supabase = createAdminClient()
  const lineUserId = options.lineUserId ?? newTestUserId()

  const { data: contact, error: contactError } = await supabase
    .from('line_users')
    .insert({
      line_user_id: lineUserId,
      display_name: options.displayName ?? 'Seeded Contact',
      profile_fetched_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (contactError) throw new Error(`seed contact failed: ${contactError.message}`)

  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .insert({ channel: 'line', line_user_id: contact.id, mode: options.mode ?? 'manual' })
    .select('id')
    .single()
  if (conversationError) throw new Error(`seed conversation failed: ${conversationError.message}`)

  return { lineUserId, contactId: contact.id, conversationId: conversation.id }
}

export async function getConversation(conversationId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/** Oldest first, so assertions read in the order the conversation happened. */
export async function messagesIn(conversationId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

/** Finds the conversation the webhook created for a contact it had never seen. */
export async function conversationForLineUser(lineUserId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('*, line_users!inner(line_user_id)')
    .eq('line_users.line_user_id', lineUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
