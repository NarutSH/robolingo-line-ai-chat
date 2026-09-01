import Link from 'next/link'
import { ConversationList } from '@/components/console/conversation-list'

export const metadata = { title: 'Inbox · LINE OA Console' }

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/console" className="text-sm font-semibold">
          LINE OA Console
        </Link>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Sign out
          </button>
        </form>
      </header>

      <div className="grid min-h-0 md:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-r">
          <ConversationList />
        </aside>
        <main className="min-h-0">{children}</main>
      </div>
    </div>
  )
}
