'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { FaqMatch } from '@/lib/data/faq'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * What the bot would do with a question, asked from the page where the answers
 * are edited.
 *
 * The scores come from `search_faq` itself rather than from a copy of the rule
 * in TypeScript. Tuning a tag against a reimplementation would be tuning against
 * the wrong thing the moment the two drifted, and the whole value of the box is
 * that its answer is the real one.
 */
export function TestBar({
  query,
  onQueryChange,
  onOpenEntry,
  onDraftFrom,
}: {
  query: string
  onQueryChange: (query: string) => void
  onOpenEntry: (id: string) => void
  onDraftFrom: (question: string) => void
}) {
  const [matches, setMatches] = useState<FaqMatch[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const asked = query.trim().length > 0

  useEffect(() => {
    const trimmed = query.trim()
    // Nothing to run, and nothing to clear: an empty box hides its results
    // below rather than storing the emptiness.
    if (!trimmed) return

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
  }, [query])

  return (
    <div className="space-y-2 border-b p-3">
      <label htmlFor="faq-test" className="flex items-center gap-1.5 text-sm font-medium">
        <Search aria-hidden className="size-3.5" />
        Try a Question
      </label>
      <Input
        id="faq-test"
        name="faq-test"
        autoComplete="off"
        size="lg"
        enterKeyHint="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="พาหมาไปได้ไหม…"
      />
      <p className="text-xs text-muted-foreground">
        Runs the real lookup. Nothing is sent to anybody.
      </p>

      <div aria-live="polite" aria-busy={isRunning}>
        {asked && error && (
          <p role="alert" className="text-xs text-failed-ink">
            {error}
          </p>
        )}

        {asked && matches !== null && matches.length === 0 && !error && (
          <div className="space-y-2 rounded-lg border border-waiting/30 bg-waiting/10 p-2.5">
            <p className="text-xs text-waiting-ink">
              No answer matches. The bot would tell the customer it does not know and hand them to
              you.
            </p>
            <Button type="button" variant="outline" size="xs" onClick={() => onDraftFrom(query)}>
              <Plus />
              Add an Answer for This
            </Button>
          </div>
        )}

        {asked && matches !== null && matches.length > 0 && (
          <ol className="space-y-1">
            {matches.map((match, index) => (
              <li key={match.id}>
                <button
                  type="button"
                  onClick={() => onOpenEntry(match.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-medium tabular-nums ${
                      index === 0 ? 'bg-ai text-ai-foreground' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs">{match.question}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {match.score}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
