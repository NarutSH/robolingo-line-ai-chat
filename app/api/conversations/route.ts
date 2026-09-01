import { requireOperator } from '@/lib/auth/session'
import { listConversations } from '@/lib/data/conversations'

export async function GET() {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const conversations = await listConversations()
    return Response.json({ conversations }, { headers: { 'cache-control': 'no-store' } })
  } catch (cause) {
    // Without this the request fails as a bodyless 500 and the UI can only say
    // "500" — which tells nobody whether the database is unreachable, the
    // schema is missing, or the key is wrong.
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[conversations] list failed', cause)
    return Response.json({ error: `Could not load conversations: ${reason}` }, { status: 502 })
  }
}
