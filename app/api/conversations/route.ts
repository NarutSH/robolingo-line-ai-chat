import { requireOperator } from '@/lib/auth/session'
import { consoleRealtimeTopic, listConversations } from '@/lib/data/conversations'

export async function GET() {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // The topic is a capability: handed out only behind the operator check,
    // and unguessable, which is what stands in for a private channel here.
    const [conversations, realtimeTopic] = await Promise.all([
      listConversations(),
      consoleRealtimeTopic(),
    ])
    return Response.json(
      { conversations, realtimeTopic: realtimeTopic ? `console:${realtimeTopic}` : null },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (cause) {
    // Without this the request fails as a bodyless 500 and the UI can only say
    // "500" — which tells nobody whether the database is unreachable, the
    // schema is missing, or the key is wrong.
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[conversations] list failed', cause)
    return Response.json({ error: `Could not load conversations: ${reason}` }, { status: 502 })
  }
}
