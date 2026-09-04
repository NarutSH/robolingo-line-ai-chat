import { ConversationList } from '@/components/console/conversation-list'
import { ConsolePanes } from '@/components/console/console-panes'

/**
 * The two-pane inbox, in a route group so it wraps the conversation routes and
 * nothing else. Training is a sibling of this group rather than a child: it is
 * a full-width screen, and inheriting the conversation list would give it a
 * sidebar that has nothing to do with what it is for.
 */
export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return <ConsolePanes list={<ConversationList />}>{children}</ConsolePanes>
}
