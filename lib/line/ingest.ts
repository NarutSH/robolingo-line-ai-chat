import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export interface IngestResult {
  conversationId: string | null
  messageId: string | null
  contactId: string | null
  realtimeToken: string | null
  needsProfile: boolean
  isDuplicate: boolean
}

/**
 * One round trip that claims the webhook event, upserts the contact and
 * conversation, and records the message — atomically.
 *
 * This runs in the webhook's *request* phase, before the 200. If it ran inside
 * after() and the invocation were killed, LINE's redelivery would find no
 * record of the event and process the message a second time.
 */
export async function ingestLineMessage(params: {
  webhookEventId: string
  eventType: string
  isRedelivery: boolean
  lineUserId: string
  lineMessageId: string | null
  content: string
  contentType: string
  quotedLineMessageId: string | null
  replyToken: string | null
  raw: unknown
}): Promise<IngestResult> {
  const supabase = createAdminClient()

  // Supabase's type generator marks every `text` argument as non-nullable, but
  // the function genuinely accepts NULL for the optional ones: a sticker has no
  // text id, and a plain (non-quote) reply has no quoted id. Casting at the call
  // site rather than loosening the database signature to satisfy the generator.
  type IngestArgs = Database['public']['Functions']['ingest_line_message']['Args']

  const args = {
    p_webhook_event_id: params.webhookEventId,
    p_event_type: params.eventType,
    p_is_redelivery: params.isRedelivery,
    p_line_user_id: params.lineUserId,
    p_line_message_id: params.lineMessageId,
    p_content: params.content,
    p_content_type: params.contentType,
    p_quoted_line_message_id: params.quotedLineMessageId,
    p_reply_token: params.replyToken,
    p_raw: params.raw as never,
  }

  const { data, error } = await supabase.rpc(
    'ingest_line_message',
    args as unknown as IngestArgs
  )

  if (error) throw new Error(`ingest_line_message failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    // The function returns no row only if a duplicate arrived before any
    // conversation existed. Treat it as handled rather than retrying.
    return {
      conversationId: null, messageId: null, contactId: null,
      realtimeToken: null, needsProfile: false, isDuplicate: true,
    }
  }

  return {
    conversationId: row.conversation_id ?? null,
    messageId: row.message_id ?? null,
    contactId: row.contact_id ?? null,
    realtimeToken: row.realtime_token ?? null,
    needsProfile: Boolean(row.needs_profile),
    isDuplicate: Boolean(row.is_duplicate),
  }
}
