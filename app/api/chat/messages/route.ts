import { after } from 'next/server'
import { cookies } from 'next/headers'
import {
  currentVisitorSession,
  issueVisitorSession,
  visitorCookieOptions,
  VISITOR_COOKIE,
} from '@/lib/auth/visitor'
import { getOrCreateWebConversation } from '@/lib/data/conversations'
import { listMessages, recordVisitorMessage, touchConversation } from '@/lib/data/messages'
import { respondWithAi } from '@/lib/ai/respond'

export const maxDuration = 60

/**
 * The visitor's own conversation, and only ever their own.
 *
 * No conversation id is accepted from the client on any of these routes. The
 * signed cookie is the sole source of identity, so there is nothing to tamper
 * with — a visitor cannot ask for a conversation that is not theirs, because
 * there is no way to ask for one at all.
 */
export async function GET() {
  const sessionId = await currentVisitorSession()
  if (!sessionId) return Response.json({ messages: [] }, { headers: { 'cache-control': 'no-store' } })

  const conversation = await getOrCreateWebConversation(sessionId)
  const messages = await listMessages(conversation.id)

  return Response.json(
    { messages, mode: conversation.mode },
    { headers: { 'cache-control': 'no-store' } }
  )
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { text?: string } | null
  const text = body?.text?.trim()
  if (!text) return Response.json({ error: 'Type something first.' }, { status: 400 })
  if (text.length > 2000) {
    return Response.json({ error: 'That message is too long.' }, { status: 400 })
  }

  const store = await cookies()
  let sessionId = await currentVisitorSession()

  if (!sessionId) {
    const issued = issueVisitorSession()
    store.set(VISITOR_COOKIE, issued.value, visitorCookieOptions)
    sessionId = issued.sessionId
  }

  const conversation = await getOrCreateWebConversation(sessionId)
  const messageId = await recordVisitorMessage(conversation.id, text)
  await touchConversation(conversation.id, text)

  // Same as the LINE path: the reply is generated after the response is on its
  // way, and there is no reply token because there was no inbound webhook.
  after(async () => {
    const outcome = await respondWithAi({ conversationId: conversation.id })
    if (outcome.outcome === 'failed') {
      console.error('[ai] could not answer web visitor', conversation.id, outcome.reason)
    }
  })

  return Response.json({ id: messageId })
}
