import { requireOperator } from '@/lib/auth/session'
import { getFaqEntry, setFaqEntryImage } from '@/lib/data/faq-admin'
import {
  faqMediaPrefix,
  isAcceptedImageType,
  listMediaUnder,
  MAX_IMAGE_BYTES,
  removeMediaPaths,
  removeMediaUnder,
  storeImage,
} from '@/lib/media/store'

export const maxDuration = 30

/**
 * Attaching the picture that answers a question — the menu board, most obviously.
 *
 * The entry must already have a name, because the name is the only handle the
 * agent gets: `search_faq` tells it a picture exists and `show_image` takes that
 * name and nothing else. A picture on a nameless entry would be a file the bot
 * could never ask for.
 *
 * The previous picture is removed after the new URL is saved, not before. If the
 * removal fails the row still points at something that works, which is the right
 * way round: a stale file in a bucket costs pennies, a broken image in a
 * customer's chat costs the answer.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/faq/[id]/image'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  const entry = await getFaqEntry(id)
  if (!entry) return Response.json({ error: 'That answer no longer exists.' }, { status: 404 })

  if (!entry.slug) {
    return Response.json(
      { error: 'Give this answer a name first — it is how the bot asks for the picture.' },
      { status: 400 }
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File)) {
    return Response.json({ error: 'No image was attached.' }, { status: 400 })
  }
  if (!isAcceptedImageType(file.type)) {
    return Response.json({ error: 'LINE accepts JPEG and PNG images only.' }, { status: 415 })
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json(
      { error: `That image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.` },
      { status: 413 }
    )
  }

  try {
    // Listed *before* the upload, so the sweep below cannot take the new file
    // with it — everything under this prefix would otherwise include the
    // picture that was just saved.
    const superseded = await listMediaUnder(faqMediaPrefix(id))

    const stored = await storeImage({
      prefix: faqMediaPrefix(id),
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    })
    await setFaqEntryImage(id, stored.url)

    // After the row points at the new file, never before: a removal that fails
    // leaves litter in a bucket, whereas the other order leaves a broken image
    // in a customer's chat.
    await removeMediaPaths(superseded).catch(() => {})

    return Response.json({ id, imageUrl: stored.url })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[faq] image upload failed', cause)
    return Response.json({ error: `Could not save the picture: ${reason}` }, { status: 502 })
  }
}

/** Taking the picture off an answer. The words stay; only the image goes. */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/faq/[id]/image'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await ctx.params
  if (!(await getFaqEntry(id))) {
    return Response.json({ error: 'That answer no longer exists.' }, { status: 404 })
  }

  await setFaqEntryImage(id, null)
  await removeMediaUnder(faqMediaPrefix(id))
  return Response.json({ id, imageUrl: null })
}
