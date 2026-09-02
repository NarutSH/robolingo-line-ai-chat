import { requireOperator } from '@/lib/auth/session'
import { getConversationTarget, markConversationRead } from '@/lib/data/conversations'
import { listMessages } from '@/lib/data/messages'
import { dispatchOutbound, OutboundFailed } from '@/lib/messaging/dispatch'
import { featureReady } from '@/lib/env'

export const maxDuration = 30

export async function GET(_request: Request, ctx: RouteContext<'/api/conversations/[id]/messages'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  try {
    const [messages] = await Promise.all([listMessages(id), markConversationRead(id)])
    return Response.json({ messages }, { headers: { 'cache-control': 'no-store' } })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[messages] load failed', cause)
    return Response.json({ error: `Could not load messages: ${reason}` }, { status: 502 })
  }
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
  if (conversation.channel === 'line' && !conversation.lineUserId) {
    return Response.json({ error: 'This conversation has no LINE recipient.' }, { status: 400 })
  }

  try {
    // No reply token: the operator is answering minutes after the inbound
    // webhook, so any token LINE issued is long dead. dispatchOutbound records
    // the row before sending, so a rejection stays visible in the thread.
    const result = await dispatchOutbound({ conversation, sender: 'operator', text })
    return Response.json({ id: result.messageId, via: result.via })
  } catch (cause) {
    if (cause instanceof OutboundFailed) {
      return Response.json(
        { error: `Could not deliver the message: ${cause.reason}`, id: cause.messageId },
        { status: 502 }
      )
    }
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[messages] send failed', cause)
    return Response.json({ error: `Could not send the message: ${reason}` }, { status: 502 })
  }
}
