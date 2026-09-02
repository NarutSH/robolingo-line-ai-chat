import { requireOperator } from '@/lib/auth/session'
import { getConversationTarget, setConversationMode } from '@/lib/data/conversations'

/**
 * Taking a conversation over, or handing it back.
 *
 * Flipping to manual is how an operator interrupts the agent: a run already in
 * flight reads the mode again immediately before it sends, so the reply it was
 * about to make is discarded rather than landing on top of them.
 */
export async function PATCH(_request: Request, ctx: RouteContext<'/api/conversations/[id]'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const body = (await _request.json().catch(() => null)) as { mode?: string } | null

  if (body?.mode !== 'ai' && body?.mode !== 'manual') {
    return Response.json({ error: "Mode must be 'ai' or 'manual'." }, { status: 400 })
  }

  const conversation = await getConversationTarget(id)
  if (!conversation) return Response.json({ error: 'Conversation not found.' }, { status: 404 })

  try {
    await setConversationMode(id, body.mode)
    return Response.json({ id, mode: body.mode })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[conversations] mode change failed', cause)
    return Response.json({ error: `Could not change the mode: ${reason}` }, { status: 502 })
  }
}
