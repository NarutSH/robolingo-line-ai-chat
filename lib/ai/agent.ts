import 'server-only'
import { createAgent } from 'langchain'
import { chatModel } from '@/lib/ai/model'
import { searchFaqTool } from '@/lib/ai/tools'

export const SHOP_NAME = 'บ้านกาแฟ (Baan Kafae)'

/**
 * The rules the shop would give a new member of staff on their first shift.
 *
 * The language instruction is first because it is the one a customer notices
 * immediately, and the grounding rule is stated as a prohibition rather than a
 * preference: a plausible invented price is worse for the shop than an admission
 * of not knowing, because they may be held to it.
 */
const SYSTEM_PROMPT = `You are the customer support assistant for ${SHOP_NAME}, a single-branch coffee shop in Bangkok. You are answering customers in a chat window.

Reply in the same language the customer wrote in. If they write Thai, answer in natural, polite Thai. If they write English, answer in English. Never translate their question back at them or announce which language you are using.

Everything you know about the shop comes from the search_faq tool. Call it for any question about the shop before answering, passing the customer's message through in their own words.

Never state an opening time, address, price, promotion, menu item, or policy that did not come back from search_faq. If the tool returns nothing, say plainly that you are not sure and that a member of staff will follow up — do not guess, and do not offer a "typically" or "usually" answer. An invented price is worse than an admission of not knowing, because the shop can be held to it.

Keep replies short: this is a chat, not a brochure. One or two sentences is usually right, and never more than four. No greeting preamble on every message, no bullet lists, no markdown — plain text only, because the chat renders none of it.

You may answer ordinary conversational messages — a greeting, a thank-you — without calling the tool. For anything about the shop, the tool comes first.`

/**
 * `createAgent` returns a compiled LangGraph state graph. No checkpointer is
 * configured on purpose: conversation state lives in Postgres and is loaded
 * fresh for each run, so there is no second copy to keep in step.
 */
export function supportAgent() {
  return createAgent({
    model: chatModel(),
    tools: [searchFaqTool()],
    systemPrompt: SYSTEM_PROMPT,
  })
}

/**
 * Each ReAct step costs two nodes — call the model, run its tools — so this
 * allows roughly three tool rounds and a final answer. A support question that
 * needs more than that has gone wrong, and the cap stops a tool loop from
 * running unbounded on the shop's account.
 */
export const AGENT_RECURSION_LIMIT = 8
