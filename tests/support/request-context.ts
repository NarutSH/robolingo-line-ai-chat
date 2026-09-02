/**
 * The ambient per-request state that Next normally provides and that a directly
 * driven route handler does not get: a cookie jar and the after() queue.
 *
 * Reset between tests by `tests/setup.ts`.
 */

type AfterTask = (() => unknown) | Promise<unknown>

let jar = new Map<string, string>()
let pending: AfterTask[] = []

export function resetRequestContext(): void {
  jar = new Map()
  pending = []
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
