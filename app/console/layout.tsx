import Link from 'next/link'
import { ConsoleNav } from '@/components/console/console-nav'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Inbox · LINE OA Console' }

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Pinned to the viewport rather than merely sized to it. A shell that was
  // h-dvh with overflow-hidden still left the *document* scrollable once the
  // thread grew tall: over a thousand pixels of blank page below a console that
  // visibly ended at the fold. overflow hidden or clip on html, body and the
  // shell all failed to stop it; taking the shell out of flow did. Measured, not
  // reasoned — the document drops from 2166px to exactly the viewport and
  // window.scrollTo has nowhere left to go.
  return (
    <div className="fixed inset-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/console" className="shrink-0 text-sm font-semibold">
            LINE OA Console
          </Link>
          <ConsoleNav />
        </div>
        <form action="/api/auth/logout" method="post">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      {children}
    </div>
  )
}
