'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ConversationSummary } from '@/lib/data/conversations'

const POLL_MS = 3000

function initials(name: string | null) {
  return (name ?? '?').trim().charAt(0).toUpperCase() || '?'
}

function relativeTime(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export function ConversationList() {
  const params = useParams<{ conversationId?: string }>()
  const activeId = params?.conversationId
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/conversations', { cache: 'no-store' })
        if (!res.ok) throw new Error(`Could not load conversations (${res.status})`)
        const json = (await res.json()) as { conversations: ConversationSummary[] }
        if (!cancelled) {
          setConversations(json.conversations)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (error) {
    return <p className="p-4 text-sm text-red-600 dark:text-red-400">{error}</p>
  }

  if (conversations === null) {
    return <p className="p-4 text-sm text-muted-foreground">Loading conversations…</p>
  }

  if (conversations.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No conversations yet</p>
        <p className="mt-1">Add the LINE Official Account as a friend and send it a message.</p>
      </div>
    )
  }

  return (
    <ul className="divide-y">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeId
        const name = conversation.displayName ?? 'Unknown LINE user'
        return (
          <li key={conversation.id}>
            <Link
              href={`/console/${conversation.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex gap-3 px-4 py-3 transition-colors hover:bg-muted/60 ${
                isActive ? 'bg-muted' : ''
              }`}
            >
              {conversation.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- LINE CDN host varies per profile
                <img src={conversation.pictureUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium">
                  {initials(conversation.displayName)}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(conversation.lastMessageAt)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {conversation.lastMessagePreview ?? 'No messages yet'}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background tabular-nums">
                      {conversation.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
