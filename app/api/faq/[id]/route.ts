import { requireOperator } from '@/lib/auth/session'
import { deleteFaqEntry, getFaqEntry, updateFaqEntry } from '@/lib/data/faq-admin'
import { faqEntrySchema } from '@/lib/data/faq-input'

export async function PATCH(request: Request, ctx: RouteContext<'/api/faq/[id]'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const parsed = faqEntrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const existing = await getFaqEntry(id)
  if (!existing) return Response.json({ error: 'That answer no longer exists.' }, { status: 404 })

  // The slug is how the agent asks for the picture. Taking it away while a
  // picture is attached would leave the file reachable by nothing, so it is
  // refused here rather than silently orphaning it.
  if (existing.imageUrl && !parsed.data.slug) {
    return Response.json(
      { error: 'This answer has a picture, so it needs a name the bot can ask for.' },
      { status: 400 }
    )
  }

  try {
    const entry = await updateFaqEntry(id, parsed.data)
    return Response.json({ entry })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    if (reason.includes('faq_entries_slug_key')) {
      return Response.json({ error: 'Another answer already uses that name.' }, { status: 409 })
    }
    console.error('[faq] update failed', cause)
    return Response.json({ error: `Could not save the answer: ${reason}` }, { status: 502 })
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<'/api/faq/[id]'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!(await getFaqEntry(id))) {
    return Response.json({ error: 'That answer no longer exists.' }, { status: 404 })
  }

  try {
    await deleteFaqEntry(id)
    return Response.json({ id })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[faq] delete failed', cause)
    return Response.json({ error: `Could not delete the answer: ${reason}` }, { status: 502 })
  }
}
