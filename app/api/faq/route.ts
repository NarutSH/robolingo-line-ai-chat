import { requireOperator } from '@/lib/auth/session'
import { createFaqEntry, listFaqEntries } from '@/lib/data/faq-admin'
import { faqEntrySchema } from '@/lib/data/faq-input'

/**
 * What the shop has taught the bot.
 *
 * Everything the agent can say comes from this table, so this is the one screen
 * where changing the bot's answers does not need a deploy. Operator-only, like
 * the rest of the console: these rows are what customers are told.
 */
export async function GET() {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return Response.json(
      { entries: await listFaqEntries() },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[faq] list failed', cause)
    return Response.json({ error: `Could not load the answers: ${reason}` }, { status: 502 })
  }
}

export async function POST(request: Request) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = faqEntrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    return Response.json({ entry: await createFaqEntry(parsed.data) }, { status: 201 })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    // A duplicate slug is the one failure an operator can fix themselves, so it
    // is named rather than reported as a generic write error.
    if (reason.includes('faq_entries_slug_key')) {
      return Response.json({ error: 'Another answer already uses that name.' }, { status: 409 })
    }
    console.error('[faq] create failed', cause)
    return Response.json({ error: `Could not save the answer: ${reason}` }, { status: 502 })
  }
}
