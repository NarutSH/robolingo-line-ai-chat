import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { env } from '@/lib/env'
import { MEDIA_BUCKET } from '@/lib/media/store'

/**
 * The browser key can reach nothing.
 *
 * Every table in this schema has RLS on and not one policy, so the secret key on
 * the server is the only way a row is ever read or written. That is a fact about
 * the database rather than about any code here, which is exactly why it needs a
 * test: nothing in the repo would break if someone added a permissive policy to
 * get something working locally, or if a future migration created a table and
 * forgot the `enable row level security` line. The suite would stay green and
 * the inbox would quietly become world-readable.
 *
 * So this asserts the property directly, with the key the browser actually
 * holds. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is in the client bundle and in
 * every visitor's devtools; treat it here as what it is, a public string.
 *
 * A new table belongs in this list. An empty list passing is not a pass.
 */
const TABLES = [
  'conversations',
  'messages',
  'line_users',
  'faq_entries',
  'line_webhook_events',
  'app_config',
] as const

/** Deliberately not `createAdminClient()`: the whole point is the other key. */
const asVisitor = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } }
)

describe('what the key in the browser can reach', () => {
  it.each(TABLES)('reads no rows from %s', async (table) => {
    const { data, error } = await asVisitor.from(table).select('*').limit(50)

    // Not an error: with no policy, the rows are simply not visible. An empty
    // result is what a locked table looks like from outside.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it.each(TABLES)('writes no rows to %s', async (table) => {
    const { error } = await asVisitor.from(table).insert({} as never)

    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/row-level security|violates|denied/i)
  })

  it('cannot ask the FAQ what the shop knows', async () => {
    // search_faq is `security definer`, so its grant is the only thing standing
    // between a visitor and every answer plus the ranking behind them.
    const { error } = await asVisitor.rpc('search_faq', { p_query: 'wifi' })

    expect(error?.message).toMatch(/permission denied/i)
  })

  it('cannot enumerate the media bucket', async () => {
    // The bucket is public *read by URL*, because LINE fetches an image from its
    // own servers holding none of our credentials. Public reads of a known URL
    // is not the same as being allowed to ask what is in there: the paths are
    // uuids, and listing them would turn every customer's photo into a crawl.
    const { data } = await asVisitor.storage.from(MEDIA_BUCKET).list('faq')

    expect(data ?? []).toEqual([])
  })

  it('cannot put a file in the media bucket', async () => {
    const { error } = await asVisitor.storage
      .from(MEDIA_BUCKET)
      .upload(`faq/${crypto.randomUUID()}.png`, new Blob([new Uint8Array([1])]), {
        contentType: 'image/png',
      })

    expect(error).not.toBeNull()
  })
})
