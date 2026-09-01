import { createAdminClient } from '@/lib/supabase/server'
import { env, featureReady } from '@/lib/env'

/**
 * Liveness + configuration report, and the daily cron target.
 *
 * The cron matters as much as the check: Supabase pauses free projects after
 * 7 days of inactivity, and this URL gets submitted to a reviewer who may open
 * it a week later. A trivial read each day keeps the project awake.
 */
export const maxDuration = 15

export async function GET() {
  const startedAt = Date.now()

  let database: 'ok' | 'error' = 'ok'
  let databaseError: string | undefined

  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from('app_config').select('key').limit(1)
    if (error) throw new Error(error.message)
  } catch (error) {
    database = 'error'
    databaseError = error instanceof Error ? error.message : String(error)
  }

  const body = {
    status: database === 'ok' ? ('ok' as const) : ('degraded' as const),
    database,
    ...(databaseError ? { databaseError } : {}),
    // Which phases are wired up. Names only — never values.
    configured: featureReady,
    // Host only, and NEXT_PUBLIC_ by design. Pointing at the wrong Supabase
    // project is otherwise invisible from outside.
    supabaseHost: (() => {
      try {
        return new URL(env.NEXT_PUBLIC_SUPABASE_URL).host
      } catch {
        return 'invalid'
      }
    })(),
    latencyMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
  }

  return Response.json(body, {
    status: database === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
