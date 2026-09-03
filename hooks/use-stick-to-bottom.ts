'use client'

import { useEffect, useRef, type RefObject } from 'react'

/** Anything within this of the bottom counts as "following the conversation". */
const BOTTOM_SLACK_PX = 64

/**
 * Keeps a thread pinned to the newest message — but only for someone who was
 * already at the bottom.
 *
 * Scrolling up is a deliberate act: the reader is looking for something they
 * said earlier. Yanking them back every time a message lands makes the history
 * unreadable exactly when they need it, so the scroll is skipped while they are
 * away from the bottom and resumes the moment they return.
 */
export function useStickToBottom(ref: RefObject<HTMLDivElement | null>, trigger: unknown) {
  const following = useRef(true)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const onScroll = () => {
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      following.current = distance <= BOTTOM_SLACK_PX
    }

    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [ref])

  useEffect(() => {
    const element = ref.current
    if (!element || !following.current) return

    // A preference for less motion covers this too: the destination is the
    // point, the travel is not.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollTo({ top: element.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
  }, [ref, trigger])
}
