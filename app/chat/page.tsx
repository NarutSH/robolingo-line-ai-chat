import type { Metadata } from 'next'
import { VisitorChat } from '@/components/chat/visitor-chat'
import { readAssistantVoice } from '@/lib/data/assistant'
import { SHOP_NAME } from '@/lib/shop'

export const metadata: Metadata = {
  title: `Chat with ${SHOP_NAME}`,
  description: 'Ask about opening hours, the menu, parking or anything else.',
}

export default async function ChatPage() {
  // The live name, not the default: this one is at the top of the window the
  // customer is typing into, so a shop that renames itself in the console
  // should see it here without a deploy. The tab title above stays static —
  // it is not worth a round trip to change a string nobody is reading.
  const { shopName } = await readAssistantVoice()
  return <VisitorChat shopName={shopName} />
}
