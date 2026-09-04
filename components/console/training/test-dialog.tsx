'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import type { FaqMatch } from '@/lib/data/faq'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/**
 * What the bot would do with a question, asked from the page where the answers
 * are edited.
 *
 * It opens as a dialog rather than sitting above the list, and not only because
 * two text boxes doing unrelated things looked alike. Filtering is ambient — it
 * stays on while the operator works — where testing is episodic: ask, read the
 * ranking, go to the answer that won, done. A dialog is that shape, and it gives
 * the ranking room to be read, which a 300px column did not.
 *
 * The scores come from `search_faq` itself rather than from a copy of the rule
 * in TypeScript. Tuning a tag against a reimplementation would be tuning against
 * the wrong thing the moment the two drifted, and the whole value of this is
 * that its answer is the real one.
 */
export function TestDialog({
  query,
  open,
  onOpenChange,
  onQueryChange,
  onOpenEntry,
  onDraftFrom,
}: {
  query: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onQueryChange: (query: string) => void
  onOpenEntry: (id: string) => void
  onDraftFrom: (question: string) => void
}) {
  const [matches, setMatches] = useState<FaqMatch[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const asked = query.trim().length > 0

  useEffect(() => {
    const trimmed = query.trim()
    // Nothing to run. A closed dialog is not asking anything either, so a
    // question left in the URL does not cost a request until it is reopened.
    if (!trimmed || !open) return

    // The query is in the URL and therefore changes on every keystroke. A short
    // pause keeps that from becoming one round trip per character.
    const run = ++latest.current
    const timer = setTimeout(async () => {
      setIsRunning(true)
      try {
        const res = await fetch('/api/faq/test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: trimmed }),
        })
        const json = (await res.json().catch(() => null)) as {
          matches?: FaqMatch[]
          error?: string
        } | null

        // An earlier request that finished late must not overwrite a later one.
        if (run !== latest.current) return

        if (!res.ok) {
          setError(json?.error ?? `Could not run the test (${res.status})`)
          setMatches(null)
          return
        }
        setError(null)
        setMatches(json?.matches ?? [])
      } finally {
        if (run === latest.current) setIsRunning(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={inputRef}>
        <div className="border-b p-4">
          <DialogTitle>Try a Question</DialogTitle>
          <DialogDescription className="mt-0.5">
            Runs the real lookup. Nothing is sent to anybody.
          </DialogDescription>
          <Input
            ref={inputRef}
            id="faq-test"
            name="faq-test"
            autoComplete="off"
            size="xl"
            enterKeyHint="search"
            className="mt-3"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="พาหมาไปได้ไหม…"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-live="polite" aria-busy={isRunning}>
          {!asked && (
            <p className="p-6 text-center text-sm text-balance text-muted-foreground">
              Type the way a customer would, and see which answer the bot reaches for.
            </p>
          )}

          {asked && error && (
            <p role="alert" className="p-3 text-sm text-failed-ink">
              {error}
            </p>
          )}

          {asked && !error && matches !== null && matches.length === 0 && (
            <div className="m-2 space-y-3 rounded-lg border border-waiting/30 bg-waiting/10 p-4">
              <p className="text-sm text-waiting-ink">
                No answer matches. The bot would say it does not know and hand the customer to you.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => onDraftFrom(query)}>
                <Plus />
                Add an Answer for This
              </Button>
            </div>
          )}

          {asked && !error && matches !== null && matches.length > 0 && (
            <ol>
              {matches.map((match, index) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => onOpenEntry(match.id)}
                    className="group/result flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <span
                      className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums ${
                        index === 0 ? 'bg-ai text-ai-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{match.question}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {match.answer}
                      </span>
                    </span>
                    <span
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                      title="Sum of the trigger words that matched"
                    >
                      {match.score}
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/result:opacity-100"
                    />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What opens it. Kept beside the dialog so the shortcut it advertises and the
 * shortcut that works cannot drift apart.
 */
export function TestButton({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      onOpen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpen])

  return (
    <Button type="button" variant="outline" size="lg" onClick={onOpen}>
      <Sparkles />
      Try a Question
      <kbd className="ml-1 hidden rounded border px-1 font-sans text-[10px] text-muted-foreground md:inline">
        ⌘K
      </kbd>
    </Button>
  )
}
