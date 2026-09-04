'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Plus, Undo2 } from 'lucide-react'
import type { FaqEntry } from '@/lib/data/faq-admin'
import { tagWarnings, type TagNeighbour } from '@/lib/faq/tags'
import { downscaleImage, ImageUnreadable } from '@/lib/media/downscale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AnswerList } from '@/components/console/training/answer-list'
import { TestButton, TestDialog } from '@/components/console/training/test-dialog'
import {
  EMPTY_DRAFT,
  EntryEditor,
  isDirty,
  toDraft,
  type Draft,
} from '@/components/console/training/entry-editor'

/**
 * How long a deleted answer can be brought back.
 *
 * The delete is *held* for this window rather than sent and reversed: bringing
 * the row back afterwards would mean re-creating it under a new id, with its
 * picture already swept out of the bucket. Waiting costs nothing and keeps undo
 * honest — the row is genuinely still there.
 */
const UNDO_MS = 8000

/** The same map without one key, since an unsaved draft has been dealt with. */
function without(drafts: Record<string, Draft>, key: string): Record<string, Draft> {
  const kept = { ...drafts }
  delete kept[key]
  return kept
}

/**
 * What went wrong, in the server's words where it gave any. Every route here
 * answers a failure the same way — `{ error }` and a status — so reading one
 * belongs in one place rather than at each of the six call sites.
 */
async function refusal(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: string } | null
  return json?.error ?? `${fallback} (${res.status})`
}

