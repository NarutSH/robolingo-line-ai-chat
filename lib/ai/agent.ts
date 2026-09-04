import 'server-only'
import { createAgent } from 'langchain'
import { chatModel } from '@/lib/ai/model'
import { handoffTool, searchFaqTool, showImageTool } from '@/lib/ai/tools'
import { composeSystemPrompt } from '@/lib/ai/persona'
import { readAssistantVoice } from '@/lib/data/assistant'

/**
 * `createAgent` returns a compiled LangGraph state graph. No checkpointer is
 * configured on purpose: conversation state lives in Postgres and is loaded
 * fresh for each run, so there is no second copy to keep in step.
 */
export interface SupportAgentOptions {
  conversationId: string
  /**
   * Called when the agent hands over. Omit it and the handoff tool is not
   * offered at all — which is what the operator's draft button wants, since the
   * operator is already the human it would be handing to.
   */
  onHandoff?: (reason: string) => void
  /**
   * Called when the agent wants a published picture sent. Omit it and the tool
   * is not offered — the draft button writes nothing and sends nothing, so an
   * agent promising a picture there would be promising something no one is
   * going to deliver.
   */
  onShowImage?: (image: { url: string; question: string }) => void
}

/**
 * Async because the prompt is data now: who the assistant is and the rules it
 * works under are both edited from the console, so they are read per run rather
 * than compiled in. One small select against a six-row table, next to the
 * several this run already makes.
 */
export async function supportAgent(options: SupportAgentOptions) {
  const { onHandoff, onShowImage } = options
  const tools = [
    searchFaqTool(),
    ...(onHandoff ? [handoffTool({ conversationId: options.conversationId, onHandoff })] : []),
    ...(onShowImage ? [showImageTool({ onShowImage })] : []),
  ]

  return createAgent({
    model: chatModel(),
    tools,
    systemPrompt: composeSystemPrompt(await readAssistantVoice()),
  })
}

/**
 * Each ReAct step costs two nodes — call the model, run its tools — so this
 * allows roughly three tool rounds and a final answer. A support question that
 * needs more than that has gone wrong, and the cap stops a tool loop from
 * running unbounded on the shop's account.
 */
export const AGENT_RECURSION_LIMIT = 8
