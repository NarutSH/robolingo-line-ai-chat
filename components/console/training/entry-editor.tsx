'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import type { FaqEntry } from '@/lib/data/faq-admin'
import { deriveSlug, SLUG_PATTERN, tagWarnings, type TagNeighbour } from '@/lib/faq/tags'
import { MessageBubble } from '@/components/chat/message-bubble'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TagField } from '@/components/console/training/tag-field'

export interface Draft {
  question: string
  answer: string
  tags: string[]
  slug: string
  sortOrder: string
  isActive: boolean
}

export const EMPTY_DRAFT: Draft = {
  question: '',
  answer: '',
  tags: [],
  slug: '',
  sortOrder: '100',
  isActive: true,
}

export function toDraft(entry: FaqEntry): Draft {
  return {
    question: entry.question,
    answer: entry.answer,
    tags: entry.tags,
    slug: entry.slug ?? '',
    sortOrder: String(entry.sortOrder),
    isActive: entry.isActive,
  }
}

export function isDirty(draft: Draft, against: Draft): boolean {
  return (
    draft.question !== against.question ||
    draft.answer !== against.answer ||
    draft.slug !== against.slug ||
    draft.sortOrder !== against.sortOrder ||
    draft.isActive !== against.isActive ||
    draft.tags.join(' ') !== against.tags.join(' ')
  )
}

type FieldErrors = Partial<Record<'question' | 'answer' | 'slug' | 'sortOrder', string>>

