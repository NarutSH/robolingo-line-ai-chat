import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

export interface FaqMatch {
  /**
   * Which row answered. The agent has no use for it -- it is handed the words
   * and the slug -- but the training board runs this same lookup and has to be
   * able to point at the answer that won, and matching on the question text
   * would break the moment two answers were worded alike.
   */
  id: string
  question: string
  answer: string
  score: number
  /** A stable handle for entries the shop has published a picture against. */
  slug: string | null
  hasImage: boolean
}

/**
 * The shop's answers, looked up by whatever the customer actually typed.
 *
 * Matching runs backwards -- each entry's tags are tested for being inside the
 * question, rather than the question being split into words -- because Thai is
 * written without spaces and nothing in core Postgres can segment it. The
 * migration that defines `search_faq` explains this at length.
 *
 * Returns an empty list rather than everything when nothing matches, which is
 * what lets the agent tell the difference between "here is the answer" and
 * "this is not something the shop has told me about".
 */
export async function searchFaq(query: string, limit = 4): Promise<FaqMatch[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('search_faq', { p_query: trimmed, p_limit: limit })

  if (error) throw new Error(`search_faq failed: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    score: row.score,
    slug: row.slug,
    hasImage: row.has_image,
  }))
}

/**
 * The picture the shop published against one entry, or null.
 *
 * Looked up by slug rather than handed out by search_faq so the agent has to
 * name something it was just shown. Same rule as every other fact about the
 * shop: it can only pass on what the lookup returned.
 */
export async function faqImage(slug: string): Promise<{ url: string; question: string } | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('faq_entries')
    .select('question, image_url')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (error) throw new Error(`faq image lookup failed: ${error.message}`)
  if (!data?.image_url) return null
  return { url: data.image_url, question: data.question }
}
