import Link from 'next/link'
import { ConsoleNav } from '@/components/console/console-nav'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Inbox · LINE OA Console' }

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
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
