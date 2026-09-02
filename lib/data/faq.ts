import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'

export interface FaqMatch {
  question: string
  answer: string
  score: number
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
  return data ?? []
}
