import 'server-only'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { AGENT_RECURSION_LIMIT, supportAgent } from '@/lib/ai/agent'
import {
  claimAiRun,
  readRunState,
  getConversationTarget,
  releaseAiRun,
} from '@/lib/data/conversations'
import { latestInboundMessageId, listMessages } from '@/lib/data/messages'
import { dispatchOutbound } from '@/lib/messaging/dispatch'
import { env, featureReady } from '@/lib/env'
import type { ChatMessage } from '@/lib/types'

/** Enough for the agent to follow a short exchange without re-reading a whole history. */
const HISTORY_LIMIT = 20

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  /** The customer kept typing; a later run will answer all of it at once. */
  | 'batched'
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
 * The last AI message *that actually said something*.
 *
 * Two things are being avoided. Taking the tail of the transcript would hand a
 * raw tool result to the customer, which they would read. And taking merely the
 * last AI message loses the reply whenever the run ends on an empty one — a
 * model that writes its sentence in the same turn as a tool call, then closes
 * with nothing, is common enough that it silently cost a customer their answer
 * in production. Skipping the empty tail finds the sentence that was written.
 */
function finalReplyText(messages: BaseMessage[]): string {
  const produced = messages.findLast(
    (message) => message.getType() === 'ai' && typeof message.text === 'string' && message.text.trim()
  )
  return produced ? String(produced.text).trim() : ''
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
  /**
   * The message that started this run. Given it, the run can tell whether the
   * customer has said anything since — which is what makes waiting useful
   * rather than merely slow.
   */
  triggeredByMessageId?: string | null
  replyToken?: string | null
  replyTokenIssuedAt?: Date | string | null
}): Promise<RespondResult> {
  if (!featureReady.ai) return { outcome: 'skipped', reason: 'no OpenRouter key configured' }

  const conversation = await getConversationTarget(params.conversationId)
  if (!conversation) return { outcome: 'skipped', reason: 'conversation not found' }
  if (conversation.mode !== 'ai') return { outcome: 'skipped', reason: 'conversation is manual' }

  /**
   * Wait for the customer to stop typing, then decide whether this run is still
   * the one that should speak.
   *
   * People send a thought in pieces — "ขอถามหน่อย", "ร้านเปิดกี่โมง", "แล้วมีที่จอดรถไหม" —
   * and answering the first piece alone answers a third of the question. So
   * every run pauses, and then only the run belonging to the *newest* message
   * carries on; the earlier ones stand down. The survivor reads the whole
   * history a moment later, so the three messages become one answer without
   * anything having to stitch them together.
   *
   * This happens before the claim rather than after. Claiming first would let
   * the first message hold the conversation and turn every message behind it
   * into a `busy` that never gets answered, which is the failure this replaces.
   */
  if (params.triggeredByMessageId) {
    if (env.AI_DEBOUNCE_MS > 0) await sleep(env.AI_DEBOUNCE_MS)

    const newest = await latestInboundMessageId(params.conversationId)
    if (newest && newest !== params.triggeredByMessageId) {
      return { outcome: 'batched', reason: 'the customer sent something newer' }
    }
  }

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
    const agent = await supportAgent({
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
    const image = requested.image

    // A picture the agent asked for is an intention it stated out loud, so a
    // silent model must not cancel it. Without this the customer who asked to
    // see the menu got nothing at all: no words, and no picture either.
    const caption = text || (image ? 'ส่งรูปให้ดูนะครับ' : '')

    if (!caption) {
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
      text: caption,
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
    return { outcome: handedOff ? 'handed-off' : 'sent', text: caption }
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
    const drafting = await supportAgent({ conversationId })
    const result = await drafting.invoke(
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
