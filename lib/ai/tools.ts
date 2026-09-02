import 'server-only'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { searchFaq } from '@/lib/data/faq'

/**
 * What the agent is allowed to reach for.
 *
 * Deliberately small. Everything the shop knows arrives through search_faq, so
 * an answer the agent cannot source is an answer it should not give.
 */
export function searchFaqTool() {
  return tool(
    async ({ question }) => {
      const matches = await searchFaq(question)
      if (matches.length === 0) {
        return 'No FAQ entry covers this. The shop has not published an answer to it.'
      }
      return matches.map((m) => `Q: ${m.question}\nA: ${m.answer}`).join('\n\n')
    },
    {
      name: 'search_faq',
      description:
        "Look up what the shop has published about a customer's question — opening " +
        'hours, location, parking, wifi, menu, prices, payment, bookings, pets, ' +
        'delivery, beans, working space, catering. Pass the customer message ' +
        'through as-is, in their own language. Returns nothing when the shop has ' +
        'published no answer, which means you do not know.',
      schema: z.object({
        question: z.string().describe("The customer's question, in their own words"),
      }),
    }
  )
}
