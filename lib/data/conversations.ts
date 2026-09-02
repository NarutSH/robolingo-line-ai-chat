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

/**
 * Takes the conversation for one AI run, or returns null if someone else has it.
 *
 * A single UPDATE with these conditions is atomic: a second webhook arriving at
 * the same moment blocks on the row lock, re-reads the row, sees `running` and
 * matches nothing. That is what stops two runs answering one question twice.
 *
 * The staleness window matters as much as the claim. A run killed mid-flight —
 * a deploy, a timeout — would otherwise leave `running` set forever and the
 * conversation permanently mute, which is a far worse failure than the double
 * reply this guards against.
 *
 * `error` is claimable for the same reason. A previous run failing says nothing
 * about this one, and the customer who just wrote in is waiting: refusing to
 * try again would turn one bad model call into a silent conversation.
 */
const STALE_RUN_MS = 2 * 60 * 1000

export async function claimAiRun(conversationId: string): Promise<string | null> {
  const supabase = createAdminClient()
  const runId = crypto.randomUUID()
  const staleBefore = new Date(Date.now() - STALE_RUN_MS).toISOString()

  const { data, error } = await supabase
    .from('conversations')
    .update({
      ai_status: 'running',
      ai_run_id: runId,
      ai_started_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('mode', 'ai')
    .or(`ai_status.eq.idle,ai_status.eq.error,ai_started_at.lt.${staleBefore}`)
    .select('id')

  if (error) throw new Error(`claimAiRun failed: ${error.message}`)
  return data && data.length > 0 ? runId : null
}

/** Guarded by the run id so a stale run cannot clear a newer claim. */
export async function releaseAiRun(
  conversationId: string,
  runId: string,
  status: 'idle' | 'error'
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('conversations')
    .update({ ai_status: status, ai_run_id: null })
    .eq('id', conversationId)
    .eq('ai_run_id', runId)
}

/** Read immediately before sending, so an operator taking over is honoured. */
export async function getConversationMode(
  conversationId: string
): Promise<'ai' | 'manual' | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('mode')
    .eq('id', conversationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data?.mode ?? null
}

/**
 * The agent stepping back. Flips the conversation to a human and records why,
 * so the shop can see what the FAQ is failing to cover.
 *
 * The mode change is what makes it stick: the AI will not claim this
 * conversation again until an operator hands it back.
 */
export async function handOffToHuman(conversationId: string, reason: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversations')
    .update({
      mode: 'manual',
      handoff_reason: reason.slice(0, 300),
      handoff_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  if (error) throw new Error(`handOffToHuman failed: ${error.message}`)
}

/** Handing back: the AI resumes, and the old reason no longer applies. */
export async function setConversationMode(
  conversationId: string,
  mode: 'ai' | 'manual'
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('conversations')
    .update(
      mode === 'ai'
        ? { mode, handoff_reason: null, handoff_at: null, ai_status: 'idle' as const }
        : { mode }
    )
    .eq('id', conversationId)
  if (error) throw new Error(`setConversationMode failed: ${error.message}`)
}

/**
 * The conversation belonging to a browser, created on their first message.
 *
 * The unique index on `web_session_id` is what makes this safe under a
 * double-click: the second insert loses the race, and the select that follows
 * finds what the first one wrote.
 */
export async function getOrCreateWebConversation(webSessionId: string): Promise<DispatchableConversation> {
  const supabase = createAdminClient()

  const existing = await supabase
    .from('conversations')
    .select('id, channel, mode')
    .eq('web_session_id', webSessionId)
    .maybeSingle()

  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) return { ...existing.data, lineUserId: null }

  const created = await supabase
    .from('conversations')
    .insert({ channel: 'web', web_session_id: webSessionId })
    .select('id, channel, mode')
    .single()

  if (!created.error) return { ...created.data, lineUserId: null }

  // Lost the race against another tab; whoever won has already created it.
  const raced = await supabase
    .from('conversations')
    .select('id, channel, mode')
    .eq('web_session_id', webSessionId)
    .maybeSingle()

  if (raced.data) return { ...raced.data, lineUserId: null }
  throw new Error(`getOrCreateWebConversation failed: ${created.error.message}`)
}

export interface DispatchableConversation {
  id: string
  channel: 'line' | 'web'
  mode: 'ai' | 'manual'
  lineUserId: string | null
}
