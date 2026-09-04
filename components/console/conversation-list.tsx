'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { ConversationSummary } from '@/lib/data/conversations'
import { conversationState, type ConversationState } from '@/lib/types'
import { useLiveUpdates } from '@/hooks/use-live-updates'
import { StateIndicator } from '@/components/console/state-indicator'

const POLL_MS = 3000
/** Kept as a safety net once the live channel is carrying updates. */
const HEARTBEAT_MS = 30000

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

type Filter = 'all' | 'needs-you' | 'ai'

const FILTERS: Array<{ id: Filter; label: string; covers: (state: ConversationState) => boolean }> = [
  { id: 'all', label: 'All', covers: () => true },
  // Both human states, because "is anyone waiting on me" is the question an
  // operator opens this list to answer — not "did the AI or I take it".
  { id: 'needs-you', label: 'Needs a person', covers: (s) => s !== 'ai' },
  { id: 'ai', label: 'AI', covers: (s) => s === 'ai' },
]

export function ConversationList() {
  const params = useParams<{ conversationId?: string }>()
  const [filter, setFilter] = useState<Filter>('all')
  const activeId = params?.conversationId
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [realtimeTopic, setRealtimeTopic] = useState<string | null>(null)
  const pollRef = useRef<(() => void) | null>(null)
  const isLive = useLiveUpdates(realtimeTopic, () => pollRef.current?.())

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/conversations', { cache: 'no-store' })
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(detail?.error ?? `Could not load conversations (${res.status})`)
        }
        const json = (await res.json()) as {
          conversations: ConversationSummary[]
          realtimeTopic: string | null
        }
        if (!cancelled) {
          setConversations(json.conversations)
          setRealtimeTopic(json.realtimeTopic)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    load()
    pollRef.current = load
    const timer = setInterval(load, isLive ? HEARTBEAT_MS : POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isLive])

  if (error) {
    return (
      <p role="alert" className="p-4 text-sm text-failed-ink">
        {error}
      </p>
    )
  }

  // Shaped like the list it is standing in for, so nothing jumps when the real
  // rows arrive.
  if (conversations === null) {
    return (
      <ul className="divide-y" aria-busy="true" aria-label="Loading conversations">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex animate-pulse gap-3 px-4 py-3 motion-reduce:animate-none">
            <span className="size-10 shrink-0 rounded-full bg-muted" />
            <span className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
              <span className="h-3 w-1/3 rounded bg-muted" />
              <span className="h-3 w-3/4 rounded bg-muted" />
            </span>
          </li>
        ))}
      </ul>
    )
  }

  if (conversations.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No conversations yet</p>
        <p className="mt-1">Add the LINE Official Account as a friend and send it a message.</p>
      </div>
    )
  }

  const shown = conversations.filter((c) => {
    const active = FILTERS.find((f) => f.id === filter)
    return active ? active.covers(conversationState(c)) : true
  })

  return (
    <div>
      <div className="flex gap-1 border-b p-2" role="group" aria-label="Filter conversations">
        {FILTERS.map((option) => {
          const count = conversations.filter((c) => option.covers(conversationState(c))).length
          const isOn = filter === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isOn}
              onClick={() => setFilter(option.id)}
              className={`rounded-lg px-2 py-1 text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
                isOn ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {shown.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">Nothing in this view.</p>
      )}

      <ul className="divide-y">
      {shown.map((conversation) => {
        const isActive = conversation.id === activeId
        const isWeb = conversation.channel === 'web'
        const state = conversationState(conversation)
        // A web visitor has no name to show, and calling them an unknown LINE
        // user would be actively wrong.
        const name = conversation.displayName ?? (isWeb ? 'Web visitor' : 'Unknown LINE user')
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
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* Which conversations need a person, readable without
                        opening any of them — and without relying on the colour. */}
                    <StateIndicator state={state} className="text-xs" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {relativeTime(conversation.lastMessageAt)}
                    </span>
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  <span className="shrink-0 rounded border px-1 py-px text-[10px] font-medium text-muted-foreground uppercase">
                    {isWeb ? 'Web' : 'LINE'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {conversation.lastMessagePreview ?? 'No messages yet'}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background tabular-nums">
                      {conversation.unreadCount}
                    </span>
                  )}
                </span>
                {conversation.handoffReason && (
                  <span className="mt-1 block truncate text-xs text-waiting-ink">
                    ↑ {conversation.handoffReason}
                  </span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
      </ul>
    </div>
  )
}
