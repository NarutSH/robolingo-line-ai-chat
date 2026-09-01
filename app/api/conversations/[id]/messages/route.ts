import { requireOperator } from '@/lib/auth/session'
import { getConversationTarget, markConversationRead } from '@/lib/data/conversations'
import {
  createOutboundMessage, listMessages, markMessageFailed, markMessageSent, touchConversation,
} from '@/lib/data/messages'
import { sendToLine } from '@/lib/line/send'
import { featureReady } from '@/lib/env'

export const maxDuration = 30

export async function GET(_request: Request, ctx: RouteContext<'/api/conversations/[id]/messages'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  const [messages] = await Promise.all([listMessages(id), markConversationRead(id)])
  return Response.json({ messages }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request, ctx: RouteContext<'/api/conversations/[id]/messages'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!featureReady.line) {
    return Response.json({ error: 'LINE credentials are not configured.' }, { status: 503 })
  }

  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { text?: string } | null
  const text = body?.text?.trim()
  if (!text) return Response.json({ error: 'Message text is required.' }, { status: 400 })

  const conversation = await getConversationTarget(id)
  if (!conversation) return Response.json({ error: 'Conversation not found.' }, { status: 404 })
  if (!conversation.lineUserId) {
    return Response.json({ error: 'This conversation has no LINE recipient.' }, { status: 400 })
  }

  // Recorded before sending, so a failed send is visible in the thread rather
  // than disappearing into the logs.
  const messageId = await createOutboundMessage({ conversationId: id, sender: 'operator', content: text })

  try {
    // Always push: the operator is replying minutes after the inbound webhook,
    // so any reply token is long dead. The idempotency key stops a retried
    // request from double-sending.
    const result = await sendToLine({
      to: conversation.lineUserId,
      text,
      idempotencyKey: messageId,
    })
    await markMessageSent(messageId, result.lineMessageId)
    await touchConversation(id, text)
    return Response.json({ id: messageId, via: result.via })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await markMessageFailed(messageId, reason)
    return Response.json({ error: `LINE rejected the message: ${reason}`, id: messageId }, { status: 502 })
  }
}
