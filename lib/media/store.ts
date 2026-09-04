import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

export const MEDIA_BUCKET = 'chat-media'

/** What LINE will accept as an image message, and therefore all we store. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number]

/**
 * Five megabytes. LINE's own ceiling for originalContentUrl is ten, and the
 * bucket enforces this number too — the check here exists so an oversized file
 * is refused with a sentence the operator can read, rather than a storage error.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export function isAcceptedImageType(type: string): type is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)
}

/**
 * Files are grouped by conversation so a conversation's pictures can be found
 * and removed together — the database cascades on delete and storage does not,
 * so without a predictable prefix the files would outlive the rows.
 */
export function conversationMediaPrefix(conversationId: string): string {
  return `conversations/${conversationId}`
}

export interface StoredMedia {
  /** Public URL, which is what LINE fetches and what the browser renders. */
  url: string
  path: string
}

/**
 * Puts an image in the bucket and hands back the URL anyone can fetch.
 *
 * Public rather than signed on purpose: LINE fetches originalContentUrl from
 * its own servers with none of our credentials, and a signed URL that expires
 * would turn a delivered message into a broken image days later.
 */
export async function storeImage(params: {
  conversationId: string
  bytes: ArrayBuffer | Uint8Array
  contentType: AcceptedImageType
}): Promise<StoredMedia> {
  const extension = params.contentType === 'image/png' ? 'png' : 'jpg'
  const path = `${conversationMediaPrefix(params.conversationId)}/${crypto.randomUUID()}.${extension}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, params.bytes, { contentType: params.contentType, upsert: false })

  if (error) throw new Error(`Could not store the image: ${error.message}`)

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

/** Removes every picture belonging to one conversation. Used by the test sweep. */
export async function removeConversationMedia(conversationId: string): Promise<void> {
  const supabase = createAdminClient()
  const prefix = conversationMediaPrefix(conversationId)
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(prefix)
  if (error || !data?.length) return
  await supabase.storage.from(MEDIA_BUCKET).remove(data.map((file) => `${prefix}/${file.name}`))
}
