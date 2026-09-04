import { afterEach, describe, expect, it } from 'vitest'
import { GET as listFaq, POST as createFaq } from '@/app/api/faq/route'
import { DELETE as deleteFaq, PATCH as patchFaq } from '@/app/api/faq/[id]/route'
import { POST as testFaq } from '@/app/api/faq/test/route'
import { PATCH as reorderFaq } from '@/app/api/faq/reorder/route'
import {
  DELETE as removeFaqImage,
  POST as uploadFaqImage,
} from '@/app/api/faq/[id]/image/route'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/server'
import { faqImage, searchFaq } from '@/lib/data/faq'
import { faqMediaPrefix, MEDIA_BUCKET, removeMediaUnder } from '@/lib/media/store'
import { withCookie } from './support/request-context'

/**
 * Entries created here are recognisable and swept, the same convention the LINE
 * contacts use — the tests share the one cloud project with the demo data, and a
 * stray answer would change what the bot says in a demo.
 */
const MARK = 'ZZTEST'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function json(body: unknown): Request {
  return new Request('https://webchat.test/api/faq', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function upload(bytes: Buffer, type = 'image/png'): Request {
  const form = new FormData()
  form.set('image', new File([new Uint8Array(bytes)], 'menu.png', { type }))
  return new Request('https://webchat.test/api/faq/x/image', { method: 'POST', body: form })
}

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    question: `${MARK} เปิดกี่โมง`,
    answer: 'เปิดทุกวัน 07:00–19:00 ครับ',
    tags: ['zzztesthours'],
    slug: null,
    isActive: true,
    sortOrder: 9000,
    ...overrides,
  }
}

async function created(body: Record<string, unknown> = {}): Promise<string> {
  const res = await createFaq(json(entryBody(body)))
  expect(res.status).toBe(201)
  return ((await res.json()) as { entry: { id: string } }).entry.id
}

afterEach(async () => {
  const supabase = createAdminClient()
  // Ids first: the bucket does not cascade, and after the delete there is
  // nothing left that knows which files were ours.
  const { data } = await supabase.from('faq_entries').select('id').like('question', `${MARK}%`)
  await Promise.all((data ?? []).map((row) => removeMediaUnder(faqMediaPrefix(row.id))))
  await supabase.from('faq_entries').delete().like('question', `${MARK}%`)
})

describe('training the bot from the console', () => {
  it('will not show or change anything without a session', async () => {
    expect((await listFaq()).status).toBe(401)
    expect((await createFaq(json(entryBody()))).status).toBe(401)
  })

  it('adds an answer the agent can immediately find', async () => {
    signIn()
    await created({ tags: ['zzzuniquetag'] })

    const matches = await searchFaq('ขอถาม zzzuniquetag หน่อย')
    expect(matches[0].answer).toBe('เปิดทุกวัน 07:00–19:00 ครับ')
    expect(matches[0].hasImage).toBe(false)
  })

  it('refuses an answer with nothing in it', async () => {
    signIn()
    const res = await createFaq(json(entryBody({ question: '   ' })))
    expect(res.status).toBe(400)
  })

  it('refuses a picture name the agent could not type reliably', async () => {
    signIn()
    const res = await createFaq(json(entryBody({ slug: 'Not A Slug' })))
    expect(res.status).toBe(400)
  })

  it('refuses a picture name another answer already uses', async () => {
    signIn()
    await created({ slug: `${MARK.toLowerCase()}-menu` })

    const res = await createFaq(
      json(entryBody({ question: `${MARK} another`, slug: `${MARK.toLowerCase()}-menu` }))
    )
    expect(res.status).toBe(409)
  })

  it('edits an answer in place', async () => {
    signIn()
    const id = await created()

    const res = await patchFaq(
      json(entryBody({ answer: 'เปลี่ยนเป็น 08:00–20:00 ครับ' })),
      params(id)
    )
    expect(res.status).toBe(200)

    const listed = (await (await listFaq()).json()) as { entries: Array<{ id: string; answer: string }> }
    expect(listed.entries.find((e) => e.id === id)?.answer).toBe('เปลี่ยนเป็น 08:00–20:00 ครับ')
  })

  it('will not take a picture until the answer has a name for it', async () => {
    signIn()
    const id = await created({ slug: null })

    const res = await uploadFaqImage(upload(PNG), params(id))
    expect(res.status).toBe(400)
    expect(await faqImage('')).toBeNull()
  })

  it('attaches a picture the agent can then be handed', async () => {
    signIn()
    const slug = `${MARK.toLowerCase()}-menu`
    const id = await created({ slug })

    const res = await uploadFaqImage(upload(PNG), params(id))
    expect(res.status).toBe(200)

    const stored = await faqImage(slug)
    expect(stored?.url).toContain(MEDIA_BUCKET)

    // And the lookup now advertises it, which is the only way show_image ever
    // learns the name exists.
    const matches = await searchFaq('zzztesthours')
    expect(matches[0].hasImage).toBe(true)
    expect(matches[0].slug).toBe(slug)
  })

  it('refuses a file LINE would not accept', async () => {
    signIn()
    const id = await created({ slug: `${MARK.toLowerCase()}-menu` })

    const res = await uploadFaqImage(upload(PNG, 'application/pdf'), params(id))
    expect(res.status).toBe(415)
  })

  it('will not strip the name off an answer that still has a picture', async () => {
    signIn()
    const slug = `${MARK.toLowerCase()}-menu`
    const id = await created({ slug })
    await uploadFaqImage(upload(PNG), params(id))

    const res = await patchFaq(json(entryBody({ slug: null })), params(id))
    expect(res.status).toBe(400)
  })

  it('takes the picture off without touching the words', async () => {
    signIn()
    const slug = `${MARK.toLowerCase()}-menu`
    const id = await created({ slug })
    await uploadFaqImage(upload(PNG), params(id))

    expect((await removeFaqImage(new Request('https://webchat.test/x'), params(id))).status).toBe(200)
    expect(await faqImage(slug)).toBeNull()

    const matches = await searchFaq('zzztesthours')
    expect(matches[0].answer).toBe('เปิดทุกวัน 07:00–19:00 ครับ')
  })

  it('deletes an answer so the bot stops using it', async () => {
    signIn()
    const id = await created({ tags: ['zzzgonetag'] })

    expect((await deleteFaq(new Request('https://webchat.test/x'), params(id))).status).toBe(200)
    expect(await searchFaq('zzzgonetag')).toHaveLength(0)
  })
})