export function EntryEditor({
  entry,
  draft,
  setDraft,
  neighbours,
  takenSlugs,
  onSave,
  onCancel,
  onDelete,
  onAttachImage,
  onRemoveImage,
  isSaving,
  isUploading,
}: {
  /** Null while a brand new answer is being written. */
  entry: FaqEntry | null
  draft: Draft
  setDraft: (draft: Draft) => void
  neighbours: TagNeighbour[]
  takenSlugs: string[]
  /** Resolves to the server's complaint, or null when the save landed. */
  onSave: (draft: Draft) => Promise<string | null>
  onCancel: () => void
  onDelete: () => void
  onAttachImage: (file: File) => void
  onRemoveImage: () => void
  isSaving: boolean
  isUploading: boolean
}) {
  const ids = useId()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [showAdvanced, setShowAdvanced] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const entryRef = useRef(entry)
  const questionRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const slugRef = useRef<HTMLInputElement>(null)

  const warnings = useMemo(
    () => tagWarnings(entry?.id ?? 'new', draft.tags, neighbours),
    [entry?.id, draft.tags, neighbours]
  )

  // A fresh answer gets the caret; an existing one does not, because the
  // operator got here by clicking the row they wanted, and pulling their focus
  // out of the list would lose their place in it. Nothing else is reset here:
  // the board remounts this form when the selection changes, so a stale error
  // or a half-open Advanced section cannot survive to the next answer.
  useEffect(() => {
    if (!entryRef.current) questionRef.current?.focus()
  }, [])

  function validate(): FieldErrors {
    const found: FieldErrors = {}
    if (!draft.question.trim()) found.question = 'Give the question customers actually ask.'
    if (!draft.answer.trim()) found.answer = 'Write what the bot should say back.'
    if (draft.slug.trim() && !SLUG_PATTERN.test(draft.slug.trim())) {
      found.slug = 'Use lowercase letters, numbers and dashes. The bot types this.'
    }
    if (!Number.isFinite(Number(draft.sortOrder))) found.sortOrder = 'The order has to be a number.'
    return found
  }

  async function submit() {
    const found = validate()
    setErrors(found)

    // Focus goes to the first field that is wrong, in reading order. A banner at
    // the top of the page cannot say which of five fields it is about.
    if (found.question) return questionRef.current?.focus()
    if (found.answer) return answerRef.current?.focus()
    if (found.slug || found.sortOrder) {
      setShowAdvanced(true)
      if (found.slug) slugRef.current?.focus()
      return
    }

    const failed = await onSave(draft)
    // The server knows one thing the browser cannot: whether another answer has
    // already taken this name. Its complaint lands on the field it is about.
    if (failed && /name/i.test(failed)) {
      setShowAdvanced(true)
      setErrors({ slug: failed })
      slugRef.current?.focus()
    }
  }

  /**
   * A picture needs a handle the agent can type. Deriving one from the question
   * is the whole difference between attaching a picture and being told to go
   * and invent a name first, with nowhere to type it.
   */
  function chooseImage() {
    if (!draft.slug.trim()) {
      setDraft({ ...draft, slug: deriveSlug(draft.question, takenSlugs) })
    }
    fileRef.current?.click()
  }

  const previewText = draft.answer.trim()

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onAttachImage(file)
          event.target.value = ''
        }}
      />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 md:p-6">
        <Field
          id={`${ids}-question`}
          label="Question"
          hint="The way a customer would put it. It also counts as a trigger word on its own, worth ten points when the whole thing appears in a message."
          error={errors.question}
        >
          <Input
            ref={questionRef}
            id={`${ids}-question`}
            name="faq-question"
            autoComplete="off"
            size="lg"
            aria-invalid={Boolean(errors.question)}
            value={draft.question}
            onChange={(event) => setDraft({ ...draft, question: event.target.value })}
            placeholder="เปิดกี่โมง…"
          />
        </Field>

        <Field
          id={`${ids}-tags`}
          label="Trigger Words"
          hint="What decides whether this is the answer the customer gets. Nothing else on this form does."
        >
          <TagField
            id={`${ids}-tags`}
            tags={draft.tags}
            warnings={warnings}
            onChange={(tags) => setDraft({ ...draft, tags })}
          />
        </Field>

        <Field
          id={`${ids}-answer`}
          label="Answer"
          hint="Passed on close to word for word. Writing both languages here is the surest way to control what the customer reads."
          error={errors.answer}
        >
          <Textarea
            ref={answerRef}
            id={`${ids}-answer`}
            name="faq-answer"
            rows={4}
            aria-invalid={Boolean(errors.answer)}
            value={draft.answer}
            onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
            placeholder="เปิดทุกวัน 07:00-19:00 น. ครับ / Open every day 07:00-19:00…"
          />
        </Field>

        <section aria-labelledby={`${ids}-preview`} className="space-y-2">
          <h3 id={`${ids}-preview`} className="text-sm font-medium">
            What the Customer Sees
          </h3>
          {/* The real bubble component, not a second rendering of one. A preview
              that can drift from the thing it previews is worse than none. */}
          <div className="rounded-lg border bg-muted/20 p-3">
            {previewText || entry?.imageUrl ? (
              <div className="space-y-2">
                {previewText && (
                  <MessageBubble
                    message={{
                      id: 'preview-text',
                      conversationId: 'preview',
                      sender: 'ai',
                      content: previewText,
                      contentType: 'text',
                      createdAt: new Date(0).toISOString(),
                      deliveryStatus: 'sent',
                    }}
                    align="start"
                    tone="ai"
                    label={null}
                    announceAs="Preview of the bot"
                  />
                )}
                {entry?.imageUrl && (
                  <MessageBubble
                    message={{
                      id: 'preview-picture',
                      conversationId: 'preview',
                      sender: 'ai',
                      content: `[image] ${draft.question}`,
                      contentType: 'image',
                      createdAt: new Date(0).toISOString(),
                      deliveryStatus: 'sent',
                      mediaUrl: entry.imageUrl,
                    }}
                    align="start"
                    tone="ai"
                    label={null}
                    announceAs="Preview of the picture"
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                The answer will appear here as the customer receives it.
              </p>
            )}
          </div>
        </section>

        <section aria-labelledby={`${ids}-picture`} className="space-y-2">
          <h3 id={`${ids}-picture`} className="text-sm font-medium">
            Picture
          </h3>
          {entry?.imageUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- storage host is per-project */}
              <img
                src={entry.imageUrl}
                alt={`Attached to ${entry.question}`}
                width={64}
                height={64}
                className="size-16 shrink-0 rounded-md border object-cover"
              />
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                The bot sends this when a picture would answer better than words. It asks for it by
                the name <code translate="no">{draft.slug || entry.slug}</code>.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={onRemoveImage}>
                <X />
                Remove Picture
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploading || !entry}
                onClick={chooseImage}
              >
                <ImagePlus />
                {isUploading ? 'Attaching…' : 'Add Picture'}
              </Button>
              <p className="text-xs text-muted-foreground">
                {entry
                  ? 'The bot gets a name for it automatically. You can change that under Advanced.'
                  : 'Save the answer first, then a picture can be attached to it.'}
              </p>
            </div>
          )}
        </section>

        {/* Mechanism, not data. The order only breaks a tie and the name is a
            handle for the agent, so neither earns a place beside the question. */}
        <details
          open={showAdvanced}
          onToggle={(event) => setShowAdvanced((event.currentTarget as HTMLDetailsElement).open)}
          className="rounded-lg border"
        >
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            Advanced
          </summary>
          <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
            <Field
              id={`${ids}-slug`}
              label="Picture Name"
              hint="The handle the bot uses to ask for the picture. Derived from the question when you attach one."
              error={errors.slug}
            >
              <Input
                ref={slugRef}
                id={`${ids}-slug`}
                name="faq-slug"
                autoComplete="off"
                spellCheck={false}
                translate="no"
                size="lg"
                aria-invalid={Boolean(errors.slug)}
                value={draft.slug}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
                placeholder="menu…"
              />
            </Field>

            <Field
              id={`${ids}-order`}
              label="Order"
              hint="Only breaks a tie between two answers that scored the same. Normally set by moving the answer in the list."
              error={errors.sortOrder}
            >
              <Input
                id={`${ids}-order`}
                name="faq-order"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                size="lg"
                className="tabular-nums"
                aria-invalid={Boolean(errors.sortOrder)}
                value={draft.sortOrder}
                onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
              />
            </Field>

            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                name="faq-active"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                className="size-4 rounded border-input accent-primary"
              />
              The bot may use this answer
            </label>
          </div>
        </details>
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <Button type="submit" size="lg" disabled={isSaving}>
          {isSaving ? 'Saving…' : entry ? 'Save Answer' : 'Add Answer'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        {entry && (
          <Button
            type="button"
            variant="destructive"
            size="lg"
            className="ml-auto"
            onClick={onDelete}
          >
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
    </form>
  )
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {/* The complaint sits against the field that caused it and is announced
          when it appears. */}
      {error ? (
        <p role="alert" className="text-xs text-failed-ink">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
