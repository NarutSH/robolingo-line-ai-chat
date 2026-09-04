'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { FaqEntry } from '@/lib/data/faq-admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { downscaleImage, ImageUnreadable } from '@/lib/media/downscale'

interface Draft {
  question: string
  answer: string
  tags: string
  slug: string
  sortOrder: string
  isActive: boolean
}

const EMPTY: Draft = { question: '', answer: '', tags: '', slug: '', sortOrder: '100', isActive: true }

function toDraft(entry: FaqEntry): Draft {
  return {
    question: entry.question,
    answer: entry.answer,
    tags: entry.tags.join(', '),
    slug: entry.slug ?? '',
    sortOrder: String(entry.sortOrder),
    isActive: entry.isActive,
  }
}

/**
 * Tags are typed as one comma-separated line because that is how someone thinks
 * about them — a handful of words a customer might use — and a repeater with an
 * add button for each would be more interface for less.
 */
function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)))
}

export function TrainingBoard() {
  const [entries, setEntries] = useState<FaqEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<string | null>(null)

  const fetchEntries = useCallback(async (): Promise<FaqEntry[]> => {
    const res = await fetch('/api/faq', { cache: 'no-store' })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(json?.error ?? `Could not load the answers (${res.status})`)
    }
    return ((await res.json()) as { entries: FaqEntry[] }).entries
  }, [])

  const load = useCallback(async () => {
    try {
      setEntries(await fetchEntries())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [fetchEntries])

  // The fetch is kept out of the effect body and the state set from its
  // resolution, so nothing here is a synchronous render-triggering write.
  useEffect(() => {
    let cancelled = false
    fetchEntries()
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      cancelled = true
    }
  }, [fetchEntries])

  function startNew() {
    setEditingId('new')
    setDraft(EMPTY)
    setNotice(null)
  }

  function startEdit(entry: FaqEntry) {
    setEditingId(entry.id)
    setDraft(toDraft(entry))
    setNotice(null)
  }

  function cancel() {
    setEditingId(null)
    setDraft(EMPTY)
  }

  async function save() {
    const creating = editingId === 'new'
    const sortOrder = Number(draft.sortOrder)
    if (!Number.isFinite(sortOrder)) {
      setError('Order has to be a number.')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(creating ? '/api/faq' : `/api/faq/${editingId}`, {
        method: creating ? 'POST' : 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: draft.question,
          answer: draft.answer,
          tags: parseTags(draft.tags),
          slug: draft.slug.trim() || null,
          isActive: draft.isActive,
          sortOrder,
        }),
      })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `Could not save (${res.status})`)
        return
      }

      setError(null)
      setNotice(creating ? 'Answer added. The bot can use it on the next message.' : 'Saved.')
      cancel()
      await load()
    } finally {
      setIsSaving(false)
    }
  }

  async function remove(entry: FaqEntry) {
    if (!window.confirm(`Delete "${entry.question}"? The bot will stop answering this.`)) return

    const res = await fetch(`/api/faq/${entry.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? `Could not delete (${res.status})`)
      return
    }
    setError(null)
    setNotice('Deleted.')
    await load()
  }

  function chooseImage(entry: FaqEntry) {
    if (!entry.slug) {
      setError('Give this answer a name first — it is how the bot asks for the picture.')
      return
    }
    uploadTargetRef.current = entry.id
    fileRef.current?.click()
  }

  async function uploadImage(file: File) {
    const id = uploadTargetRef.current
    if (!id) return

    setUploadingId(id)
    try {
      // Shrunk here rather than sent as it came off the camera: the platform
      // refuses an oversized body before our handler ever runs, and its reply
      // is a plain-text 413 the operator cannot act on.
      let prepared: File
      try {
        prepared = await downscaleImage(file)
      } catch (cause) {
        setError(cause instanceof ImageUnreadable ? cause.message : 'That image could not be read.')
        return
      }

      const form = new FormData()
      form.set('image', prepared)
      const res = await fetch(`/api/faq/${id}/image`, { method: 'POST', body: form })

      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? `Could not save the picture (${res.status})`)
        return
      }
      setError(null)
      setNotice('Picture attached. The bot can send it when this answer matches.')
      await load()
    } finally {
      setUploadingId(null)
      uploadTargetRef.current = null
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeImage(entry: FaqEntry) {
    if (!window.confirm('Remove the picture from this answer?')) return

    const res = await fetch(`/api/faq/${entry.id}/image`, { method: 'DELETE' })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? `Could not remove the picture (${res.status})`)
      return
    }
    setError(null)
    setNotice('Picture removed.')
    await load()
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <input
        ref={fileRef}
        type="file"
        // Anything the browser can decode: it is re-encoded as a JPEG on the way
        // out, so a photo straight off a phone arrives in a form LINE accepts.
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void uploadImage(file)
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-prose">
          <h1 className="text-lg font-semibold">Training</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything the bot is allowed to say comes from this list. If an answer is not here,
            the bot says it does not know and passes the customer to you — so adding one is how
            you teach it, and no deploy is involved.
          </p>
        </div>
        <Button type="button" size="lg" onClick={startNew} disabled={editingId === 'new'}>
          <Plus />
          New answer
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-failed/30 bg-failed/10 px-3 py-2 text-sm text-failed-ink"
        >
          <p>{error}</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <p aria-live="polite" className="mt-2 text-sm text-muted-foreground">
        {notice}
      </p>

      {editingId === 'new' && (
        <EntryForm
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          isSaving={isSaving}
          heading="New answer"
        />
      )}

      {entries === null ? (
        <ul className="mt-4 space-y-3" aria-busy="true" aria-label="Loading answers">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="h-24 animate-pulse rounded-lg border bg-muted/40 motion-reduce:animate-none"
            />
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing here yet. Add the questions customers ask most — opening hours, where you are,
          what is on the menu.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) =>
            editingId === entry.id ? (
              <li key={entry.id}>
                <EntryForm
                  draft={draft}
                  setDraft={setDraft}
                  onSave={save}
                  onCancel={cancel}
                  isSaving={isSaving}
                  heading="Editing"
                />
              </li>
            ) : (
              <li
                key={entry.id}
                className={cn('rounded-lg border p-3', !entry.isActive && 'opacity-60')}
              >
                <div className="flex gap-3">
                  {entry.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- storage host is per-project
                    <img
                      src={entry.imageUrl}
                      alt={`Picture for ${entry.question}`}
                      className="size-16 shrink-0 rounded-md object-cover"
                    />
                  ) : null}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{entry.question}</p>
                      {!entry.isActive && (
                        <span className="rounded border px-1.5 py-px text-[10px] font-medium text-muted-foreground uppercase">
                          Off
                        </span>
                      )}
                      {entry.slug && (
                        <span className="rounded border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                          {entry.slug}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{entry.answer}</p>
                    {entry.tags.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        Matches on: {entry.tags.join(' · ')}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(entry)}
                    >
                      <Pencil />
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingId === entry.id}
                      onClick={() => (entry.imageUrl ? removeImage(entry) : chooseImage(entry))}
                    >
                      {entry.imageUrl ? <X /> : <ImagePlus />}
                      {uploadingId === entry.id
                        ? 'Saving…'
                        : entry.imageUrl
                          ? 'Remove picture'
                          : 'Add picture'}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => remove(entry)}
                    >
                      <Trash2 />
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

function EntryForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  isSaving,
  heading,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
  heading: string
}) {
  return (
    <form
      className="mt-4 space-y-3 rounded-lg border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <h2 className="text-sm font-semibold">{heading}</h2>

      <div className="space-y-1.5">
        <label htmlFor="faq-question" className="text-sm font-medium">
          Question
        </label>
        <Input
          id="faq-question"
          size="lg"
          value={draft.question}
          onChange={(event) => setDraft({ ...draft, question: event.target.value })}
          placeholder="เปิดกี่โมง"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="faq-answer" className="text-sm font-medium">
          Answer
        </label>
        <Textarea
          id="faq-answer"
          rows={3}
          value={draft.answer}
          onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
          placeholder="เปิดทุกวัน 07:00–19:00 น. ครับ / Open every day 07:00–19:00."
        />
        <p className="text-xs text-muted-foreground">
          The bot passes this on close to word for word, in the customer&apos;s language. Writing
          both languages here is the surest way to control what they read.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="faq-tags" className="text-sm font-medium">
          Words that should match it
        </label>
        <Input
          id="faq-tags"
          size="lg"
          value={draft.tags}
          onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
          placeholder="เปิด, กี่โมง, เวลา, hours, open"
        />
        <p className="text-xs text-muted-foreground">
          Separated by commas. A tag matches when it appears inside what the customer typed, so
          short and specific beats long: <code>เปิด</code> catches <code>เปิดกี่โมง</code>. Avoid
          very common words like <code>ไป</code> — they match almost every sentence.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="faq-slug" className="text-sm font-medium">
            Picture name <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Input
            id="faq-slug"
            size="lg"
            value={draft.slug}
            onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
            placeholder="menu"
          />
          <p className="text-xs text-muted-foreground">
            Needed before you can attach a picture — it is the name the bot asks for. Lowercase
            letters, numbers and dashes.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="faq-order" className="text-sm font-medium">
            Order
          </label>
          <Input
            id="faq-order"
            size="lg"
            inputMode="numeric"
            value={draft.sortOrder}
            onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Breaks ties when two answers match equally well. Lower comes first.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
          className="size-4 rounded border-input accent-primary"
        />
        The bot may use this answer
      </label>

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
