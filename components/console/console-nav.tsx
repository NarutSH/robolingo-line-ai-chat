'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/console', label: 'Inbox' },
  { href: '/console/training', label: 'Training' },
] as const

/**
 * Two places to be. `aria-current` rather than colour alone, so which one you
 * are on survives a screen reader and a monochrome display.
 */
export function ConsoleNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Console sections" className="flex items-center gap-1">
      {LINKS.map((link) => {
        const active =
          link.href === '/console' ? !pathname.startsWith('/console/training') : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-lg px-2.5 py-1 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
