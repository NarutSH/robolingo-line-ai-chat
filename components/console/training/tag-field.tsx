'use client'

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import type { TagWarning } from '@/lib/faq/tags'
import { tagWeight } from '@/lib/faq/tags'
import { cn } from '@/lib/utils'

/**
 * The trigger words, as the thing that decides which answer wins.
 *
 * The ranking sums the lengths of the tags that matched — the answer text has
 * no bearing on it at all — so each word carries the number of points it is
 * worth. "Short and specific beats long" used to be a paragraph of helper text
 * under a comma-separated input; here it is a column of numbers the operator
 * can compare.
 */
export function TagField({
  tags,
  warnings,
  onChange,
  id,
}: {
  tags: string[]
  warnings: TagWarning[]
  onChange: (tags: string[]) => void
  id: string
}) {
  const [pending, setPending] = useState('')

  function commit(raw: string) {
    const tag = raw.trim().replace(/,+$/, '').trim()
    setPending('')
    if (!tag) return
    // Case-insensitively, because the match is: adding both `wifi` and `WiFi`
    // would double the score for one word.
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return
    onChange([...tags, tag])
  }

  const warningFor = (tag: string) => warnings.find((w) => w.tag === tag)

  return (
    <div className="space-y-2">
      {/* A label rather than a div with a click handler: clicking the
          whitespace around the chips should put the caret where the next word
          goes, and the browser already does that for a label wrapping an
          input — no JavaScript, and it works from the keyboard for free. */}
      <label
        htmlFor={id}
        className="flex cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      >
        {tags.map((tag) => {
          const warning = warningFor(tag)
          return (
            <span
              key={tag}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-2 text-sm',
                warning
                  ? 'border-waiting/40 bg-waiting/10 text-waiting-ink'
                  : 'border-border bg-muted/60'
              )}
            >
              {warning && <AlertTriangle aria-hidden className="size-3" />}
              <span translate="no">{tag}</span>
              {/* What this word is worth when it matches, which is exactly
                  what the ranking adds. */}
              <span
                aria-label={`worth ${tagWeight(tag)} points`}
                className="rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums opacity-70"
              >
                {tagWeight(tag)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
                className="grid size-5 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}

        <input
          id={id}
          name="trigger-word"
          value={pending}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder={tags.length === 0 ? 'เปิด, กี่โมง, hours…' : 'Add another…'}
          onChange={(event) => {
            // A comma commits too, so a list pasted from the old field still
            // arrives as separate words rather than one long tag.
            if (event.target.value.includes(',')) {
              const parts = event.target.value.split(',')
              const last = parts.pop() ?? ''
              parts.forEach(commit)
              setPending(last)
              return
            }
            setPending(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Never let this reach the form: pressing Enter after typing a
              // word means "add the word", not "save the answer".
              event.preventDefault()
              commit(pending)
            }
            if (event.key === 'Backspace' && !pending && tags.length > 0) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={() => commit(pending)}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </label>

      {warnings.length > 0 && (
        <ul className="space-y-1" aria-live="polite">
          {warnings.map((warning) => (
            <li
              key={`${warning.kind}-${warning.tag}`}
              className="flex gap-1.5 text-xs text-waiting-ink"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        A word matches when it appears <em>inside</em> what the customer typed, so{' '}
        <code translate="no">เปิด</code> catches <code translate="no">เปิดกี่โมง</code>. The number
        on each word is what it adds to the score when it matches — longer words count for more,
        which is how a specific word beats a common one.
      </p>
    </div>
  )
}
