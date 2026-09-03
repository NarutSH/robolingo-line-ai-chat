'use client'

import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Two panes on a desktop, one screen at a time on a phone.
 *
 * Below the breakpoint the list is the index and a conversation is its own
 * screen; stacking both inside a viewport-height grid gave each of them a third
 * of a phone and no way back. Routing is untouched — a conversation already has
 * its own URL — so which pane is showing is decided from the route rather than
 * from state that could disagree with the address bar.
 */
export function ConsolePanes({ list, children }: { list: ReactNode; children: ReactNode }) {
  const params = useParams<{ conversationId?: string }>()
  const hasConversation = Boolean(params?.conversationId)

  return (
    <div className="grid min-h-0 md:grid-cols-[320px_minmax(0,1fr)]">
      <aside
        className={cn(
          'min-h-0 overflow-y-auto border-r',
          hasConversation ? 'hidden md:block' : 'block'
        )}
      >
        {list}
      </aside>
      <main className={cn('min-h-0', hasConversation ? 'block' : 'hidden md:block')}>
        {children}
      </main>
    </div>
  )
}
