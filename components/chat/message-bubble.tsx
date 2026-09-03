import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'

/**
 * One message, rendered the same way wherever it appears.
 *
 * The console and the visitor widget disagree about more than styling, and
 * those disagreements stay with the callers: the console shows system notes and
 * the widget filters them out, and the same sender is named differently on each
 * side — a customer sees the shop's name where an operator sees "AI". So the
 * label is passed in rather than derived here, and this component decides only
 * what every bubble should agree on: alignment, shape, spacing, and how a
 * message that has not landed yet is set apart from one that has.
 */
/**
 * Named from the reader's side of the conversation, not from the sender's job
 * title: the same bubble is `self` for the operator who typed it and for the
 * visitor who typed theirs, and neither view has to know about the other.
 */
export type BubbleTone = 'other' | 'self' | 'ai' | 'note'

const toneClass: Record<BubbleTone, string> = {
  other: 'bg-muted text-foreground',
  self: 'bg-primary text-primary-foreground',
  ai: 'bg-ai text-ai-foreground',
  note: 'bg-waiting/15 text-waiting-ink',
}

export interface MessageBubbleProps {
  message: ChatMessage
  /** Which side of the thread this sits on. */
  align: 'start' | 'end'
  tone: BubbleTone
  /**
   * Shown above the bubble. Pass null where a visible label would be noise —
   * a visitor does not need "You" on every message they wrote — and the
   * announcement below still names the sender for anyone who cannot see the
   * alignment that carries it visually.
   */
  label: string | null
  /** How this sender is announced to assistive technology. */
  announceAs: string
  /** Delivery detail: a reason it failed, a note that it is still sending. */
  status?: ReactNode
  /** A recovery affordance, shown under the bubble. */
  action?: ReactNode
}

export function MessageBubble({
  message,
  align,
  tone,
  label,
  announceAs,
  status,
  action,
}: MessageBubbleProps) {
  const isEnd = align === 'end'
  const failed = message.deliveryStatus === 'failed'
  const queued = message.deliveryStatus === 'queued'

  return (
    <div className={cn('flex', isEnd ? 'justify-end' : 'justify-start')}>
      <div className={cn('flex max-w-[80%] flex-col gap-1', isEnd ? 'items-end' : 'items-start')}>
        {/* Always announced, only sometimes drawn. */}
        <span className="sr-only">{announceAs} said:</span>

        {label && (
          <span className="px-1 text-[11px] font-medium text-muted-foreground">{label}</span>
        )}

        <div
          className={cn(
            // leading-relaxed rather than the default: Thai stacks tone marks
            // above and vowels below, and a tight line clips them.
            'w-fit rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap',
            toneClass[tone],
            queued && 'opacity-70',
            failed && 'ring-1 ring-failed'
          )}
        >
          {message.content}
        </div>

        {status && (
          <span
            className={cn('px-1 text-[11px]', failed ? 'text-failed-ink' : 'text-muted-foreground')}
          >
            {status}
          </span>
        )}

        {action}
      </div>
    </div>
  )
}
