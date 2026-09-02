import { z } from 'zod'

/**
 * Environment access, validated once at module load so a misconfigured deploy
 * fails at boot instead of at the first LINE webhook.
 *
 * `NEXT_PUBLIC_*` values must be referenced as full literals — Next.js inlines
 * them at build time and a dynamic `process.env[name]` lookup is not replaced.
 *
 * The AI variables are optional so the app can build and deploy before an
 * OpenRouter key exists; without one it simply does not answer, and
 * `/api/health` says so.
 */

/**
 * An unset variable and an empty one mean the same thing here. Both `.env.local`
 * and the Vercel dashboard store a blank value as "", which is *present* as far
 * as `.optional()` is concerned — so it has to be normalised before validation
 * or every blank placeholder fails the build.
 */
const blankAsUndefined = (v: unknown) => (v === '' ? undefined : v)
const optionalSecret = (min = 1) =>
  z.preprocess(blankAsUndefined, z.string().min(min).optional())

const schema = z.object({
  // Supabase — required from phase 0
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),

  // LINE — required from phase 1
  LINE_CHANNEL_ACCESS_TOKEN: optionalSecret(),
  LINE_CHANNEL_SECRET: optionalSecret(),

  // AI — phase 2
  OPENROUTER_API_KEY: optionalSecret(),
  OPENROUTER_MODEL: z.preprocess(
    blankAsUndefined,
    z.string().min(1).default('anthropic/claude-haiku-4.5')
  ),

  // Operator console — required from phase 1
  OPERATOR_PASSWORD: optionalSecret(),
  SESSION_SECRET: optionalSecret(16),
})

const parsed = schema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPERATOR_PASSWORD: process.env.OPERATOR_PASSWORD,
  SESSION_SECRET: process.env.SESSION_SECRET,
})

if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
  throw new Error(`Invalid environment:\n${lines.join('\n')}`)
}

export const env = parsed.data

/**
 * A localhost Supabase URL is valid everywhere except on a deployed instance,
 * where it is silently fatal: `z.url()` accepts it, the app boots clean, and
 * every query then dies as `TypeError: fetch failed` after a ~7s timeout with
 * no hint as to why. Failing loudly at boot turns a runtime mystery into a
 * deployment error naming the exact variable.
 */
if (process.env.VERCEL === '1' && /localhost|127\.0\.0\.1|\[::1\]/.test(env.NEXT_PUBLIC_SUPABASE_URL)) {
  throw new Error(
    `NEXT_PUBLIC_SUPABASE_URL points at ${env.NEXT_PUBLIC_SUPABASE_URL} on a deployed instance. ` +
      'Set it to the hosted Supabase project URL (https://<ref>.supabase.co) in the Vercel dashboard.'
  )
}

/** Which phases are wired up, for /api/health and for guarding routes. */
export const featureReady = {
  line: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET),
  operatorAuth: Boolean(env.OPERATOR_PASSWORD && env.SESSION_SECRET),
  ai: Boolean(env.OPENROUTER_API_KEY),
}
