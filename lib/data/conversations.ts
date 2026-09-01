import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

export interface ConversationSummary {
  id: string
  channel: 'line' | 'web'
  mode: 'ai' | 'manual'
  displayName: string | null
  pictureUrl: string | null
  lineUserId: string | null
  isFriend: boolean
  unreadCount: number
  lastMessageAt: string
  lastMessagePreview: string | null
}

/** The inbox list: who has written in, most recent first. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, channel, mode, unread_count, last_message_at, last_message_preview, line_users(line_user_id, display_name, picture_url, is_friend)'
    )
    .order('last_message_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)

  return (data ?? []).map((row) => {
    const contact = Array.isArray(row.line_users) ? row.line_users[0] : row.line_users
    return {
      id: row.id,
      channel: row.channel,
      mode: row.mode,
      displayName: contact?.display_name ?? null,
      pictureUrl: contact?.picture_url ?? null,
      lineUserId: contact?.line_user_id ?? null,
      isFriend: contact?.is_friend ?? false,
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at,
      lastMessagePreview: row.last_message_preview,
    }
  })
}

export async function getConversationTarget(conversationId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('id, channel, mode, realtime_token, line_users(line_user_id, display_name, picture_url, is_friend)')
    .eq('id', conversationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  const contact = Array.isArray(data.line_users) ? data.line_users[0] : data.line_users
  return {
    id: data.id,
    channel: data.channel,
    mode: data.mode,
    realtimeToken: data.realtime_token,
    lineUserId: contact?.line_user_id ?? null,
    displayName: contact?.display_name ?? null,
    pictureUrl: contact?.picture_url ?? null,
    isFriend: contact?.is_friend ?? false,
  }
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
}
