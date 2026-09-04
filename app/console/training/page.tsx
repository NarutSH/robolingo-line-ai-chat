import type { Metadata } from 'next'
import { TrainingBoard } from '@/components/console/training-board'

export const metadata: Metadata = { title: 'Training · LINE OA Console' }

export default function TrainingPage() {
  return (
    <main className="h-full min-h-0 overflow-y-auto">
      <TrainingBoard />
    </main>
  )
}
