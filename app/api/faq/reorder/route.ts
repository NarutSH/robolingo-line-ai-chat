import { requireOperator } from '@/lib/auth/session'
import { listFaqEntries, reorderFaqEntries } from '@/lib/data/faq-admin'

/**
 * The order the answers should sit in, top to bottom.
 *
 * `sort_order` decides only which answer wins when two score identically, which
 * is why it is edited as a position in a list rather than as a number in the
 * form — the number is meaningless on its own and only says anything relative to
 * its neighbours.
 *
 * The whole list is sent, not a pair of ids and a direction. The client already
 * knows the order it is showing; letting it say so outright means the server
 * never has to reconstruct an intent from a move.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(request: Request) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids : null

  if (!ids || ids.length === 0) {
    return Response.json({ error: 'Send the answers in the order you want them.' }, { status: 400 })
  }

  // Rejected rather than filtered out: dropping an unrecognisable id would
  // renumber the list as though that answer had been asked to move to the end.
  if (!ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    return Response.json({ error: 'That is not a list of answers.' }, { status: 400 })
  }

  if (new Set(ids).size !== ids.length) {
    return Response.json({ error: 'An answer cannot appear twice in the order.' }, { status: 400 })
  }

  try {
    await reorderFaqEntries(ids)
    return Response.json({ entries: await listFaqEntries() })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[faq] reorder failed', cause)
    return Response.json({ error: `Could not save the order: ${reason}` }, { status: 502 })
  }
}
