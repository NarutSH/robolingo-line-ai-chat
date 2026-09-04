/** Mirrors the `message_sender` enum in supabase/migrations/0001_init.sql. */
export type MessageSender = 'line_user' | 'web_visitor' | 'operator' | 'ai' | 'system'

export type DeliveryStatus = 'queued' | 'sent' | 'failed'

export interface ChatMessage {
  id: string
  conversationId: string
  sender: MessageSender
  content: string
  contentType: string
  createdAt: string
  deliveryStatus: DeliveryStatus
  /**
   * Why a send failed, when one did. Recorded already; surfaced so the operator
   * can tell a transient failure from one that retrying will not fix.
   */
  failureReason?: string | null
  /**
   * The picture this message carries, when it carries one. `contentType` says
   * whether to expect it; `content` stays readable words either way.
   */
  mediaUrl?: string | null
}

/**
 * Who owes a conversation a reply, and why.
 *
 * `escalated` and `manual` both mean a person has it, but they are not the same
 * queue: one is a question the agent could not answer and nobody has picked up,
 * the other is a conversation someone already chose to handle. Collapsing them
 * loses the distinction that decides what to open first.
 *
 * Lives here rather than beside the queries because the console reads it in the
 * browser, and the data module is server-only.
 */
export type ConversationState = 'escalated' | 'manual' | 'ai'

export function conversationState(conversation: {
  mode: 'ai' | 'manual'
  handoffReason: string | null
}): ConversationState {
  if (conversation.mode === 'ai') return 'ai'
  return conversation.handoffReason ? 'escalated' : 'manual'
}
