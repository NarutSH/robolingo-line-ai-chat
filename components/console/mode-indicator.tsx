import { cn } from '@/lib/utils'

/**
 * Who is answering a conversation, said once.
 *
 * The dot is the glance across a list; the words are what makes it survive a
 * colour-vision deficiency, a washed-out screen, and a screen reader. Keeping
 * both halves in one component is what stops them drifting apart — the colour
 * and the wording were previously duplicated in the list and the thread header.
 */
export function ModeIndicator({
  mode,
  detail = 'short',
  className,
}: {
  mode: 'ai' | 'manual'
  /** `short` for the list, `full` for the thread header. */
  detail?: 'short' | 'full'
  className?: string
}) {
  const isAi = mode === 'ai'
  const text = isAi
    ? detail === 'full'
      ? 'The AI is answering'
      : 'AI'
    : detail === 'full'
      ? 'You are answering'
      : 'You'

  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', isAi ? 'bg-ai' : 'bg-waiting')} />
      <span className={cn(detail === 'full' ? 'font-medium' : 'text-muted-foreground')}>{text}</span>
    </span>
  )
}
