import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_VOICE, type AssistantVoice, type Formality, type Particle } from '@/lib/ai/persona'

/**
 * Who the assistant is, as the shop has set it.
 *
 * Kept in `app_config` rather than in a table of its own: there is exactly one
 * assistant, and a table with a single row that must never grow to two is a
 * shape that invites a second one. The keys are namespaced so the config table
 * stays readable next to the realtime topic that already lives there.
 *
 * A key that has never been written falls back to the value in the code, so a
 * shop that has not opened this screen gets the same assistant it had before it
 * existed, and a partly-filled row cannot produce a prompt with a hole in it.
 */
const KEYS = {
  shopName: 'assistant_shop_name',
  particle: 'assistant_particle',
  formality: 'assistant_formality',
  traits: 'assistant_traits',
  avoid: 'assistant_avoid',
  instructions: 'assistant_instructions',
} as const

const PARTICLES: Particle[] = ['khrap', 'kha', 'none']
const FORMALITIES: Formality[] = ['formal', 'friendly', 'casual']

export async function readAssistantVoice(): Promise<AssistantVoice> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', Object.values(KEYS))

  if (error) throw new Error(`readAssistantVoice failed: ${error.message}`)

  const stored = new Map((data ?? []).map((row) => [row.key, row.value]))
  const text = (key: string, fallback: string) => stored.get(key) ?? fallback

  // A value that is no longer one of the options — an older release's spelling,
  // or a hand edit in the dashboard — falls back rather than reaching the model
  // as an instruction nobody wrote.
  const particle = stored.get(KEYS.particle)
  const formality = stored.get(KEYS.formality)

  return {
    shopName: text(KEYS.shopName, DEFAULT_VOICE.shopName),
    particle: PARTICLES.includes(particle as Particle)
      ? (particle as Particle)
      : DEFAULT_VOICE.particle,
    formality: FORMALITIES.includes(formality as Formality)
      ? (formality as Formality)
      : DEFAULT_VOICE.formality,
    traits: text(KEYS.traits, DEFAULT_VOICE.traits),
    avoid: text(KEYS.avoid, DEFAULT_VOICE.avoid),
    instructions: text(KEYS.instructions, DEFAULT_VOICE.instructions),
  }
}

export async function writeAssistantVoice(voice: AssistantVoice): Promise<void> {
  const supabase = createAdminClient()
  const rows = [
    { key: KEYS.shopName, value: voice.shopName },
    { key: KEYS.particle, value: voice.particle },
    { key: KEYS.formality, value: voice.formality },
    { key: KEYS.traits, value: voice.traits },
    { key: KEYS.avoid, value: voice.avoid },
    { key: KEYS.instructions, value: voice.instructions },
  ]

  // One upsert, so a save cannot land halfway and leave the assistant speaking
  // with the new particle out of the old instructions.
  const { error } = await supabase.from('app_config').upsert(rows, { onConflict: 'key' })
  if (error) throw new Error(`writeAssistantVoice failed: ${error.message}`)
}
