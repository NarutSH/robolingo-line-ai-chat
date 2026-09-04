'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import {
  composeSystemPrompt,
  missingGuardrails,
  type AssistantVoice,
  type Formality,
  type Particle,
} from '@/lib/ai/persona'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MessageBubble } from '@/components/chat/message-bubble'
import { cn } from '@/lib/utils'

const PARTICLES: Array<{ id: Particle; label: string; sample: string }> = [
  { id: 'khrap', label: 'ครับ', sample: 'เปิดทุกวัน 07:00–19:00 น. ครับ' },
  { id: 'kha', label: 'ค่ะ', sample: 'เปิดทุกวัน 07:00–19:00 น. ค่ะ' },
  { id: 'none', label: 'ไม่ใช้', sample: 'เปิดทุกวัน 07:00–19:00 น.' },
]

const FORMALITIES: Array<{ id: Formality; label: string; hint: string }> = [
  { id: 'formal', label: 'Formal', hint: 'Like a hotel front desk' },
  { id: 'friendly', label: 'Friendly', hint: 'Like a good shop assistant' },
  { id: 'casual', label: 'Casual', hint: 'Like talking to a regular' },
]

interface Warning {
  label: string
  risk: string
}

export function AssistantBoard() {
  const ids = useId()
  const [voice, setVoice] = useState<AssistantVoice | null>(null)
  const [saved, setSaved] = useState<AssistantVoice | null>(null)
  const [defaults, setDefaults] = useState<AssistantVoice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/assistant', { cache: 'no-store' })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(json?.error ?? `Could not load the assistant (${res.status})`)
    }
    return (await res.json()) as { voice: AssistantVoice; defaults: AssistantVoice }
  }, [])

  useEffect(() => {
    let cancelled = false
    load()
      .then(({ voice: loaded, defaults: fallback }) => {
        if (cancelled) return
        setVoice(loaded)
        setSaved(loaded)
        setDefaults(fallback)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function save() {
    if (!voice) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(voice),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(json?.error ?? `Could not save (${res.status})`)
        return
      }
      setError(null)
      setSaved(voice)
      setNotice('Saved. The assistant uses this from its next reply.')
    } finally {
      setIsSaving(false)
    }
  }

  if (error && !voice) {
    return (
      <p role="alert" className="p-4 text-sm text-failed-ink">
        {error}
      </p>
    )
  }

  if (!voice || !defaults) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6" aria-busy="true">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-20 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none"
          />
        ))}
      </div>
    )
  }

  // Composed in the browser from the same function the server composes with, so
  // what is on screen is the text the model receives and not an approximation
  // of it.
  const prompt = composeSystemPrompt(voice)
  const warnings: Warning[] = missingGuardrails(voice.instructions)
  const dirty = JSON.stringify(voice) !== JSON.stringify(saved)
  const set = (patch: Partial<AssistantVoice>) => setVoice({ ...voice, ...patch })

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
      <div className="max-w-prose">
        <h1 className="text-lg font-semibold">Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who answers your customers, and the rules they answer under. What the assistant{' '}
          <em>knows</em> is on the Training screen; this is how it behaves.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-failed/30 bg-failed/10 px-3 py-2 text-sm text-failed-ink"
        >
          <p>{error}</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <section className="space-y-4 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Voice</h2>

        <div className="space-y-1.5">
          <label htmlFor={`${ids}-shop`} className="text-sm font-medium">
            Shop Name
          </label>
          <Input
            id={`${ids}-shop`}
            name="shop-name"
            autoComplete="organization"
            size="lg"
            value={voice.shopName}
            onChange={(event) => set({ shopName: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Used wherever the instructions say <code translate="no">{'{{shop}}'}</code>, and at the
            top of the web chat window.
          </p>
        </div>

        {/* A radio group, not a text box. There are three right answers, it
            touches the end of every Thai sentence, and "ครับผม" typed into a
            field would reach the model as an instruction. */}
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Sentence Ending in Thai</legend>
          <div className="flex flex-wrap gap-2">
            {PARTICLES.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-within:ring-3 focus-within:ring-ring/50',
                  voice.particle === option.id ? 'border-ring bg-muted font-medium' : 'hover:bg-muted/50'
                )}
              >
                <input
                  type="radio"
                  name="particle"
                  className="sr-only"
                  checked={voice.particle === option.id}
                  onChange={() => set({ particle: option.id })}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Thai forces this choice on every sentence. Without it the assistant picks afresh each
            time, and one reply can carry both.
          </p>
        </fieldset>

        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Register</legend>
          <div className="flex flex-wrap gap-2">
            {FORMALITIES.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer flex-col rounded-lg border px-3 py-2 transition-colors focus-within:ring-3 focus-within:ring-ring/50',
                  voice.formality === option.id
                    ? 'border-ring bg-muted'
                    : 'hover:bg-muted/50'
                )}
              >
                <input
                  type="radio"
                  name="formality"
                  className="sr-only"
                  checked={voice.formality === option.id}
                  onChange={() => set({ formality: option.id })}
                />
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor={`${ids}-traits`} className="text-sm font-medium">
            Character <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id={`${ids}-traits`}
            name="traits"
            rows={2}
            value={voice.traits}
            onChange={(event) => set({ traits: event.target.value })}
            placeholder="A barista who knows the beans well. Keen, never pushy…"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${ids}-avoid`} className="text-sm font-medium">
            Never Discuss <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id={`${ids}-avoid`}
            name="avoid"
            autoComplete="off"
            size="lg"
            value={voice.avoid}
            onChange={(event) => set({ avoid: event.target.value })}
            placeholder="politics, competitors…"
          />
          <p className="text-xs text-muted-foreground">
            Asked about these, the assistant says once that it cannot help and hands over.
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Instructions</h2>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={voice.instructions === defaults.instructions}
            onClick={() => set({ instructions: defaults.instructions })}
          >
            <RotateCcw />
            Reset to Default
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          The rules the assistant works under, sent ahead of every message. The Voice settings above
          are added underneath this.
        </p>

        <Textarea
          id={`${ids}-instructions`}
          name="instructions"
          aria-label="Instructions"
          rows={16}
          spellCheck={false}
          className="font-mono text-xs leading-relaxed"
          value={voice.instructions}
          onChange={(event) => set({ instructions: event.target.value })}
        />

        {/* Reported, never enforced. The shop owns what its assistant says; what
            it must not do is drop one of these without noticing. */}
        {warnings.length > 0 && (
          <ul aria-live="polite" className="space-y-2">
            {warnings.map((warning) => (
              <li
                key={warning.label}
                className="flex gap-2 rounded-lg border border-waiting/30 bg-waiting/10 p-2.5 text-xs text-waiting-ink"
              >
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  <strong className="font-medium">Removed: {warning.label}.</strong> {warning.risk}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">How It Will Sound</h2>
        <div className="rounded-lg border bg-muted/20 p-3">
          <MessageBubble
            message={{
              id: 'voice-preview',
              conversationId: 'preview',
              sender: 'ai',
              content: PARTICLES.find((p) => p.id === voice.particle)?.sample ?? '',
              contentType: 'text',
              createdAt: new Date(0).toISOString(),
              deliveryStatus: 'sent',
            }}
            align="start"
            tone="ai"
            label={null}
            announceAs="Preview of the assistant"
          />
        </div>

        <details className="rounded-lg border">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Show the exact text the model receives
          </summary>
          <pre className="overflow-x-auto border-t p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {prompt}
          </pre>
        </details>
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button type="button" size="lg" onClick={save} disabled={isSaving || !dirty}>
          {isSaving ? 'Saving…' : 'Save Assistant'}
        </Button>
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <p aria-live="polite" className="text-xs text-muted-foreground empty:hidden">
          {dirty ? '' : notice}
        </p>
      </div>
    </div>
  )
}
