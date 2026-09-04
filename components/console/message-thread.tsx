'use client'

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from 'react'
import { conversationState, type ChatMessage } from '@/lib/types'
import { useLiveUpdates } from '@/hooks/use-live-updates'
import { useStickToBottom } from '@/hooks/use-stick-to-bottom'
import { MessageBubble, type BubbleTone } from '@/components/chat/message-bubble'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ImagePlus } from 'lucide-react'
import { downscaleImage, ImageUnreadable } from '@/lib/media/downscale'
import { StateIndicator } from '@/components/console/state-indicator'


/**
 * How often to ask when nobody is telling us. Once the live channel is
 * connected the poll drops to a slow heartbeat: it stays running on purpose, so
 * a dropped socket costs a few seconds rather than the conversation going
 * silent, but it stops being the thing that carries updates.
 */
const POLL_MS = 3000
const HEARTBEAT_MS = 30000

type Mode = 'ai' | 'manual'

const presentation: Record<ChatMessage['sender'], { label: string; tone: BubbleTone }> = {
  line_user: { label: 'LINE', tone: 'other' },
  web_visitor: { label: 'Visitor', tone: 'other' },
  operator: { label: 'Operator', tone: 'self' },
  ai: { label: 'AI', tone: 'ai' },
  system: { label: 'System', tone: 'note' },
}

