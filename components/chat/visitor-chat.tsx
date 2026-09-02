'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import type { ChatMessage } from '@/lib/types'

const POLL_MS = 3000

export function VisitorChat({ shopName }: { shopName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [optimistic, addOptimistic] = useOptimistic(messages, (current, draft: ChatMessage) => [
    ...current,
    draft,
  ])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch('/api/chat/messages', { cache: 'no-store' })
        if (!res.ok) throw new Error('Could not load this conversation.')
        const json = (await res.json()) as { messages: ChatMessage[] }
        if (!cancelled) {
          setMessages(json.messages)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

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
        conversationId: 'pending',
        sender: 'web_visitor',
        content: text,
        contentType: 'text',
        createdAt: new Date().toISOString(),
        deliveryStatus: 'queued',
      })

      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? 'Your message did not send. Try again?')
        return
      }

      setError(null)
      const refreshed = await fetch('/api/chat/messages', { cache: 'no-store' })
      if (refreshed.ok) {
        const json = (await refreshed.json()) as { messages: ChatMessage[] }
        setMessages(json.messages)
      }
    })
  }

  // Handoff notes are written for whoever picks the conversation up, not for
  // the person who asked the question.
  const visible = optimistic.filter((message) => message.sender !== 'system')

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col border-x">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-semibold">{shopName}</h1>
        <p className="text-xs text-muted-foreground">
          Ask us anything — no sign-up, no details needed.
        </p>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Opening hours, parking, the menu — whatever you need. Type below to start.
          </p>
        )}

        {visible.map((message) => {
          const isMine = message.sender === 'web_visitor'
          return (
            <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[80%] flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
                {!isMine && (
                  <span className="px-1 text-[11px] font-medium text-muted-foreground">
                    {message.sender === 'ai' ? shopName : `${shopName} · staff`}
                  </span>
                )}
                <div
                  className={`w-fit rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    isMine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  } ${message.deliveryStatus === 'queued' && isMine ? 'opacity-70' : ''}`}
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
          enterKeyHint="send"
          placeholder="Type a message…"
          aria-label="Your message"
          className="flex-1 rounded-full border bg-background px-4 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
        />
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}
