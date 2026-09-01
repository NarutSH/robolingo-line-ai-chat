import { requireOperator } from '@/lib/auth/session'
import { listConversations } from '@/lib/data/conversations'

export async function GET() {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const conversations = await listConversations()
  return Response.json({ conversations }, { headers: { 'cache-control': 'no-store' } })
}
