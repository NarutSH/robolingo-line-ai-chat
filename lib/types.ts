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
}
