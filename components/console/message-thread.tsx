'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import type { ChatMessage } from '@/lib/types'

const POLL_MS = 3000

const senderStyle: Record<ChatMessage['sender'], { label: string; className: string }> = {
  line_user:   { label: 'LINE',     className: 'bg-muted text-foreground' },
  web_visitor: { label: 'Visitor',  className: 'bg-muted text-foreground' },
  operator:    { label: 'Operator', className: 'bg-primary text-primary-foreground' },
  ai:          { label: 'AI',       className: 'bg-emerald-600 text-white' },
  system:      { label: 'System',   className: 'bg-amber-500/15 text-amber-900 dark:text-amber-200' },
}

export function MessageThread({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Renders the operator's message the instant they hit send, then reconciles
  // with whatever the next poll returns.
  const [optimistic, addOptimistic] = useOptimistic(messages, (current, draft: ChatMessage) => [
    ...current,
    draft,
  ])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`Could not load messages (${res.status})`)
        const json = (await res.json()) as { messages: ChatMessage[] }
        if (!cancelled) {
          setMessages(json.messages)
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
  }, [conversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [optimistic.length])

  function handleSubmit(formData: FormData) {
    const text = String(formData.get('text') ?? '').trim()
    if (!text) return
    if (inputRef.current) inputRef.current.value = ''

    startTransition(async () => {
      addOptimistic({
        id: `pending-${crypto.randomUUID()}`,
        conversationId,
        sender: 'operator',
        content: text,
        contentType: 'text',
        createdAt: new Date().toISOString(),
        deliveryStatus: 'queued',
      })

      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `Send failed (${res.status})`)
      } else {
        setError(null)
      }

      const refreshed = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' })
      if (refreshed.ok) {
        const json = (await refreshed.json()) as { messages: ChatMessage[] }
        setMessages(json.messages)
      }
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {optimistic.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages in this conversation yet.</p>
        )}

        {optimistic.map((message) => {
          const style = senderStyle[message.sender]
          const isOutbound = message.sender !== 'line_user' && message.sender !== 'web_visitor'
          return (
            <div key={message.id} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[75%] flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
                <span className="px-1 text-[11px] font-medium text-muted-foreground">
                  {style.label}
                  {message.deliveryStatus === 'queued' && ' · sending…'}
                  {message.deliveryStatus === 'failed' && ' · failed'}
                </span>
                <div
                  className={`w-fit rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${style.className} ${
                    message.deliveryStatus === 'failed' ? 'ring-1 ring-red-500' : ''
                  }`}
                >
                  {message.content}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p role="alert" className="border-t border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <form action={handleSubmit} className="flex gap-2 border-t p-3">
        <input
          ref={inputRef}
          name="text"
          autoComplete="off"
          placeholder="Reply to this person on LINE…"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
