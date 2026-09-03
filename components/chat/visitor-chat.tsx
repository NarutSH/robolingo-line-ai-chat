'use client'

import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import type { ChatMessage } from '@/lib/types'
import { MessageBubble } from '@/components/chat/message-bubble'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const POLL_MS = 3000

/**
 * How long the widget will keep saying an answer is coming. Claiming a reply is
 * on its way for the rest of the visitor's afternoon is a worse lie than
 * admitting nothing more is coming.
 */
const PENDING_TTL_MS = 60_000

/**
 * Three dots in the shop's position, while the shop owes the customer an answer.
 *
 * Reduced motion gets a static row rather than nothing at all: the point is to
 * say "someone is dealing with this", and that has to survive the preference.
 */
function PendingReply({ shopName }: { shopName: string }) {
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[80%] flex-col items-start gap-1">
        <span className="px-1 text-[11px] font-medium text-muted-foreground">{shopName}</span>
        <div className="flex w-fit items-center gap-1 rounded-2xl bg-muted px-3.5 py-3">
          <span className="sr-only">Writing a reply</span>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              aria-hidden
              style={{ animationDelay: `${delay}ms` }}
              className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Whether the shop has been promising an answer for longer than it should.
 *
 * The conversation's mode is the real signal and it clears the indicator the
 * moment a handoff happens. This is the backstop for the case mode cannot see:
 * the assistant configured off, or a run that died. It is evaluated on the poll
 * rather than during render, so the clock is only ever read in a callback.
 */
function hasWaitedTooLong(messages: ChatMessage[]): boolean {
  const newest = messages.filter((message) => message.sender !== 'system').at(-1)
  if (!newest || newest.sender !== 'web_visitor') return false
  return Date.now() - new Date(newest.createdAt).getTime() >= PENDING_TTL_MS
}

export function VisitorChat({ shopName }: { shopName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mode, setMode] = useState<'ai' | 'manual'>('ai')
  const [error, setError] = useState<string | null>(null)
  const [pendingExpired, setPendingExpired] = useState(false)
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
        const json = (await res.json()) as { messages: ChatMessage[]; mode?: 'ai' | 'manual' }
        if (!cancelled) {
          setMessages(json.messages)
          setMode(json.mode ?? 'ai')
          setPendingExpired(hasWaitedTooLong(json.messages))
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

  useStickToBottom(scrollRef, optimistic.length)

  // Handoff notes are written for whoever picks the conversation up, not for
  // the person who asked the question.
  const visible = optimistic.filter((message) => message.sender !== 'system')

  /**
   * Read from the conversation, not from a stopwatch: the shop owes an answer
   * while the newest thing anyone said came from the visitor *and* the assistant
   * is still the one answering. A handoff flips the mode, which clears this —
   * telling someone a reply is seconds away when their question has just been
   * put in a human queue is the lie this indicator exists to avoid.
   */
  const newest = visible[visible.length - 1]
  const owedAnswer = mode === 'ai' && newest?.sender === 'web_visitor'
  const awaitingReply = owedAnswer && !pendingExpired

  async function submitText(text: string) {
    const res = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? 'Your message did not send.')
      // The optimistic bubble goes away with the transition, so the words are
      // put back where the visitor typed them. Pressing send again is the
      // retry — one affordance, and nothing they wrote is lost.
      if (inputRef.current) inputRef.current.value = text
      return
    }

    setError(null)
    const refreshed = await fetch('/api/chat/messages', { cache: 'no-store' })
    if (refreshed.ok) {
      const json = (await refreshed.json()) as { messages: ChatMessage[]; mode?: 'ai' | 'manual' }
      setMessages(json.messages)
      setMode(json.mode ?? 'ai')
    }
  }

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

      await submitText(text)
      inputRef.current?.focus()
    })
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-2xl flex-col border-x">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-semibold">{shopName}</h1>
        <p className="text-xs text-muted-foreground">
          Ask us anything — no sign-up, no details needed.
        </p>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Conversation with ${shopName}`}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Opening hours, parking, the menu — whatever you need. Type below to start.
          </p>
        )}

        {visible.map((message) => {
          const isMine = message.sender === 'web_visitor'
          // The customer is talking to the shop. Which of the shop's staff — or
          // whether any of them was a person — is not their concern.
          const shopLabel = message.sender === 'ai' ? shopName : `${shopName} · staff`

          return (
            <MessageBubble
              key={message.id}
              message={message}
              align={isMine ? 'end' : 'start'}
              tone={isMine ? 'self' : 'other'}
              label={isMine ? null : shopLabel}
              announceAs={isMine ? 'You' : shopLabel}
            />
          )
        })}

        {awaitingReply && <PendingReply shopName={shopName} />}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-t border-failed/30 bg-failed/10 px-4 py-2 text-sm text-failed-ink"
        >
          <p>{error}</p>
        </div>
      )}

      <form action={handleSubmit} className="flex gap-2 border-t p-3">
        <Input
          ref={inputRef}
          name="text"
          autoComplete="off"
          enterKeyHint="send"
          aria-label="Your message"
          placeholder="Type a message…"
          size="xl"
          shape="pill"
          className="flex-1"
        />
        <Button type="submit" size="lg" shape="pill" disabled={isPending} className="px-5">
          Send
        </Button>
      </form>
    </div>
  )
}
