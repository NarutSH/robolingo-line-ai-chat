import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * `lib/env.ts` validates on import and throws on a bad environment, so the real
 * values have to be in `process.env` before anything application-side is
 * imported. This module is therefore the *first* import in `tests/setup.ts`;
 * ESM evaluates imports in order, so it wins.
 *
 * Values already in the environment win over the file, so CI can supply its own.
 */
const ENV_FILE = fileURLToPath(new URL('../../.env.local', import.meta.url))

try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    const [, key, value] = match
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
} catch {
  // No .env.local — the environment is expected to be supplied already.
}

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  throw new Error(
    'No Supabase configuration found. Tests run against a real database; ' +
      'put the project credentials in .env.local or the environment.'
  )
}
