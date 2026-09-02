/**
 * The one seam.
 *
 * `@line/bot-sdk` (zero runtime deps as of v11), `@supabase/supabase-js` and the
 * OpenRouter client all reach the network through global `fetch`. So a single
 * interceptor controls every external boundary at once: fake the hosts we do not
 * want to hit, and let the one we do — Supabase — pass straight through.
 *
 * Supabase stays real on purpose. The atomic claim that makes LINE redelivery
 * safe is plpgsql; a faked database would be testing a reimplementation of it.
 */

export interface InterceptedRequest {
  url: URL
  method: string
  headers: Headers
  /** Parsed JSON body, or undefined when there was no body or it was not JSON. */
  body: unknown
  rawBody: string | undefined
}

/** A handler may return a Response, or a plain object to be sent as JSON 200. */
type HandlerResult = Response | Record<string, unknown> | undefined
export type Handler = (request: InterceptedRequest) => HandlerResult | Promise<HandlerResult>

const realFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)

let handlers: Array<[string, Handler]> = []
let intercepted: InterceptedRequest[] = []

async function describeRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<InterceptedRequest> {
  const asRequest = input instanceof Request ? input : undefined
  const href = asRequest ? asRequest.url : String(input)
  const method = (init?.method ?? asRequest?.method ?? 'GET').toUpperCase()
  const headers = new Headers(init?.headers ?? asRequest?.headers ?? {})

  let rawBody: string | undefined
  if (typeof init?.body === 'string') rawBody = init.body
  else if (asRequest && !asRequest.bodyUsed) rawBody = await asRequest.clone().text()

  let body: unknown
  if (rawBody) {
    try {
      body = JSON.parse(rawBody)
    } catch {
      body = undefined
    }
  }

  return { url: new URL(href), method, headers, body, rawBody }
}

/**
 * Only the database is allowed out. Anything else that is not faked is a bug in
 * the test, not a thing to quietly permit: an unfaked OpenRouter call would hit
 * the real API, spend real money and make the suite depend on a third party.
 */
function isPassThrough(host: string): boolean {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  return Boolean(supabase) && host === new URL(supabase!).host
}

async function dispatch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const href = input instanceof Request ? input.url : String(input)
  const host = new URL(href).host

  const match = handlers.find(([fragment]) => host.includes(fragment))
  if (!match) {
    if (isPassThrough(host)) return realFetch(input as RequestInfo, init)
    throw new Error(
      `This test reached out to ${host}, which is not faked. Add it to fakeFetch() ` +
        'rather than letting the suite call the real service.'
    )
  }

  const request = await describeRequest(input, init)
  intercepted.push(request)

  const result = await match[1](request)
  if (result instanceof Response) return result
  return Response.json(result ?? {}, { status: 200 })
}

/** Installed once, for the whole run. Without a route map every call passes through. */
export function installFetchFake(): void {
  globalThis.fetch = dispatch as typeof globalThis.fetch
}

/** Route by host fragment. Anything unlisted goes to the real network. */
export function fakeFetch(routes: Record<string, Handler>): void {
  handlers = Object.entries(routes)
}

/**
 * Forget what has been recorded so far, keeping the current routes. For a test
 * with two phases — before and after a handoff, say — so the second phase can
 * assert on its own calls without the first phase's counting toward them.
 */
export function clearCalls(): void {
  intercepted = []
}

export function resetFetchFake(): void {
  handlers = []
  intercepted = []
}

/** Every intercepted call, optionally narrowed to one host. */
export function calls(hostFragment?: string): InterceptedRequest[] {
  if (!hostFragment) return intercepted
  return intercepted.filter((c) => c.url.host.includes(hostFragment))
}
