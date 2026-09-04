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
 * Files are grouped by whatever owns them so a row's pictures can be found and
 * removed together — the database cascades on delete and storage does not, so
 * without a predictable prefix the files would outlive the rows.
 */
export function conversationMediaPrefix(conversationId: string): string {
  return `conversations/${conversationId}`
}

/** Pictures the shop publishes against an FAQ answer, kept apart from chat. */
export function faqMediaPrefix(entryId: string): string {
  return `faq/${entryId}`
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
  /** Where the file belongs — one of the prefix helpers above. */
  prefix: string
  bytes: ArrayBuffer | Uint8Array
  contentType: AcceptedImageType
}): Promise<StoredMedia> {
  const extension = params.contentType === 'image/png' ? 'png' : 'jpg'
  const path = `${params.prefix}/${crypto.randomUUID()}.${extension}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, params.bytes, { contentType: params.contentType, upsert: false })

  if (error) throw new Error(`Could not store the image: ${error.message}`)

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

/** The full paths of everything currently stored under one prefix. */
export async function listMediaUnder(prefix: string): Promise<string[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(prefix)
  if (error || !data?.length) return []
  return data.map((file) => `${prefix}/${file.name}`)
}

/** Removes exactly these files and nothing else. */
export async function removeMediaPaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await createAdminClient().storage.from(MEDIA_BUCKET).remove(paths)
}

/** Removes every picture under one prefix. Used when a row goes, and by the test sweep. */
export async function removeMediaUnder(prefix: string): Promise<void> {
  await removeMediaPaths(await listMediaUnder(prefix))
}
