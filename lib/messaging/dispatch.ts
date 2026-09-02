import 'server-only'
import {
  createOutboundMessage,
  markMessageFailed,
  markMessageSent,
  touchConversation,
} from '@/lib/data/messages'
import { sendToLine } from '@/lib/line/send'

/**
 * Every outbound message takes this path, whoever wrote it.
 *
 * The order is the point: the row is recorded *before* the send, so a message
 * LINE rejects stays visible in the thread instead of disappearing into the
 * logs. The operator can see it failed and why, and resend.
 *
 * Delivery is chosen by the conversation's channel. A web conversation has
 * nothing to call out to — the row is the delivery, and the visitor's page
 * reads it — so it is marked sent as soon as it is written.
 */

export type OutboundSender = 'operator' | 'ai' | 'system'

export interface DispatchTarget {
  id: string
  channel: 'line' | 'web'
  lineUserId: string | null
}

export interface DispatchResult {
  messageId: string
  via: 'reply' | 'push' | 'web'
  lineMessageId?: string
}

/** Carries the message id so the caller can tell the client which row failed. */
export class OutboundFailed extends Error {
  constructor(
    readonly messageId: string,
    readonly reason: string
  ) {
    super(reason)
    this.name = 'OutboundFailed'
  }
}

export async function dispatchOutbound(params: {
  conversation: DispatchTarget
  sender: OutboundSender
  text: string
  /** Present only for a reply generated in the seconds after an inbound webhook. */
  replyToken?: string | null
  replyTokenIssuedAt?: Date | string | null
}): Promise<DispatchResult> {
  const { conversation, sender, text } = params

  if (conversation.channel === 'line' && !conversation.lineUserId) {
    throw new Error('This conversation has no LINE recipient.')
  }

  const messageId = await createOutboundMessage({
    conversationId: conversation.id,
    sender,
    content: text,
  })

  try {
    if (conversation.channel === 'web') {
      await markMessageSent(messageId)
      await touchConversation(conversation.id, text)
      return { messageId, via: 'web' }
    }

    const result = await sendToLine({
      to: conversation.lineUserId!,
      text,
      replyToken: params.replyToken,
      replyTokenIssuedAt: params.replyTokenIssuedAt,
      // The row id doubles as X-Line-Retry-Key, so a retried request cannot
      // double-send: it is unique per message and already at hand.
      idempotencyKey: messageId,
    })

    await markMessageSent(messageId, result.lineMessageId)
    await touchConversation(conversation.id, text)
    return { messageId, via: result.via, lineMessageId: result.lineMessageId }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    await markMessageFailed(messageId, reason)
    throw new OutboundFailed(messageId, reason)
  }
}
