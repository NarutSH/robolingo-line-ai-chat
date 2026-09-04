import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { conversationState, type ConversationState } from '@/lib/types'

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
  /**
   * Why the agent stepped back, when it was the agent that did. Null on a
   * conversation an operator simply took over — which is how the two are told
   * apart, since both leave the conversation in `manual`.
   */
  handoffReason: string | null
  handoffAt: string | null
}

/**
 * Supabase types an embedded one-to-one join as either the row or an array of
 * them depending on how it infers the relationship, so both readers have to
 * cope with both shapes. Doing it in one place keeps the two in step.
 */
type EmbeddedContact = {
  line_user_id?: string | null
  display_name?: string | null
  picture_url?: string | null
  is_friend?: boolean | null
}

function contactFields(embedded: EmbeddedContact | EmbeddedContact[] | null) {
  const contact = Array.isArray(embedded) ? embedded[0] : embedded
  return {
    displayName: contact?.display_name ?? null,
    pictureUrl: contact?.picture_url ?? null,
    lineUserId: contact?.line_user_id ?? null,
    isFriend: contact?.is_friend ?? false,
  }
}

/** The inbox list: who has written in, most recent first. */
export async function listConversations(): Promise<ConversationSummary[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, channel, mode, unread_count, last_message_at, last_message_preview, handoff_reason, handoff_at, line_users(line_user_id, display_name, picture_url, is_friend)'
    )
    .order('last_message_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)

  const summaries: ConversationSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    channel: row.channel,
    mode: row.mode,
    ...contactFields(row.line_users),
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    handoffReason: row.handoff_reason,
    handoffAt: row.handoff_at,
  }))

  /**
   * Recency alone buries the people who are actually waiting: a question the
   * agent gave up on an hour ago sinks under a conversation the agent is
   * happily handling right now. So the queue leads with what needs a person,
   * and recency orders within each group.
   *
   * Sorted here rather than in SQL because the ordering is over a derived state
   * rather than a column, and a hundred rows is nothing. The query still asks
   * for the hundred most recent, so this reorders that window rather than
   * paging through the table.
   */
  const rank: Record<ConversationState, number> = { escalated: 0, manual: 1, ai: 2 }
  return summaries.sort((a, b) => {
    const byState = rank[conversationState(a)] - rank[conversationState(b)]
    if (byState !== 0) return byState
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })
}

export async function getConversationTarget(conversationId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(
      'id, channel, mode, realtime_token, handoff_reason, line_users(line_user_id, display_name, picture_url, is_friend)'
    )
    .eq('id', conversationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    id: data.id,
    channel: data.channel,
    mode: data.mode,
    realtimeToken: data.realtime_token,
    handoffReason: data.handoff_reason,
    ...contactFields(data.line_users),
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

export interface RunState {
  mode: 'ai' | 'manual' | null
  /** False once a newer run has taken the claim this one was holding. */
  ownsRun: boolean
}

/**
 * Read immediately before sending. Two questions, one round trip: is the AI
 * still the one answering, and is *this* run still the one doing it.
 *
 * Ownership is the load-bearing half. Handing a conversation back to the AI
 * resets its status, so a run that was in flight while an operator took over
 * and changed their mind would find the mode back at `ai` and answer — while a
 * newer run, started by the next message, answers the same question again.
 * Checking the claim closes that: a run that no longer holds its own claim has
 * been superseded and has nothing left to say.
 */
export async function readRunState(conversationId: string, runId: string): Promise<RunState> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('conversations')
    .select('mode, ai_run_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return { mode: data?.mode ?? null, ownsRun: data?.ai_run_id === runId }
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
export async function getOrCreateWebConversation(webSessionId: string): Promise<ConversationTarget> {
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

/** The minimum an outbound message needs to know about where it is going. */
export interface ConversationTarget {
  id: string
  channel: 'line' | 'web'
  mode: 'ai' | 'manual'
  lineUserId: string | null
}

/**
 * The shared topic the inbox listens on. Stored in the database rather than the
 * environment so it travels with the schema and cannot drift between deploys.
 */
export async function consoleRealtimeTopic(): Promise<string | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'console_realtime_topic')
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data?.value ?? null
}
