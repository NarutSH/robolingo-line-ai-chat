import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getConversationTarget } from '@/lib/data/conversations'
import { MessageThread } from '@/components/console/message-thread'

export default async function ConversationPage({
  params,
}: PageProps<'/console/[conversationId]'>) {
  const { conversationId } = await params
  const conversation = await getConversationTarget(conversationId)
  if (!conversation) notFound()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        {/* Only reachable at the width where the list is not on screen. */}
        <Link
          href="/console"
          aria-label="Back to all conversations"
          className="-ml-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:hidden"
        >
          <ArrowLeft className="size-4" />
        </Link>

        {conversation.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- LINE CDN host varies per profile
          <img src={conversation.pictureUrl} alt="" className="size-9 rounded-full object-cover" />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-muted text-sm font-medium">
            {(conversation.displayName ?? '?').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {conversation.displayName ?? (conversation.channel === 'web' ? 'Web visitor' : 'Unknown LINE user')}
          </p>
          <p className="text-xs text-muted-foreground">
            {conversation.channel === 'web'
              ? 'Replies appear in their browser'
              : conversation.isFriend
                ? 'Replies are delivered through the Official Account'
                : 'Not a friend of the OA — replies will be rejected by LINE'}
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <MessageThread conversationId={conversation.id} channel={conversation.channel} />
      </div>
    </div>
  )
}
