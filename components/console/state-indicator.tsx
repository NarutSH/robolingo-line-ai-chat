import type { ConversationState } from '@/lib/types'
import { cn } from '@/lib/utils'

const COPY: Record<ConversationState, { short: string; full: string }> = {
  escalated: { short: 'Needs you', full: 'The AI handed this to you' },
  manual: { short: 'You', full: 'You are answering' },
  ai: { short: 'AI', full: 'The AI is answering' },
}

/**
 * Who owes this conversation a reply.
 *
 * Escalated is deliberately louder than the other two: it is the only state
 * where somebody is waiting and nobody has picked them up. It reads as a filled
 * badge rather than as red, because red already means a message failed to send
 * and an escalation is not a failure — it is the agent doing the right thing.
 *
 * Every state carries words as well as a colour. The dot alone would be
 * unreadable to an operator with a colour-vision deficiency, and this is the
 * fact the whole inbox is scanned for.
 */
export function StateIndicator({
  state,
  detail = 'short',
  className,
}: {
  state: ConversationState
  detail?: 'short' | 'full'
  className?: string
}) {
  const text = COPY[state][detail]

  if (state === 'escalated') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-waiting/20 px-2 py-0.5 font-medium text-waiting-ink',
          className
        )}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-waiting" />
        {text}
      </span>
    )
  }

  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <span
        aria-hidden
        className={cn('size-2 shrink-0 rounded-full', state === 'ai' ? 'bg-ai' : 'bg-waiting')}
      />
      <span className={cn(detail === 'full' ? 'font-medium' : 'text-muted-foreground')}>{text}</span>
    </span>
  )
}
