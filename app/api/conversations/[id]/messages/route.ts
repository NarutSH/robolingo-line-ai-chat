import { requireOperator } from '@/lib/auth/session'
import { getConversationTarget, markConversationRead } from '@/lib/data/conversations'
import { listMessages } from '@/lib/data/messages'
import { dispatchOutbound, OutboundFailed } from '@/lib/messaging/dispatch'
import { featureReady } from '@/lib/env'
import {
  isAcceptedImageType,
  MAX_IMAGE_BYTES,
  storeImage,
  type AcceptedImageType,
} from '@/lib/media/store'

export const maxDuration = 30

export async function GET(_request: Request, ctx: RouteContext<'/api/conversations/[id]/messages'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params
  try {
    // The mode rides along with the messages rather than needing its own poll:
    // the console asks for this every few seconds anyway, and "who is answering
    // this conversation right now" is part of its state, not a separate thing.
    const [messages, conversation] = await Promise.all([
      listMessages(id),
      getConversationTarget(id),
      markConversationRead(id),
    ])
    return Response.json(
      {
        messages,
        mode: conversation?.mode ?? 'manual',
        // Fully qualified here rather than in the browser: the prefix has to
        // match what the database broadcasts on, and three client sites each
        // remembering to add it is three places for them to disagree.
        realtimeTopic: conversation ? `conversation:${conversation.realtimeToken}` : null,
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[messages] load failed', cause)
    return Response.json({ error: `Could not load messages: ${reason}` }, { status: 502 })
  }
}

export async function POST(request: Request, ctx: RouteContext<'/api/conversations/[id]/messages'>) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!featureReady.line) {
    return Response.json({ error: 'LINE credentials are not configured.' }, { status: 503 })
  }

  const { id } = await ctx.params

  // One endpoint, because "send this to the conversation" is one thing whether
  // it carries words or a picture. The content type of the *request* is what
  // says which, so a client that knows nothing about pictures is unaffected.
  const isUpload = request.headers.get('content-type')?.includes('multipart/form-data')

  let text: string | undefined
  let upload: { file: File; contentType: AcceptedImageType } | null = null

  if (isUpload) {
    const form = await request.formData().catch(() => null)
    const file = form?.get('image')
    if (!(file instanceof File)) {
      return Response.json({ error: 'No image was attached.' }, { status: 400 })
    }
    if (!isAcceptedImageType(file.type)) {
      return Response.json(
        { error: 'LINE accepts JPEG and PNG images only.' },
        { status: 415 }
      )
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json(
        { error: `That image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.` },
        { status: 413 }
      )
    }
    upload = { file, contentType: file.type }
    text = '[image]'
  } else {
    const body = (await request.json().catch(() => null)) as { text?: string } | null
    text = body?.text?.trim()
    if (!text) return Response.json({ error: 'Message text is required.' }, { status: 400 })
  }

  const conversation = await getConversationTarget(id)
  if (!conversation) return Response.json({ error: 'Conversation not found.' }, { status: 404 })
  if (conversation.channel === 'line' && !conversation.lineUserId) {
    return Response.json({ error: 'This conversation has no LINE recipient.' }, { status: 400 })
  }

  try {
    // Stored before the row is written, because a picture that never reached the
    // bucket has no URL for the row to point at. A file uploaded for a send that
    // then fails is a few kilobytes of litter; a message row promising a picture
    // that does not exist is a broken image in the customer's chat.
    let imageUrl: string | null = null
    if (upload) {
      const stored = await storeImage({
        conversationId: conversation.id,
        bytes: await upload.file.arrayBuffer(),
        contentType: upload.contentType,
      })
      imageUrl = stored.url
    }

    // No reply token: the operator is answering minutes after the inbound
    // webhook, so any token LINE issued is long dead. dispatchOutbound records
    // the row before sending, so a rejection stays visible in the thread.
    const result = await dispatchOutbound({ conversation, sender: 'operator', text, imageUrl })
    return Response.json({ id: result.messageId, via: result.via })
  } catch (cause) {
    if (cause instanceof OutboundFailed) {
      return Response.json(
        { error: `Could not deliver the message: ${cause.reason}`, id: cause.messageId },
        { status: 502 }
      )
    }
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[messages] send failed', cause)
    return Response.json({ error: `Could not send the message: ${reason}` }, { status: 502 })
  }
}
