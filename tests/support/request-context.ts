/**
 * The ambient per-request state that Next normally provides and that a directly
 * driven route handler does not get: a cookie jar and the after() queue.
 *
 * Reset between tests by `tests/setup.ts`.
 */

type AfterTask = (() => unknown) | Promise<unknown>

let jar = new Map<string, string>()
let pending: AfterTask[] = []

/**
 * Every anonymous visitor session the app has minted during this test file.
 *
 * A web conversation carries no reserved prefix the way a test LINE contact
 * does — the session id is a plain uuid the route generates — so the only way
 * to find them again for cleanup is to notice them being handed out. Kept
 * across resetRequestContext(), since a test that simulates a second browser
 * clears the jar and would otherwise lose the first session.
 */
let visitorSessions: string[] = []

export function resetRequestContext(): void {
  jar = new Map()
  pending = []
}

export function issuedVisitorSessions(): string[] {
  return [...visitorSessions]
}

export function forgetVisitorSessions(): void {
  visitorSessions = []
}

/** Put a cookie on the inbound request, as a browser would. */
export function withCookie(name: string, value: string): void {
  jar.set(name, value)
}

/** Read a cookie the handler set on the way out. */
export function readCookie(name: string): string | undefined {
  return jar.get(name)
}

export function cookieStore() {
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => {
      jar.set(name, value)
      if (name === 'web_visitor' && value) {
        const sessionId = value.split('.')[0]
        if (sessionId) visitorSessions.push(sessionId)
      }
    },
    delete: (name: string) => {
      jar.delete(name)
    },
  }
}

export function queueAfter(task: AfterTask): void {
  pending.push(task)
}

/**
 * Runs everything after() queued, including anything those tasks queue in turn.
 * Errors propagate rather than being swallowed: in production an after() failure
 * is a logged background error, but in a test it is the thing you want to see.
 */
export async function flushAfter(): Promise<void> {
  while (pending.length > 0) {
    const batch = pending
    pending = []
    for (const task of batch) {
      await (typeof task === 'function' ? task() : task)
    }
  }
}

export function pendingAfterCount(): number {
  return pending.length
}
