import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { POST as sendToConversation } from '@/app/api/conversations/[id]/messages/route'
import { POST as webhook } from '@/app/api/line/webhook/route'
import { createAdminClient } from '@/lib/supabase/server'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import { MEDIA_BUCKET } from '@/lib/media/store'
import { fakeFetch } from './helpers/fetch-fake'
import { lineContentGone, lineContentOk, lineOk, sentToLine, signedWebhook } from './helpers/line'
import { openRouter } from './helpers/openrouter'
import { messagesIn, seedLineConversation } from './helpers/db'
import { flushAfter, withCookie } from './support/request-context'

/** A one-pixel PNG, which is all the storage path needs to be exercised. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function imageUpload(bytes: Buffer, type = 'image/png'): FormData {
  const form = new FormData()
  form.set('image', new File([new Uint8Array(bytes)], 'photo.png', { type }))
  return form
}

function uploadRequest(form: FormData): Request {
  return new Request('https://webchat.test/api/conversations/x/messages', {
    method: 'POST',
    body: form,
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

/**
 * A picture the shop has published, kept apart from the seeded demo entries.
 *
 * The 'menu' entry ships with a slug and no image so the shop can attach one as
 * a data edit. Borrowing it here would leave the demo pointing at a URL that
 * does not resolve if this file ever died mid-run, so the test grows its own.
 */
const TEST_SLUG = 'testpicture'
const PUBLISHED_URL = 'https://storage.test/menu.png'

describe('pictures in a conversation', () => {
  beforeAll(async () => {
    await createAdminClient()
      .from('faq_entries')
      .insert({
        question: 'test picture entry',
        answer: 'test picture answer',
        tags: ['zzzztestpicture'],
        slug: TEST_SLUG,
        image_url: PUBLISHED_URL,
        is_active: true,
        sort_order: 9999,
      })
  })

  afterAll(async () => {
    await createAdminClient().from('faq_entries').delete().eq('slug', TEST_SLUG)
  })

  it('sends an operator picture to LINE as an image message', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const seeded = await seedLineConversation({ mode: 'manual' })
    signIn()

    const response = await sendToConversation(
      uploadRequest(imageUpload(PNG_BYTES)),
      params(seeded.conversationId)
    )

    expect(response.status).toBe(200)

    const messages = await messagesIn(seeded.conversationId)
    const sentRow = messages.at(-1)!
    expect(sentRow.sender).toBe('operator')
    expect(sentRow.content_type).toBe('image')
    expect(sentRow.delivery_status).toBe('sent')
    // The URL is its own column: `content` feeds the model's view of the thread
    // and the conversation list preview, and neither wants a URL.
    expect(sentRow.content).toBe('[image]')
    expect(sentRow.media_url).toContain(MEDIA_BUCKET)

    const sent = sentToLine()
    expect(sent).toHaveLength(1)
    expect(sent[0].imageUrl).toBe(sentRow.media_url)
    // Minutes after any inbound webhook, so there is no live reply token.
    expect(sent[0].via).toBe('push')
  })

  it('refuses a file LINE would not accept, before anything is stored', async () => {
    fakeFetch({ 'api.line.me': lineOk() })
    const seeded = await seedLineConversation({ mode: 'manual' })
    signIn()

    const form = new FormData()
    form.set('image', new File([new Uint8Array(PNG_BYTES)], 'notes.pdf', { type: 'application/pdf' }))

    const response = await sendToConversation(uploadRequest(form), params(seeded.conversationId))

    expect(response.status).toBe(415)
    expect(await messagesIn(seeded.conversationId)).toHaveLength(0)
    expect(sentToLine()).toHaveLength(0)
  })

  it('sends the published picture after the sentence that introduces it', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(
        { call: { name: 'search_faq', args: { question: 'ขอดูเมนูหน่อย' } } },
        { call: { name: 'show_image', args: { image: TEST_SLUG } } },
        { say: 'ส่งเมนูให้ดูนะครับ' }
      ),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'ขอดูเมนูหน่อย' }))
    await flushAfter()

    const messages = await messagesIn(seeded.conversationId)
    const outbound = messages.filter((m) => m.direction === 'outbound')

    expect(outbound).toHaveLength(2)
    expect(outbound[0].content).toBe('ส่งเมนูให้ดูนะครับ')
    expect(outbound[0].content_type).toBe('text')
    expect(outbound[1].content_type).toBe('image')
    expect(outbound[1].media_url).toBe(PUBLISHED_URL)

    const sent = sentToLine()
    expect(sent).toHaveLength(2)
    expect(sent[0].text).toBe('ส่งเมนูให้ดูนะครับ')
    expect(sent[1].imageUrl).toBe(PUBLISHED_URL)
    // The written reply spends the single-use reply token; the picture follows
    // as a push, which is what dispatchOutbound falls back to anyway.
    expect(sent[0].via).toBe('reply')
    expect(sent[1].via).toBe('push')
  })

  it('will not send a picture the shop has not published', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter(
        { call: { name: 'show_image', args: { image: 'a-picture-that-does-not-exist' } } },
        { say: 'ขอโทษครับ ตอนนี้ยังไม่มีรูปให้ดูครับ' }
      ),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await webhook(signedWebhook({ userId: seeded.lineUserId, text: 'ขอดูรูป' }))
    await flushAfter()

    const outbound = (await messagesIn(seeded.conversationId)).filter(
      (m) => m.direction === 'outbound'
    )
    expect(outbound).toHaveLength(1)
    expect(outbound[0].content_type).toBe('text')
    expect(sentToLine().every((m) => m.imageUrl === undefined)).toBe(true)
  })

  it('keeps a copy of a picture the customer sends', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'api-data.line.me': lineContentOk(),
      'openrouter.ai': openRouter({ say: 'รับทราบครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })

    await webhook(signedWebhook({ userId: seeded.lineUserId, image: true }))
    await flushAfter()

    const inbound = (await messagesIn(seeded.conversationId)).filter(
      (m) => m.direction === 'inbound'
    )
    expect(inbound).toHaveLength(1)
    expect(inbound[0].content_type).toBe('image')
    // The words stay readable — the copy is what changes.
    expect(inbound[0].content).toBe('[image]')
    expect(inbound[0].media_url).toContain(MEDIA_BUCKET)
  })

  it('keeps the conversation when LINE will not hand the picture over', async () => {
    fakeFetch({
      'api.line.me': lineOk(),
      'api-data.line.me': lineContentGone(),
      'openrouter.ai': openRouter({ say: 'รับทราบครับ' }),
    })
    const seeded = await seedLineConversation({ mode: 'manual' })

    const response = await webhook(signedWebhook({ userId: seeded.lineUserId, image: true }))
    await flushAfter()

    expect(response.status).toBe(200)

    const inbound = (await messagesIn(seeded.conversationId)).filter(
      (m) => m.direction === 'inbound'
    )
    expect(inbound).toHaveLength(1)
    // Exactly what it said before pictures were copied at all: a placeholder,
    // not a broken frame.
    expect(inbound[0].content).toBe('[image]')
    expect(inbound[0].media_url).toBeNull()
  })
})
