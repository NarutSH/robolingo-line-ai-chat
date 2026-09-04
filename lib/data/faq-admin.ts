import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { faqMediaPrefix, removeMediaUnder } from '@/lib/media/store'

/**
 * Editing what the shop knows.
 *
 * Separate from `lib/data/faq.ts` on purpose: that module is the agent's read
 * path and is deliberately tiny, and mixing the console's writes into it would
 * make the one thing the agent depends on the busiest file in the codebase.
 */
export interface FaqEntry {
  id: string
  question: string
  answer: string
  tags: string[]
  slug: string | null
  imageUrl: string | null
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

export interface FaqEntryInput {
  question: string
  answer: string
  tags: string[]
  slug: string | null
  isActive: boolean
  sortOrder: number
}

type Row = {
  id: string
  question: string
  answer: string
  tags: string[]
  slug: string | null
  image_url: string | null
  is_active: boolean
  sort_order: number
  updated_at: string
}

function toEntry(row: Row): FaqEntry {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    tags: row.tags ?? [],
    slug: row.slug,
    imageUrl: row.image_url,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  }
}

const COLUMNS = 'id, question, answer, tags, slug, image_url, is_active, sort_order, updated_at'

/** Everything, active or not — the console is where an inactive entry is brought back. */
export async function listFaqEntries(): Promise<FaqEntry[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('faq_entries')
    .select(COLUMNS)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw new Error(`listFaqEntries failed: ${error.message}`)
  return (data ?? []).map(toEntry)
}

export async function getFaqEntry(id: string): Promise<FaqEntry | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('faq_entries').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(`getFaqEntry failed: ${error.message}`)
  return data ? toEntry(data) : null
}

export async function createFaqEntry(input: FaqEntryInput): Promise<FaqEntry> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('faq_entries')
    .insert({
      question: input.question,
      answer: input.answer,
      tags: input.tags,
      slug: input.slug,
      is_active: input.isActive,
      sort_order: input.sortOrder,
    })
    .select(COLUMNS)
    .single()

  if (error) throw new Error(error.message)
  return toEntry(data)
}

export async function updateFaqEntry(id: string, input: FaqEntryInput): Promise<FaqEntry | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('faq_entries')
    .update({
      question: input.question,
      answer: input.answer,
      tags: input.tags,
      slug: input.slug,
      is_active: input.isActive,
      sort_order: input.sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? toEntry(data) : null
}

export async function setFaqEntryImage(id: string, imageUrl: string | null): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('faq_entries')
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Deleting the row takes its picture with it. Storage does not cascade, so
 * without this the file would sit in the bucket for the life of the project
 * with nothing left that knows what it was for.
 */
export async function deleteFaqEntry(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.from('faq_entries').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await removeMediaUnder(faqMediaPrefix(id))
}
