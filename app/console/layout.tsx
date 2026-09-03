import Link from 'next/link'
import { ConversationList } from '@/components/console/conversation-list'
import { ConsolePanes } from '@/components/console/console-panes'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Inbox · LINE OA Console' }

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/console" className="text-sm font-semibold">
          LINE OA Console
        </Link>
        <form action="/api/auth/logout" method="post">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      <ConsolePanes list={<ConversationList />}>{children}</ConsolePanes>
    </div>
  )
}
