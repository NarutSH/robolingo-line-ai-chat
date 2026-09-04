'use client'

import { ChevronDown, ChevronUp, ImageIcon } from 'lucide-react'
import type { FaqEntry } from '@/lib/data/faq-admin'
import type { TagWarning } from '@/lib/faq/tags'
import { cn } from '@/lib/utils'

/**
 * The answers, split by whether the bot can see them.
 *
 * `is_active` is a `where` clause on the lookup, not a shade of grey: an answer
 * that is off is not a faded version of a live one, it is absent from every
 * search the bot runs. Two groups say that; one list at two opacities does not.
 */
export function AnswerList({
  entries,
  total,
  activeId,
  warningsFor,
  onSelect,
  onMove,
}: {
  /** The rows to show, after any filter. */
  entries: FaqEntry[]
  /** Every answer, so a group's count states what it holds rather than what
   *  the current filter left of it. */
  total: FaqEntry[]
  activeId: string | null
  warningsFor: (entry: FaqEntry) => TagWarning[]
  onSelect: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  return (
    <div className="space-y-4 p-2">
      <Group
        title="Live"
        hint="The bot can use these."
        entries={entries.filter((entry) => entry.isActive)}
        held={total.filter((entry) => entry.isActive).length}
        activeId={activeId}
        warningsFor={warningsFor}
        onSelect={onSelect}
        onMove={onMove}
      />
      {/* Rendered even when it is empty. "Off 0" is the reassurance that every
          answer the shop has written is one the bot can actually reach. */}
      <Group
        title="Off"
        hint="Invisible to the bot until switched back on."
        entries={entries.filter((entry) => !entry.isActive)}
        held={total.filter((entry) => !entry.isActive).length}
        activeId={activeId}
        warningsFor={warningsFor}
        onSelect={onSelect}
        onMove={onMove}
      />
    </div>
  )
}

function Group({
  title,
  hint,
  entries,
  held,
  activeId,
  warningsFor,
  onSelect,
  onMove,
}: {
  title: string
  hint: string
  entries: FaqEntry[]
  held: number
  activeId: string | null
  warningsFor: (entry: FaqEntry) => TagWarning[]
  onSelect: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
}) {
  return (
    <section aria-labelledby={`faq-group-${title}`}>
      <h2
        id={`faq-group-${title}`}
        className="flex items-baseline gap-2 px-2 py-1 text-xs font-medium text-muted-foreground uppercase"
      >
        {title}
        <span className="tabular-nums">{held}</span>
        <span className="truncate text-[10px] normal-case opacity-70">{hint}</span>
      </h2>

      {entries.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {held === 0 ? 'Nothing here.' : 'Nothing here matches your search.'}
        </p>
      ) : (
        <ul>
          {entries.map((entry, index) => {
            const warnings = warningsFor(entry)
            const isActive = entry.id === activeId
            return (
              <li key={entry.id} className="group/row flex items-stretch gap-1">
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(entry.id)}
                  className={cn(
                    'min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    isActive && 'bg-muted'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {entry.question}
                    </span>
                    {entry.imageUrl && (
                      <ImageIcon aria-label="has a picture" className="size-3.5 shrink-0 opacity-60" />
                    )}
                    {warnings.length > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-waiting/20 px-1.5 text-[10px] font-medium text-waiting-ink tabular-nums"
                        title={`${warnings.length} trigger word problems`}
                      >
                        {warnings.length}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {entry.tags.length > 0 ? entry.tags.join(' · ') : 'No trigger words'}
                  </span>
                </button>

                {/* Buttons rather than a drag handle. Order is a tie-break
                    between two answers; nudging one past its neighbour is the
                    whole operation, and it has to work without a mouse. */}
                <span className="flex shrink-0 flex-col justify-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label={`Move ${entry.question} up`}
                    disabled={index === 0}
                    onClick={() => onMove(entry.id, -1)}
                    className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${entry.question} down`}
                    disabled={index === entries.length - 1}
                    onClick={() => onMove(entry.id, 1)}
                    className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-30"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
