import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Server-side Supabase client, holding the secret key.
 *
 * This deliberately replaces the `@supabase/ssr` cookie-session client that the
 * Supabase quickstart generates. We do not use Supabase Auth — operators sign in
 * with a password against our own signed cookie — so there is no session to sync
 * and the cookie plumbing would do nothing.
 *
 * Because RLS is enabled with no policies, this client is the *only* way any row
 * is ever read or written. The browser holds just the publishable key and uses it
 * for Realtime subscription alone.
 *
 * Per Supabase's Fluid compute guidance, this is created per call rather than
 * held in a module-level singleton.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