export function MessageThread({
  conversationId,
  channel,
}: {
  conversationId: string
  channel: 'line' | 'web'
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mode, setMode] = useState<Mode>('manual')
  const [handoffReason, setHandoffReason] = useState<string | null>(null)
  const [realtimeTopic, setRealtimeTopic] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isDrafting, setIsDrafting] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Renders the operator's message the instant they hit send, then reconciles
  // with whatever the next poll returns.
  const [optimistic, addOptimistic] = useOptimistic(messages, (current, draft: ChatMessage) => [
    ...current,
    draft,
  ])

  const pollRef = useRef<(() => void) | null>(null)
  const isLive = useLiveUpdates(realtimeTopic, () => pollRef.current?.())

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${conversationId}/messages`, { cache: 'no-store' })
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(detail?.error ?? `Could not load messages (${res.status})`)
    }
    return (await res.json()) as {
      messages: ChatMessage[]
      mode: Mode
      handoffReason: string | null
      realtimeTopic: string | null
    }
  }, [conversationId])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const json = await load()
        if (!cancelled) {
          setMessages(json.messages)
          setMode(json.mode)
          setHandoffReason(json.handoffReason)
          setRealtimeTopic(json.realtimeTopic)
          setError(null)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      }
    }

    poll()
    pollRef.current = poll
    const timer = setInterval(poll, isLive ? HEARTBEAT_MS : POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [load, isLive])

  useStickToBottom(scrollRef, optimistic.length)

  async function switchMode(next: Mode) {
    setIsSwitching(true)
    // Moved before the request lands so taking over feels immediate; the next
    // poll is authoritative and will correct it if the change did not stick.
    setMode(next)
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `Could not change the mode (${res.status})`)
        setMode(next === 'ai' ? 'manual' : 'ai')
      } else {
        setError(null)
      }
    } finally {
      setIsSwitching(false)
    }
  }

  async function suggestReply() {
    // The draft is the AI's opinion, not a replacement for the operator's own
    // work. Filling an empty box is helpful; silently overwriting a half-typed
    // reply is destroying something they cannot get back.
    const existing = inputRef.current?.value.trim() ?? ''
    if (existing && !window.confirm('Replace what you have typed with the AI draft?')) return

    setIsDrafting(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/suggest`, { method: 'POST' })
      const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null

      if (!res.ok || !json?.text) {
        setError(json?.error ?? `Could not draft a reply (${res.status})`)
        return
      }

      setError(null)
      if (inputRef.current) {
        inputRef.current.value = json.text
        inputRef.current.focus()
      }
    } finally {
      setIsDrafting(false)
    }
  }

  async function send(text: string): Promise<boolean> {
    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? `Send failed (${res.status})`)
      return false
    }
    setError(null)
    return true
  }

  /**
   * Sends a picture to the same endpoint the words go to — the request's own
   * content type is what distinguishes them. The file input is reset either way
   * so choosing the same picture twice in a row still fires a change event.
   */
  async function sendImage(file: File) {
    setIsUploading(true)
    try {
      // See lib/media/downscale.ts: the platform rejects a large body before
      // this route is reached, with an error the operator cannot read.
      let prepared: File
      try {
        prepared = await downscaleImage(file)
      } catch (cause) {
        setError(cause instanceof ImageUnreadable ? cause.message : 'That image could not be read.')
        return
      }

      const form = new FormData()
      form.set('image', prepared)

      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: form,
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `Could not send the image (${res.status})`)
      } else {
        setError(null)
      }
      await refresh()
    } finally {
      setIsUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function refresh() {
    try {
      const refreshed = await load()
      setMessages(refreshed.messages)
      setMode(refreshed.mode)
      setHandoffReason(refreshed.handoffReason)
      setRealtimeTopic(refreshed.realtimeTopic)
    } catch {
      // The send already reported its own outcome; a failed refresh is the
      // poll's problem and it will try again in a moment.
    }
  }

  /**
   * Sends the same text again as a *new* message rather than reviving the failed
   * row. The outbound path writes the row before it sends precisely so a
   * rejected message stays visible; overwriting it would erase the evidence
   * that the first attempt happened at all.
   */
  function retry(message: ChatMessage) {
    setRetryingId(message.id)
    startTransition(async () => {
      await send(message.content)
      await refresh()
      setRetryingId(null)
    })
  }

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

      await send(text)
      await refresh()
      // The next message is nearly always the very next thing they do.
      inputRef.current?.focus()
    })
  }

  const aiIsAnswering = mode === 'ai'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <StateIndicator
          state={conversationState({ mode, handoffReason })}
          detail="full"
          className="text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => switchMode(aiIsAnswering ? 'manual' : 'ai')}
          disabled={isSwitching}
        >
          {aiIsAnswering ? 'Take over' : 'Hand back to the AI'}
        </Button>
      </div>

      {handoffReason && mode === 'manual' && (
        <p className="border-b border-waiting/30 bg-waiting/10 px-4 py-2 text-xs text-waiting-ink">
          <span className="font-medium">Why it came to you:</span> {handoffReason}
        </p>
      )}

      <div
        ref={scrollRef}
        // Announced rather than merely rendered: an operator using a screen
        // reader would otherwise have no way to know a customer had replied.
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {optimistic.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages in this conversation yet.</p>
        )}

        {optimistic.map((message) => {
          const { label, tone } = presentation[message.sender]
          const isOutbound = message.sender !== 'line_user' && message.sender !== 'web_visitor'
          const failed = message.deliveryStatus === 'failed'

          return (
            <MessageBubble
              key={message.id}
              message={message}
              align={isOutbound ? 'end' : 'start'}
              tone={tone}
              label={label}
              announceAs={label}
              status={
                message.deliveryStatus === 'queued'
                  ? 'Sending…'
                  : failed
                    ? `Not delivered${message.failureReason ? ` — ${message.failureReason}` : ''}`
                    : undefined
              }
              action={
                failed ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => retry(message)}
                    disabled={retryingId === message.id}
                  >
                    {retryingId === message.id ? 'Sending…' : 'Send again'}
                  </Button>
                ) : undefined
              }
            />
          )
        })}
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 border-t border-failed/30 bg-failed/10 px-4 py-2 text-sm text-failed-ink"
        >
          <p>{error}</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <form action={handleSubmit} className="flex gap-2 border-t p-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void sendImage(file)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="Send a picture"
          disabled={isUploading}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={suggestReply}
          disabled={isDrafting}
          className="whitespace-nowrap"
        >
          {isDrafting ? 'Drafting…' : 'Suggest a reply'}
        </Button>
        <Input
          ref={inputRef}
          name="text"
          autoComplete="off"
          enterKeyHint="send"
          aria-label="Your reply"
          placeholder={channel === 'web' ? 'Reply in their browser…' : 'Reply to this person on LINE…'}
          size="lg"
          className="flex-1"
        />
        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? 'Sending…' : 'Send'}
        </Button>
      </form>

      {/* What the draft button does, in the open. This used to be a title
          attribute, which is unreachable on a touch device and unreliable
          everywhere else — and it is the reassurance that makes the button
          safe to press. */}
      <p className="px-3 pb-3 text-xs text-muted-foreground">
        {isUploading
          ? 'Sending the picture…'
          : 'A draft is written by the AI and goes in the box. Nothing reaches the customer until you press Send. Pictures send as soon as you choose one.'}
      </p>
    </div>
  )
}
