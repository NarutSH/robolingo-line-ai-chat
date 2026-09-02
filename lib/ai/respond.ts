import 'server-only'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { AGENT_RECURSION_LIMIT, supportAgent } from '@/lib/ai/agent'
import {
  claimAiRun,
  getConversationMode,
  getConversationTarget,
  releaseAiRun,
} from '@/lib/data/conversations'
import { listMessages } from '@/lib/data/messages'
import { dispatchOutbound } from '@/lib/messaging/dispatch'
import { featureReady } from '@/lib/env'
import type { ChatMessage } from '@/lib/types'

/** Enough for the agent to follow a short exchange without re-reading a whole history. */
const HISTORY_LIMIT = 20

export type RespondOutcome =
  | 'sent'
  /** Not configured, not in AI mode, or nothing to reply to. */
  | 'skipped'
  /** Another run already holds this conversation. */
  | 'busy'
  /** An operator took over while the model was thinking. */
  | 'taken-over'
  /** The agent stepped back; a member of staff has the conversation now. */
  | 'handed-off'
  | 'failed'

export interface RespondResult {
  outcome: RespondOutcome
  text?: string
  reason?: string
}

/**
 * The customer's side is Human; ours is AI whoever typed it. An operator's
 * message is, from the model's point of view, something "we" already said —
 * collapsing the two keeps the thread readable as one conversation instead of
 * a transcript with two voices on the same side.
 *
 * `system` messages are the console's own notes (a handoff reason, say) and are
 * not part of what the customer was told, so they are left out.
 */
function toModelHistory(messages: ChatMessage[]): BaseMessage[] {
  return messages.flatMap((message): BaseMessage[] => {
    if (message.sender === 'line_user' || message.sender === 'web_visitor') {
      return [new HumanMessage(message.content)]
    }
    if (message.sender === 'ai' || message.sender === 'operator') {
      return [new AIMessage(message.content)]
    }
    return []
  })
}

/**
 * Answer the latest message on a conversation, if it is ours to answer.
 *
 * Runs inside after(), so the LINE 200 has already gone back before any of this
 * starts. Every early return is a deliberate refusal to speak: not configured,
 * a human is handling it, or another run got there first.
 */
export async function respondWithAi(params: {
  conversationId: string
  replyToken?: string | null
  replyTokenIssuedAt?: Date | string | null
}): Promise<RespondResult> {
  if (!featureReady.ai) return { outcome: 'skipped', reason: 'no OpenRouter key configured' }

  const conversation = await getConversationTarget(params.conversationId)
  if (!conversation) return { outcome: 'skipped', reason: 'conversation not found' }
  if (conversation.mode !== 'ai') return { outcome: 'skipped', reason: 'conversation is manual' }

  const runId = await claimAiRun(params.conversationId)
  if (!runId) return { outcome: 'busy' }

  try {
    const history = toModelHistory(await listMessages(params.conversationId, HISTORY_LIMIT))
    if (history.length === 0) {
      await releaseAiRun(params.conversationId, runId, 'idle')
      return { outcome: 'skipped', reason: 'nothing to reply to' }
    }

    let handoffReason: string | null = null
    const agent = supportAgent({
      conversationId: params.conversationId,
      onHandoff: (reason) => {
        handoffReason = reason
      },
    })

    const result = await agent.invoke(
      { messages: history },
      { recursionLimit: AGENT_RECURSION_LIMIT }
    )

    // The last *AI* message, not simply the last one. Taking the tail would
    // send a raw tool result to the customer if the transcript ever ended on
    // one — a mistake they would read, so it is worth being explicit about.
    const produced = result.messages.findLast((message) => message.getType() === 'ai')
    const text = typeof produced?.text === 'string' ? produced.text.trim() : ''

    if (!text) {
      await releaseAiRun(params.conversationId, runId, 'idle')
      return { outcome: 'skipped', reason: 'the model produced no text' }
    }

    // Checked as late as possible. An operator who took over while the model was
    // thinking has already decided they are handling this, and a reply landing
    // on top of them is worse than no reply at all.
    //
    // A handoff also leaves the conversation manual, but that one is ours: the
    // customer still needs to hear that someone is coming, or the handover
    // reads to them as being ignored.
    const handedOff = handoffReason !== null
    if (!handedOff && (await getConversationMode(params.conversationId)) !== 'ai') {
      await releaseAiRun(params.conversationId, runId, 'idle')
      return { outcome: 'taken-over' }
    }

    await dispatchOutbound({
      conversation,
      sender: 'ai',
      text,
      // The run started seconds ago inside after(), so the reply token is very
      // likely still alive — which spends no push quota. sendToLine falls back
      // to a push on its own if it is not.
      replyToken: params.replyToken,
      replyTokenIssuedAt: params.replyTokenIssuedAt,
    })

    await releaseAiRun(params.conversationId, runId, 'idle')
    return { outcome: handedOff ? 'handed-off' : 'sent', text }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[ai] run failed', cause)
    // Left as `error` rather than `idle`: the console can show that the agent
    // tried and could not, instead of the conversation looking simply ignored.
    await releaseAiRun(params.conversationId, runId, 'error')
    return { outcome: 'failed', reason }
  }
}

/**
 * A draft for the operator, from the same agent that would have answered.
 *
 * Writes nothing and sends nothing: the operator reads it, edits it or throws
 * it away, and presses send themselves. That is the whole point — it speeds up
 * the typing without moving the accountability.
 *
 * No claim is taken. Nothing is persisted, so two drafts racing cost a little
 * money and nothing else. The handoff tool is not offered either: the operator
 * is already the human it would hand to.
 */
export async function draftReply(conversationId: string): Promise<RespondResult> {
  if (!featureReady.ai) return { outcome: 'skipped', reason: 'no OpenRouter key configured' }

  const history = toModelHistory(await listMessages(conversationId, HISTORY_LIMIT))
  if (history.length === 0) return { outcome: 'skipped', reason: 'nothing to reply to' }

  try {
    const result = await supportAgent({ conversationId }).invoke(
      { messages: history },
      { recursionLimit: AGENT_RECURSION_LIMIT }
    )

    const produced = result.messages.findLast((message) => message.getType() === 'ai')
    const text = typeof produced?.text === 'string' ? produced.text.trim() : ''
    if (!text) return { outcome: 'skipped', reason: 'the model produced no text' }

    return { outcome: 'sent', text }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[ai] draft failed', cause)
    return { outcome: 'failed', reason }
  }
}
