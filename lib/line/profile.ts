import 'server-only'
import { lineClient } from '@/lib/line/client'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Fetches the display name and avatar so the console can show who is writing.
 *
 * `getProfile` returns 404 when the user has not added the OA as a friend or
 * has blocked it — a normal state, not an error. We record that rather than
 * failing the webhook, because the message itself still needs to be delivered
 * to the operator.
 */
export async function refreshProfile(lineUserId: string): Promise<void> {
  const supabase = createAdminClient()
  try {
    const profile = await lineClient().getProfile(lineUserId)
    await supabase
      .from('line_users')
      .update({
        display_name: profile.displayName ?? null,
        picture_url: profile.pictureUrl ?? null,
        status_message: profile.statusMessage ?? null,
        language: profile.language ?? null,
        is_friend: true,
        profile_fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('line_user_id', lineUserId)
  } catch {
    await supabase
      .from('line_users')
      .update({ is_friend: false, profile_fetched_at: new Date().toISOString() })
      .eq('line_user_id', lineUserId)
  }
}
