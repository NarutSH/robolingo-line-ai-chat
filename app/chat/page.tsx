import type { Metadata } from 'next'
import { VisitorChat } from '@/components/chat/visitor-chat'
import { SHOP_NAME } from '@/lib/ai/agent'

export const metadata: Metadata = {
  title: `Chat with ${SHOP_NAME}`,
  description: 'Ask about opening hours, the menu, parking or anything else.',
}

export default function ChatPage() {
  return <VisitorChat shopName={SHOP_NAME} />
}
