import { Suspense } from 'react'
import type { Metadata } from 'next'
import { TrainingBoard } from '@/components/console/training-board'

export const metadata: Metadata = { title: 'Training · LINE OA Console' }

export default function TrainingPage() {
  return (
    // The board reads which answer is open out of the URL, which makes it a
    // client component that suspends. Without a boundary here the whole console
    // shell would be pulled into the fallback.
    <main className="h-full min-h-0">
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading answers…</p>}>
        <TrainingBoard />
      </Suspense>
    </main>
  )
}
