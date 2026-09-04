import { afterEach, describe, expect, it } from 'vitest'
import { GET as readAssistant, PUT as saveAssistant } from '@/app/api/assistant/route'
import { composeSystemPrompt, DEFAULT_VOICE, missingGuardrails } from '@/lib/ai/persona'
import { SESSION_COOKIE, issueSessionValue } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/server'
import { withCookie, flushAfter } from './support/request-context'
import { POST as lineWebhook } from '@/app/api/line/webhook/route'
import { fakeFetch } from './helpers/fetch-fake'
import { lineOk, signedWebhook } from './helpers/line'
import { lastModelRequest, openRouter } from './helpers/openrouter'
import { seedLineConversation } from './helpers/db'

function signIn(): void {
  withCookie(SESSION_COOKIE, issueSessionValue())
}

function put(body: unknown): Request {
  return new Request('https://webchat.test/api/assistant', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const KEYS = [
  'assistant_shop_name',
  'assistant_particle',
  'assistant_formality',
  'assistant_traits',
  'assistant_avoid',
  'assistant_instructions',
]

/**
 * There is one assistant and one config table, so unlike the FAQ these tests
 * cannot isolate themselves behind a prefix — they edit the real setting. The
 * rows are deleted rather than restored, which puts the assistant back on the
 * values in the code: the same state a shop that has never opened the screen is
 * in, and the state this project ships in.
 */
afterEach(async () => {
  await createAdminClient().from('app_config').delete().in('key', KEYS)
})

describe('composing what the model is told', () => {
  it('names the shop wherever the instructions ask for it', () => {
    const prompt = composeSystemPrompt({ ...DEFAULT_VOICE, shopName: 'Test Roasters' })

    expect(prompt).toContain('Test Roasters')
    expect(prompt).not.toContain('{{shop}}')
  })

  it('settles the particle instead of leaving it to the model', () => {
    expect(composeSystemPrompt({ ...DEFAULT_VOICE, particle: 'khrap' })).toContain('ครับ')
    expect(composeSystemPrompt({ ...DEFAULT_VOICE, particle: 'kha' })).toContain('ค่ะ')
    expect(composeSystemPrompt({ ...DEFAULT_VOICE, particle: 'none' })).toMatch(/do not end/i)
  })

  it('leaves out an empty optional rather than sending an empty heading', () => {
    const prompt = composeSystemPrompt({ ...DEFAULT_VOICE, traits: '', avoid: '' })

    expect(prompt).not.toMatch(/who you are/i)
    expect(prompt).not.toMatch(/never discuss/i)
  })

  it('carries the character and the forbidden subjects when they are set', () => {
    const prompt = composeSystemPrompt({
      ...DEFAULT_VOICE,
      traits: 'a barista who knows the beans',
      avoid: 'politics',
    })

    expect(prompt).toContain('a barista who knows the beans')
    expect(prompt).toContain('politics')
  })
})

describe('noticing a rule that was deleted', () => {
  it('is quiet about the instructions as shipped', () => {
    expect(missingGuardrails(DEFAULT_VOICE.instructions)).toEqual([])
  })

  it('says which rule went and what it was holding', () => {
    const stripped = DEFAULT_VOICE.instructions
      .split('\n\n')
      .filter((paragraph) => !paragraph.includes('did not come back'))
      .join('\n\n')

    const warnings = missingGuardrails(stripped)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].risk).toMatch(/price/i)
  })

  it('warns about an empty-headed prompt on every count', () => {
    expect(missingGuardrails('Be helpful.')).toHaveLength(3)
  })
})

describe('editing the assistant from the console', () => {
  it('shows and changes nothing without a session', async () => {
    expect((await readAssistant()).status).toBe(401)
    expect((await saveAssistant(put(DEFAULT_VOICE))).status).toBe(401)
  })

  it('starts on the values in the code, so an untouched shop is unaffected', async () => {
    signIn()
    const res = await readAssistant()
    expect(res.status).toBe(200)

    const { voice } = (await res.json()) as { voice: typeof DEFAULT_VOICE }
    expect(voice).toEqual(DEFAULT_VOICE)
  })

  it('keeps an edit, and hands back the text the model will receive', async () => {
    signIn()
    const res = await saveAssistant(
      put({ ...DEFAULT_VOICE, particle: 'kha', shopName: 'Test Roasters' })
    )
    expect(res.status).toBe(200)
    expect(((await res.json()) as { prompt: string }).prompt).toContain('ค่ะ')

    const { voice } = (await (await readAssistant()).json()) as { voice: typeof DEFAULT_VOICE }
    expect(voice.particle).toBe('kha')
    expect(voice.shopName).toBe('Test Roasters')
  })

  it('saves instructions with a rule removed, and says which one', async () => {
    signIn()
    const res = await saveAssistant(
      put({
        ...DEFAULT_VOICE,
        instructions:
          'You answer customers for a coffee shop in Bangkok. Be helpful and warm, and say whatever you think will please them most.',
      })
    )

    // Saved, not refused: the shop owns what its assistant says. It is told.
    expect(res.status).toBe(200)
    const { warnings } = (await res.json()) as { warnings: Array<{ label: string }> }
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('refuses instructions too short to describe an assistant at all', async () => {
    signIn()
    const res = await saveAssistant(put({ ...DEFAULT_VOICE, instructions: 'Be nice.' }))

    expect(res.status).toBe(400)
  })

  it('refuses a particle that is not one of the three', async () => {
    signIn()
    expect((await saveAssistant(put({ ...DEFAULT_VOICE, particle: 'ครับผม' }))).status).toBe(400)
  })
})

/**
 * The claim the whole screen rests on: an edit made in the console is in the
 * next thing the model is asked. Everything above this tests the pieces; this
 * follows one saved setting all the way to the wire.
 */
describe('what the model is actually sent', () => {
  it('carries the edited voice into the next reply', async () => {
    signIn()
    await saveAssistant(
      put({ ...DEFAULT_VOICE, particle: 'kha', shopName: 'ZZTEST Roasters', avoid: 'politics' })
    )

    fakeFetch({
      'api.line.me': lineOk(),
      'openrouter.ai': openRouter({ say: 'เปิดทุกวัน 07:00–19:00 ค่ะ' }),
    })
    const seeded = await seedLineConversation({ mode: 'ai' })

    await lineWebhook(signedWebhook({ userId: seeded.lineUserId, text: 'เปิดกี่โมง' }))
    await flushAfter()

    const { systemPrompt } = lastModelRequest()
    expect(systemPrompt).toContain('ZZTEST Roasters')
    expect(systemPrompt).toContain('ค่ะ')
    expect(systemPrompt).toContain('politics')
    // The rule it replaced is not merely outvoted: the prompt now forbids the
    // particle it used to require. `ครับ` still appears, inside that ban.
    expect(systemPrompt).toContain('Never use ครับ')
  })
})