export function TrainingBoard() {
  const router = useRouter()
  const params = useSearchParams()

  const [entries, setEntries] = useState<FaqEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<FaqEntry | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selected = params.get('entry')
  const filter = params.get('q') ?? ''
  /** Present means the dialog is open; its value is what is being asked. */
  const testQuery = params.get('test')
  /** A question the test box could not answer, carried into a new entry. */
  const seed = params.get('draft') ?? ''

  const setParam = useCallback(
    (updates: Record<string, string | null>, { remember = false } = {}) => {
      const next = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(updates)) {
        // Null removes the parameter; an empty string keeps it. The test
        // dialog needs that difference — `?test=` with nothing after it is an
        // open dialog with nothing typed into it yet.
        if (value === null) next.delete(key)
        else next.set(key, value)
      }
      const url = next.size > 0 ? `/console/training?${next}` : '/console/training'
      // Selecting an answer is a place worth going back to; typing into a
      // filter is not, and pushing every keystroke would bury the browser's
      // back button under the operator's own typing.
      if (remember) router.push(url, { scroll: false })
      else router.replace(url, { scroll: false })
    },
    [params, router]
  )

  const load = useCallback(async (): Promise<FaqEntry[]> => {
    const res = await fetch('/api/faq', { cache: 'no-store' })
    if (!res.ok) throw new Error(await refusal(res, 'Could not load the answers'))
    return ((await res.json()) as { entries: FaqEntry[] }).entries
  }, [])

  useEffect(() => {
    let cancelled = false
    load()
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [load])

  // Everything below is derived from the URL and the loaded rows, so a reload
  // of either lands on exactly the same screen.
  const visible = useMemo(() => {
    const rows = (entries ?? []).filter((entry) => entry.id !== pendingDelete?.id)
    const needle = filter.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((entry) =>
      [entry.question, entry.answer, ...entry.tags].some((field) =>
        field.toLowerCase().includes(needle)
      )
    )
  }, [entries, filter, pendingDelete])

  const entry = useMemo(
    () => (selected && selected !== 'new' ? (entries?.find((e) => e.id === selected) ?? null) : null),
    [entries, selected]
  )

  const neighbours: TagNeighbour[] = useMemo(
    () =>
      (entries ?? []).map((e) => ({
        id: e.id,
        question: e.question,
        tags: e.tags,
        isActive: e.isActive,
      })),
    [entries]
  )

  const takenSlugs = useMemo(
    () => (entries ?? []).flatMap((e) => (e.slug && e.id !== entry?.id ? [e.slug] : [])),
    [entries, entry?.id]
  )

  /**
   * What the editor is currently showing, and what it was showing when it was
   * filled. The key changes on exactly the two occasions the form should be
   * refilled from the server — a different answer was selected, or a save
   * brought back a newer version of this one — so the refill happens in render
   * rather than in an effect that would paint the old values first.
   */
  const formKey = selected === 'new' ? `new:${seed}` : `${selected}:${entry?.updatedAt ?? ''}`
  const fromServer = (): Draft => (entry ? toDraft(entry) : { ...EMPTY_DRAFT, question: seed })

  /**
   * Moving between answers -- by clicking a row, by following a test result, by
   * pressing the browser's back button -- must not cost the operator what they
   * have written. A confirmation dialog on every one of those would be the
   * usual answer and the wrong one: it interrupts the common case to protect
   * the rare one, and the browser's own back button cannot be talked out of
   * navigating anyway. So an unsaved draft is kept rather than guarded, and only
   * Cancel -- the operator saying outright that they are discarding it -- throws
   * anything away.
   */
  const [form, setForm] = useState(() => ({
    key: formKey,
    draft: fromServer(),
    baseline: fromServer(),
    /**
     * Answers whose form has been typed into but not saved, kept here beside
     * the form itself rather than in a ref, because the drafts and the answer
     * currently shown change in the same breath.
     */
    unsaved: {} as Record<string, Draft>,
  }))

  if (form.key !== formKey) {
    const baseline = fromServer()
    const unsaved = isDirty(form.draft, form.baseline)
      ? { ...form.unsaved, [form.key]: form.draft }
      : form.unsaved
    setForm({ key: formKey, draft: unsaved[formKey] ?? baseline, baseline, unsaved })
  }

  const draft = form.draft
  const setDraft = (next: Draft) => setForm((current) => ({ ...current, draft: next }))
  const dirty = Boolean(selected) && isDirty(form.draft, form.baseline)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Closes the editor, throwing the draft away. The one path that does. */
  function discard() {
    if (dirty && !window.confirm('Discard what you have typed?')) return
    setForm((current) => ({
      ...current,
      draft: current.baseline,
      unsaved: without(current.unsaved, formKey),
    }))
    setParam({ entry: null, draft: null }, { remember: true })
  }

  function select(id: string | null) {
    setParam({ entry: id, draft: null }, { remember: true })
  }

  async function save(next: Draft): Promise<string | null> {
    const creating = !entry
    setIsSaving(true)
    try {
      const res = await fetch(creating ? '/api/faq' : `/api/faq/${entry.id}`, {
        method: creating ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: next.question,
          answer: next.answer,
          tags: next.tags,
          slug: next.slug.trim() || null,
          isActive: next.isActive,
          sortOrder: Number(next.sortOrder),
        }),
      })

      const json = (await res.json().catch(() => null)) as {
        entry?: FaqEntry
        error?: string
      } | null

      if (!res.ok) {
        const reason = json?.error ?? `Could not save (${res.status})`
        setError(reason)
        return reason
      }

      setError(null)
      // Saved, so it is no longer something to carry between answers.
      setForm((current) => ({ ...current, unsaved: without(current.unsaved, formKey) }))
      setEntries(await load())
      setNotice(creating ? 'Added. The bot can use it on the next message.' : 'Saved.')
      // A newly created answer stays open, because attaching a picture to it is
      // the very next thing anyone does and that needs a saved row. Either way
      // the form refills itself from what came back: the reload changed the
      // row's updatedAt, and that is the key it is filled against.
      if (creating && json?.entry) setParam({ entry: json.entry.id })
      return null
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Held, not sent. Until the window closes the row is untouched, so undo is a
   * cancelled timer rather than a re-creation that would come back with a new id
   * and no picture.
   */
  function beginDelete() {
    if (!entry) return
    setPendingDelete(entry)
    setNotice(null)
    setParam({ entry: null })

    undoTimer.current = setTimeout(async () => {
      undoTimer.current = null
      const res = await fetch(`/api/faq/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) setError(await refusal(res, 'Could not delete'))
      setPendingDelete(null)
      setEntries(await load().catch(() => entries ?? []))
    }, UNDO_MS)
  }

  function undoDelete() {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = null
    setPendingDelete(null)
  }

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
    },
    []
  )

  async function attachImage(file: File) {
    if (!entry) return
    setIsUploading(true)
    try {
      // The picture's handle has to exist on the row before the upload route
      // will take it, and the editor may have only just derived one. Only the
      // name is written: saving the whole draft here would quietly commit every
      // other unsaved edit in the form, including ones the Save button would
      // have refused.
      const named = draft.slug.trim()
      if (named && named !== (entry.slug ?? '')) {
        const failed = await save({ ...toDraft(entry), slug: named })
        if (failed) return
      }

      let prepared: File
      try {
        // Shrunk here rather than sent as it came off the camera: the platform
        // refuses an oversized body before our handler runs, with a plain-text
        // 413 the operator cannot act on.
        prepared = await downscaleImage(file)
      } catch (cause) {
        setError(cause instanceof ImageUnreadable ? cause.message : 'That image could not be read.')
        return
      }

      const form = new FormData()
      form.set('image', prepared)
      const res = await fetch(`/api/faq/${entry.id}/image`, { method: 'POST', body: form })

      if (!res.ok) {
        setError(await refusal(res, 'Could not save the picture'))
        return
      }
      setError(null)
      setNotice('Picture attached. The bot can send it when this answer matches.')
      setEntries(await load())
    } finally {
      setIsUploading(false)
    }
  }

  async function removeImage() {
    if (!entry) return
    if (!window.confirm('Remove the picture from this answer?')) return

    const res = await fetch(`/api/faq/${entry.id}/image`, { method: 'DELETE' })
    if (!res.ok) {
      setError(await refusal(res, 'Could not remove the picture'))
      return
    }
    setError(null)
    setNotice('Picture removed.')
    setEntries(await load())
  }

  /**
   * Moves an answer past its neighbour and writes the whole resulting order in
   * one request. The list shows the new order at once and is put back exactly as
   * it was if the write is refused.
   */
  async function move(id: string, direction: -1 | 1) {
    if (!entries) return
    const moving = visible.find((e) => e.id === id)
    if (!moving) return
    // Order is only ever relative within a group: an answer the bot cannot see
    // is not competing with one it can.
    const group = visible.filter((e) => e.isActive === moving.isActive)
    const at = group.findIndex((e) => e.id === id)
    const neighbour = group[at + direction]
    if (!neighbour) return

    const reordered = [...entries]
    const from = reordered.findIndex((e) => e.id === id)
    const to = reordered.findIndex((e) => e.id === neighbour.id)
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)

    const before = entries
    setEntries(reordered)

    const res = await fetch('/api/faq/reorder', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map((e) => e.id) }),
    })

    if (!res.ok) {
      setError(await refusal(res, 'Could not save the order'))
      setEntries(before)
      return
    }
    setError(null)
    setEntries(((await res.json()) as { entries: FaqEntry[] }).entries)
  }

  const warningsFor = useCallback(
    (row: FaqEntry) => tagWarnings(row.id, row.tags, neighbours),
    [neighbours]
  )

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <TestDialog
        open={testQuery !== null}
        onOpenChange={(next) => setParam({ test: next ? (testQuery ?? '') : null })}
        query={testQuery ?? ''}
        onQueryChange={(next) => setParam({ test: next })}
        onOpenEntry={(id) => {
          setParam({ entry: id, test: null }, { remember: true })
        }}
        // The unanswered question travels in the URL, so the answer it seeds
        // survives a reload like everything else on this page.
        onDraftFrom={(question) =>
          setParam({ entry: 'new', draft: question, test: null }, { remember: true })
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Training</h1>
          <p className="text-sm text-balance text-muted-foreground">
            Everything the bot can say comes from this list.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TestButton onOpen={() => setParam({ test: testQuery ?? '' })} />
          <Button type="button" size="lg" onClick={() => select('new')}>
            <Plus />
            New Answer
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        {/* One column at a time on a phone: the editor takes the screen and
            offers a way back, rather than the two panes squeezing each other. */}
        <div
          className={`min-h-0 flex-col overflow-y-auto border-r ${selected ? 'hidden md:flex' : 'flex'}`}
        >
          <div className="border-b p-3">
            <label htmlFor="faq-filter" className="sr-only">
              Find an answer
            </label>
            <Input
              id="faq-filter"
              name="faq-filter"
              type="search"
              autoComplete="off"
              size="lg"
              value={filter}
              onChange={(event) => setParam({ q: event.target.value || null })}
              placeholder="Find by question, answer or word…"
            />
          </div>

          {entries === null ? (
            <ul className="space-y-2 p-3" aria-busy="true" aria-label="Loading answers">
              {[0, 1, 2, 3].map((row) => (
                <li
                  key={row}
                  className="h-12 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none"
                />
              ))}
            </ul>
          ) : entries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing here yet. Add the questions customers ask most: opening hours, where you are,
              what is on the menu.
            </p>
          ) : (
            <AnswerList
              entries={visible}
              total={entries.filter((row) => row.id !== pendingDelete?.id)}
              activeId={entry?.id ?? null}
              warningsFor={warningsFor}
              onSelect={select}
              onMove={move}
            />
          )}
        </div>

        <div className={`min-h-0 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
          {selected && (
            <div className="flex items-center gap-2 border-b px-3 py-2 md:hidden">
              <Button type="button" variant="ghost" size="sm" onClick={() => select(null)}>
                <ArrowLeft />
                All Answers
              </Button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 border-b border-failed/30 bg-failed/10 px-4 py-2 text-sm text-failed-ink"
            >
              <p>{error}</p>
              <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
                Dismiss
              </Button>
            </div>
          )}

          {pendingDelete && (
            <div className="flex items-center justify-between gap-3 border-b border-waiting/30 bg-waiting/10 px-4 py-2 text-sm text-waiting-ink">
              <p>
                Deleted “{pendingDelete.question}”. The bot will stop answering it.
              </p>
              <Button type="button" variant="outline" size="xs" onClick={undoDelete}>
                <Undo2 />
                Undo
              </Button>
            </div>
          )}

          {/* Announced and drawn. This is the confirmation that an edit reached
              the bot, and it was doing neither for a sighted operator. */}
          <p aria-live="polite" className="px-4 pt-2 text-xs text-muted-foreground empty:hidden">
            {notice}
          </p>

          {selected ? (
            <EntryEditor
              // Remounting on selection keeps a half-open Advanced section or a
              // stale validation message from following the operator to the next
              // answer.
              key={selected}
              entry={entry}
              draft={draft}
              setDraft={setDraft}
              neighbours={neighbours}
              takenSlugs={takenSlugs}
              onSave={save}
              onCancel={discard}
              onDelete={beginDelete}
              onAttachImage={attachImage}
              onRemoveImage={removeImage}
              isSaving={isSaving}
              isUploading={isUploading}
            />
          ) : (
            <div className="hidden place-items-center p-8 text-center md:grid">
              <p className="max-w-sm text-sm text-balance text-muted-foreground">
                Pick an answer to edit it, or try a question on the left to see which answer the bot
                would reach for.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
