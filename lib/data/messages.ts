import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { ChatMessage } from '@/lib/types'

export async function listMessages(conversationId: string, limit = 100): Promise<ChatMessage[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, sender, content, content_type, created_at, delivery_status')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      sender: row.sender,
      content: row.content,
      contentType: row.content_type,
      createdAt: row.created_at,
      deliveryStatus: (row.delivery_status ?? 'sent') as ChatMessage['deliveryStatus'],
    }))
    .reverse()
}

/** Records the outbound message before it is sent, so a send failure is visible in the UI. */
export async function createOutboundMessage(params: {
  conversationId: string
  sender: 'operator' | 'ai' | 'system'
  content: string
}): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: params.conversationId,
      direction: 'outbound',
      sender: params.sender,
      content_type: 'text',
      content: params.content,
      delivery_status: 'queued',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data.id
}

export async function markMessageSent(messageId: string, lineMessageId?: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('messages')
    .update({ delivery_status: 'sent', line_message_id: lineMessageId ?? null })
    .eq('id', messageId)
}

export async function markMessageFailed(messageId: string, reason: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('messages')
    .update({ delivery_status: 'failed', delivery_error: reason.slice(0, 500) })
    .eq('id', messageId)
}

export async function touchConversation(conversationId: string, preview: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: preview.replace(/\s+/g, ' ').slice(0, 120),
    })
    .eq('id', conversationId)
}

/**
 * A note from the system rather than from anyone in the conversation — why the
 * AI stepped back, say. It is written into the thread so the operator picking
 * it up sees the reason in place, rather than having to look somewhere else.
 *
 * Marked sent because nothing is delivered: the note exists for the console.
 */
export async function recordSystemNote(conversationId: string, content: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    sender: 'system',
    content_type: 'text',
    content,
    delivery_status: 'sent',
  })
  if (error) throw new Error(error.message)
}

/**
 * A message from a web visitor: inbound, like a LINE message, but with no LINE.
 *
 * The unread count is raised here because `ingest_line_message` does it for the
 * LINE side, and a web conversation that always read as zero would quietly tell
 * the operator that nobody was waiting.
 */
export async function recordVisitorMessage(
  conversationId: string,
  content: string
): Promise<string> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction: 'inbound',
      sender: 'web_visitor',
      content_type: 'text',
      content,
      delivery_status: 'sent',
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)

  // Deliberately not fatal: the message is already recorded, and losing it
  // because a counter did not move would be the worse trade. But it is logged
  // rather than swallowed — a stuck count reads to the operator as "nobody is
  // waiting", which is the opposite of the truth.
  const bumped = await supabase.rpc('bump_unread', { p_conversation_id: conversationId })
  if (bumped.error) {
    console.error('[messages] unread count not bumped', bumped.error.message)
  }

  return data.id
}
