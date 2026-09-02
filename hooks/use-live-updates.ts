'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Listens for the database announcing a new message, and reports whether that
 * listener is actually connected.
 *
 * The caller uses that answer to decide how hard to poll: connected means a
 * slow safety-net heartbeat is enough, not connected means carry on polling as
 * before. Nothing here is load-bearing — losing the socket costs a few seconds
 * of latency and nothing else.
 *
 * The channel is public with an unguessable topic. Supabase's private channels
 * authorise through RLS against a Supabase Auth JWT, and this app has none:
 * operators sign in against our own signed cookie. So the topic *is* the
 * capability, handed out only behind the operator check.
 */
export function useLiveUpdates(topic: string | null, onMessage: () => void): boolean {
  const [isLive, setIsLive] = useState(false)

  // Held in a ref so a caller passing an inline function does not tear the
  // subscription down and rebuild it on every render.
  const handler = useRef(onMessage)
  useEffect(() => {
    handler.current = onMessage
  }, [onMessage])

  useEffect(() => {
    if (!topic) return

    const supabase = createClient()
    const channel = supabase
      .channel(topic, { config: { private: false } })
      .on('broadcast', { event: 'message' }, () => handler.current())
      .subscribe((status) => {
        setIsLive(status === 'SUBSCRIBED')
      })

    return () => {
      setIsLive(false)
      supabase.removeChannel(channel)
    }
  }, [topic])

  return isLive
}
