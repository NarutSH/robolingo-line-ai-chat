import type { Metadata } from 'next'
import { AssistantBoard } from '@/components/console/assistant-board'

export const metadata: Metadata = { title: 'Assistant · LINE OA Console' }

export default function AssistantPage() {
  return (
    <main className="h-full min-h-0 overflow-y-auto">
      <AssistantBoard />
    </main>
  )
}
