import 'server-only'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { faqImage, searchFaq } from '@/lib/data/faq'
import { handOffToHuman } from '@/lib/data/conversations'
import { recordSystemNote } from '@/lib/data/messages'

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
      return matches
        .map((m) => {
          const picture =
            m.hasImage && m.slug
              ? `\nA picture goes with this answer. To send it, call show_image with image="${m.slug}".`
              : ''
          return `Q: ${m.question}\nA: ${m.answer}${picture}`
        })
        .join('\n\n')
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

/**
 * Sending the customer a picture the shop has published.
 *
 * The agent chooses *whether* a picture helps; it cannot choose *which*. The
 * only argument is a slug search_faq just handed it, and the URL is read from
 * the row rather than passed in — so the same rule that stops the agent
 * inventing an opening time stops it inventing a picture, by construction.
 *
 * Nothing is sent from inside the tool. The caller sends it after the written
 * reply, because a picture arriving before the sentence that introduces it
 * reads as a non sequitur.
 */
export function showImageTool(options: {
  onShowImage: (image: { url: string; question: string }) => void
}) {
  return tool(
    async ({ image }) => {
      const found = await faqImage(image)
      if (!found) {
        return (
          `The shop has published no picture called "${image}". ` +
          'Answer in words instead, and do not tell the customer a picture is coming.'
        )
      }

      options.onShowImage(found)

      return (
        'The picture will be sent straight after your reply. Say in one short ' +
        'sentence that you are sending it. You have not seen it, so do not ' +
        'describe what is in it and do not repeat its contents as fact.'
      )
    },
    {
      name: 'show_image',
      description:
        'Send the customer a picture the shop has published for an FAQ answer — ' +
        'the menu, for instance. Only call this with an image name that search_faq ' +
        'has just told you exists. Use it when seeing the thing would answer the ' +
        'question better than describing it.',
      schema: z.object({
        image: z
          .string()
          .describe('The image name search_faq gave you, exactly as written, e.g. "menu"'),
      }),
    }
  )
}

/**
 * The agent stepping back rather than guessing.
 *
 * The writes happen here, in the tool, rather than being inferred afterwards
 * from the agent's output: by the time the run ends, the decision has already
 * been made and there is nothing to interpret.
 *
 * `onHandoff` tells the caller this run handed over, which is what lets the
 * acknowledgement through while an ordinary reply would be suppressed.
 */
export function handoffTool(options: { conversationId: string; onHandoff: (reason: string) => void }) {
  return tool(
    async ({ reason }) => {
      await handOffToHuman(options.conversationId, reason)
      await recordSystemNote(options.conversationId, `ส่งต่อให้พนักงาน — ${reason}`)
      options.onHandoff(reason)

      // The customer must not be left in silence wondering whether anyone heard
      // them, so the model is told to acknowledge — briefly, and without having
      // another go at the question it just admitted it could not answer.
      return (
        'Handed over to a member of staff. Reply once, briefly, telling the ' +
        "customer that a member of staff will follow up shortly. Do not attempt " +
        'to answer their question and do not promise a time.'
      )
    },
    {
      name: 'handoff_to_human',
      description:
        'Hand the conversation to a member of staff. Call this when search_faq ' +
        'returns nothing that answers the question, when the customer asks to ' +
        'speak to a person, when they are complaining or upset, or when they want ' +
        'something only a person can do — change an order, check something in the ' +
        'shop, resolve a problem. Prefer this over any answer you are unsure of.',
      schema: z.object({
        reason: z
          .string()
          .describe(
            'One short sentence, for the staff member picking this up, saying what ' +
              'the customer needs and why you could not answer it.'
          ),
      }),
    }
  )
}
