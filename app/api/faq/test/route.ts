import { requireOperator } from '@/lib/auth/session'
import { searchFaq } from '@/lib/data/faq'

/**
 * What the bot would find, asked the way a customer would ask it.
 *
 * This calls the same `searchFaq` the agent's tool calls, rather than scoring in
 * TypeScript from the entries the console already has. A second implementation
 * of the ranking would drift from the SQL within a release, and a training
 * screen whose test box disagrees with production is worse than no test box —
 * the operator would tune against the copy.
 *
 * It writes nothing and sends nothing. Nobody is messaged by pressing this.
 */
export async function POST(request: Request) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null
  const query = typeof body?.query === 'string' ? body.query : ''

  if (!query.trim()) {
    return Response.json({ error: 'Type a question to test.' }, { status: 400 })
  }

  try {
    // Ten is the ceiling search_faq enforces anyway. The agent asks for four
    // because a model reading more than that starts blending them; a person
    // looking at the list wants to see the near misses, which are exactly the
    // answers a tag is about to steal from.
    return Response.json(
      { matches: await searchFaq(query, 10) },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[faq] test failed', cause)
    return Response.json({ error: `Could not run the test: ${reason}` }, { status: 502 })
  }
}
