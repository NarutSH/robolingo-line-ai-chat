import { requireOperator } from '@/lib/auth/session'
import { draftReply } from '@/lib/ai/respond'
import { featureReady } from '@/lib/env'

/** The model can be slow; the operator is watching a spinner while it thinks. */
export const maxDuration = 30

/**
 * Returns a draft for the operator's composer. Writes no message and sends
 * nothing — pressing send stays the operator's decision.
 */
export async function POST(_request: Request, ctx: RouteContext<'/api/conversations/[id]/suggest'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!featureReady.ai) {
    return Response.json({ error: 'The AI is not configured on this deployment.' }, { status: 503 })
  }

  const { id } = await ctx.params
  const result = await draftReply(id)

  if (result.outcome === 'sent' && result.text) {
    return Response.json({ text: result.text })
  }
  if (result.outcome === 'skipped') {
    return Response.json({ error: `No draft: ${result.reason}` }, { status: 409 })
  }
  return Response.json({ error: `Could not draft a reply: ${result.reason}` }, { status: 502 })
}
