import 'server-only'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { AGENT_RECURSION_LIMIT, supportAgent } from '@/lib/ai/agent'
import {
  claimAiRun,
  readRunState,
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
  /** A newer run holds the claim; this one has nothing left to say. */
  | 'superseded'
  /** The agent stepped back; a member of staff has the conversation now. */
  | 'handed-off'
  /** A draft for the operator. Nothing was written and nothing was sent. */
  | 'drafted'
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
 * The last *AI* message, not simply the last one. Taking the tail would hand a
 * raw tool result to the customer if the transcript ever ended on one — a
 * mistake they would read, so it is worth being explicit about.
 */
function finalReplyText(messages: BaseMessage[]): string {
  const produced = messages.findLast((message) => message.getType() === 'ai')
  return typeof produced?.text === 'string' ? produced.text.trim() : ''
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
    // Held on an object rather than in a bare `let`: the assignment happens in
    // a callback, and control-flow analysis would otherwise narrow the variable
    // to null at every point after it.
    const requested: { image: { url: string; question: string } | null } = { image: null }
    const agent = supportAgent({
      conversationId: params.conversationId,
      onHandoff: (reason) => {
        handoffReason = reason
      },
      onShowImage: (image) => {
        requested.image = image
      },
    })

    const result = await agent.invoke(
      { messages: history },
      { recursionLimit: AGENT_RECURSION_LIMIT }
    )

    const text = finalReplyText(result.messages)

    if (!text) {
      await releaseAiRun(params.conversationId, runId, 'idle')
      return { outcome: 'skipped', reason: 'the model produced no text' }
    }

    // Checked as late as possible, because both of these can change while the
    // model is thinking.
    const handedOff = handoffReason !== null
    const state = await readRunState(params.conversationId, runId)

    // Someone else holds the claim now, so this run has been superseded and
    // whatever it was about to say is a duplicate of what they will say.
    if (!state.ownsRun) {
      return { outcome: 'superseded' }
    }

    // An operator who took over has already decided they are handling this, and
    // a reply landing on top of them is worse than no reply at all. A handoff
    // also leaves the conversation manual, but that one is ours: the customer
    // still needs to hear that someone is coming, or being handed over reads to
    // them as being ignored.
    if (!handedOff && state.mode !== 'ai') {
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

    // After the sentence that introduces it, never before: a picture arriving
    // first reads as a non sequitur. No reply token is passed, because the one
    // above has just consumed it — this goes out as a push, which is correct
    // and is what dispatchOutbound would fall back to anyway.
    //
    // A picture that fails to send must not take the written answer down with
    // it. The answer is already delivered; the customer keeps it, the failed
    // row stays visible in the console, and an operator can resend.
    const image = requested.image
    if (image) {
      try {
        await dispatchOutbound({
          conversation,
          sender: 'ai',
          text: `[image] ${image.question}`,
          imageUrl: image.url,
        })
      } catch (cause) {
        console.error('[ai] the reply went out but its picture did not', cause)
      }
    }

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

    const text = finalReplyText(result.messages)
    if (!text) return { outcome: 'skipped', reason: 'the model produced no text' }

    return { outcome: 'drafted', text }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[ai] draft failed', cause)
    return { outcome: 'failed', reason }
  }
}
