import { cookieStore } from '../support/request-context'

/**
 * The real `cookies()` reads from the async-local-storage that Next populates
 * per request. Calling a route handler directly means there is no such store,
 * so the test supplies one — see `tests/support/request-context.ts`.
 */
export async function cookies() {
  return cookieStore()
}
