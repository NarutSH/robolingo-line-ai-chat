import { createAdminClient } from '@/lib/supabase/server'
import { newTestUserId, TEST_EVENT_PREFIX, TEST_USER_PREFIX } from './line'

/**
 * Tests share the one cloud project with the demo data, so isolation is by
 * convention: every test contact is minted under a reserved prefix and removed
 * by cascade. The sweep also runs before the suite, so a crashed run cannot
 * leave rows sitting in the inbox a reviewer will open.
 */
export async function sweepTestData(): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('line_users').delete().like('line_user_id', `${TEST_USER_PREFIX}%`)
  await supabase.from('line_webhook_events').delete().like('webhook_event_id', `${TEST_EVENT_PREFIX}%`)
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