/**
 * The board's test box and its reordering. Both are console-only paths that
 * never reach a customer, and both are exercised here rather than in the
 * browser because what matters about them is what the database says back.
 */
describe('trying an answer out before a customer does', () => {
  it('will not run for anyone without a session', async () => {
    expect((await testFaq(json({ query: 'เปิดกี่โมง' }))).status).toBe(401)
  })

  it('returns the same ranking the agent gets, with the row that produced it', async () => {
    signIn()
    const id = await created({ tags: ['zzztrythisone'] })

    const res = await testFaq(json({ query: 'อยากถาม zzztrythisone ครับ' }))
    expect(res.status).toBe(200)

    const { matches } = (await res.json()) as {
      matches: Array<{ id: string; question: string; score: number }>
    }
    expect(matches[0].id).toBe(id)
    expect(matches[0].score).toBe('zzztrythisone'.length)
  })

  it('says plainly when the shop has no answer, which is the handoff case', async () => {
    signIn()
    const res = await testFaq(json({ query: 'zzzsomethingnobodyhasevertaughtit' }))

    expect(res.status).toBe(200)
    expect(((await res.json()) as { matches: unknown[] }).matches).toEqual([])
  })

  it('asks for a question rather than searching for nothing', async () => {
    signIn()
    expect((await testFaq(json({ query: '   ' }))).status).toBe(400)
  })

  it('sends nothing to anybody', async () => {
    signIn()
    await created({ tags: ['zzztrythisone'] })
    // fetch-fake refuses any host it does not fake, so a send would throw here
    // rather than pass quietly. This is the reassurance that makes the button
    // safe to press against a live conversation.
    expect((await testFaq(json({ query: 'zzztrythisone' }))).status).toBe(200)
  })
})

describe('putting the answers in order', () => {
  it('will not reorder for anyone without a session', async () => {
    expect((await reorderFaq(json({ ids: [] }))).status).toBe(401)
  })

  it('writes the order it was given, spaced so a number can go between', async () => {
    signIn()
    const first = await created({ question: `${MARK} one` })
    const second = await created({ question: `${MARK} two` })

    const res = await reorderFaq(json({ ids: [second, first] }))
    expect(res.status).toBe(200)

    const { entries } = (await res.json()) as {
      entries: Array<{ id: string; sortOrder: number }>
    }
    const by = (id: string) => entries.find((e) => e.id === id)!.sortOrder
    expect(by(second)).toBeLessThan(by(first))
    expect(by(first) - by(second)).toBeGreaterThanOrEqual(10)
  })

  it('refuses an order that names the same answer twice', async () => {
    signIn()
    const id = await created()
    expect((await reorderFaq(json({ ids: [id, id] }))).status).toBe(400)
  })

  it('refuses an empty order rather than renumbering nothing', async () => {
    signIn()
    expect((await reorderFaq(json({ ids: [] }))).status).toBe(400)
  })
})
