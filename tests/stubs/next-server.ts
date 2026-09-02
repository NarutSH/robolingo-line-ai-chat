import { queueAfter } from '../support/request-context'

/**
 * The real `after()` hands work to the platform to run once the response is
 * sent, and throws outside a request scope. Here it queues instead, and the
 * test decides when that work runs by awaiting `flushAfter()`.
 *
 * This matters beyond mere compatibility: the AI reply happens inside after(),
 * so a test that never flushes is asserting on a half-finished request.
 *
 * Only `after` is stubbed. `proxy.ts` also imports from `next/server`, but it is
 * a cheap cookie-presence redirect and the authoritative check it stands in
 * front of — `requireOperator()` — is under test directly.
 */
export function after(task: (() => unknown) | Promise<unknown>): void {
  queueAfter(task)
}
