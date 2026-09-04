# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
bun install
bun run dev                      # next dev
bun run build                    # next build
bun run typecheck                # tsc --noEmit
bun run lint                     # eslint
bun run test                     # vitest run — NOT `bun test`, which invokes Bun's own runner
bun run test tests/ai-reply.test.ts          # a single file
bun run test -t 'falls back to a push'       # a single test by name
bun run test:watch
```

Tests need a filled-in `.env.local` (`cp .env.example .env.local`) and hit the
**real Supabase project** — see "Tests" below before running them.

Schema changes go through the Supabase CLI only, never the SQL editor:

```bash
bunx supabase migration new <name>   # then edit supabase/migrations/<ts>_<name>.sql
bunx supabase db push
bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

An applied migration is never edited in place — fix forward with a new one.

## Architecture

Read `README.md` first; it explains *why* each of these is shaped the way it is.
What follows is the map.

**Two channels, one inbox.** Customers arrive from a LINE Official Account
(`/api/line/webhook`) or from an anonymous web widget (`/chat` →
`/api/chat/messages`). Both land in the same `conversations`/`messages` tables
and the same operator console (`/console`). `conversations.channel` is
`'line' | 'web'`, and that column is the only thing that varies delivery.

**Inbound (LINE) is split around the 200.** The route verifies
`X-Line-Signature` over the raw body text (never re-read as JSON), calls the
single plpgsql `ingest_line_message()` — claim event id, upsert contact, find or
create conversation, insert message, all in one transaction — and returns 200.
Profile refresh and the AI run happen in two separate `after()` calls, so a
failed profile lookup cannot cost the customer their answer.

**Outbound is one funnel:** `lib/messaging/dispatch.ts`. Row is written *before*
the send, so a rejected message stays visible marked failed. Reply-token vs push
is decided here and nowhere else (50s margin, message id as `X-Line-Retry-Key`,
dead token falls back to push). Web conversations are marked sent on write.

**Mode decides who answers.** `conversations.mode` is `'ai' | 'manual'`. An AI
run (`lib/ai/respond.ts`) takes a claim with a conditional update (2-minute
expiry; an errored run is immediately reclaimable) and re-reads the mode again
right before sending, discarding the reply if an operator took over meanwhile.
`/suggest` runs the same agent but writes and sends nothing, and withholds the
handoff tool.

**Three inbox states, not two.** `mode` alone cannot tell an escalation from a
conversation an operator took over — both are `manual`. `handoff_reason` is the
discriminator, and `conversationState()` in `lib/types.ts` derives it. That
helper lives with the shared types rather than in `lib/data/conversations.ts`
because the console calls it in the browser and the data module is server-only.
`listConversations` sorts escalated first, in JS, since the ordering is over a
derived state.

**A burst of messages becomes one answer.** Every AI run sleeps `AI_DEBOUNCE_MS`
(4s default, 0 in tests) and then stands down if a newer inbound message exists,
so only the newest run answers and it sees the whole burst in history. The pause
is deliberately *before* `claimAiRun` — claiming first is what made every
message after the first one silent.

**The agent may only speak from the FAQ table** (`lib/ai/tools.ts` →
`lib/data/faq.ts`). Matching runs *backwards* — an entry's tags are tested as
substrings of the customer's question — because Thai has no word boundaries.
Scoring sums matched tag *length*, not count. `pg_trgm`/`unaccent` are
deliberately avoided (wrong `search_path` on Supabase Cloud breaks migrations).

**The FAQ is editable from `/console/training`.** Writes live in
`lib/data/faq-admin.ts`, kept out of `lib/data/faq.ts` so the agent's read path
stays small. An entry needs a `slug` before a picture can be attached — the slug
is the only handle `show_image` gets. The console routes are `app/api/faq/**`.

**Pictures take the same funnel.** `dispatchOutbound` gains an `imageUrl` and
`sendToLine` builds an image message instead of a text one; there is no second
path. The URL lives in `messages.media_url`, never in `content` — `content` is
what the model and the conversation-list preview read. Files sit in the public
`chat-media` bucket because LINE fetches them with none of our credentials.
`show_image` can only name an FAQ entry `search_faq` just returned.

**Every row goes through the secret key.** RLS is on with zero policies; the
browser holds only the publishable key and uses it for Realtime broadcast
alone. `createAdminClient()` is created per call, never memoized.

**Two independent cookies, one secret** (`lib/auth/`): an operator session
(shared password, HMAC) and a web-visitor session id, signed over different
input spaces so neither replays as the other. `proxy.ts` only redirects on a
missing cookie — `requireOperator()` inside each route is the authoritative
check. Visitor routes accept no conversation id from the client at all.

`lib/env.ts` validates the environment once at import and throws at boot with
the offending variable named; AI/LINE vars are optional so the app degrades
instead of failing. `/api/health` reports what is configured.

### Layout

- `app/api/**` — route handlers; these are the tested seam.
- `lib/line/`, `lib/ai/`, `lib/data/`, `lib/messaging/`, `lib/auth/`, `lib/supabase/`
- `lib/faq/`, `lib/media/` — rules and helpers the browser needs too, so no `server-only`
- `components/console/`, `components/console/training/`, `components/chat/`, `hooks/use-live-updates.ts` (Realtime + polling fallback)
- `supabase/migrations/` — the only source of schema truth.

## Tests

Route handlers are imported and called with a constructed `Request` — the
behaviour, not the units. `tests/stubs/` aliases `server-only`, `next/headers`
and `next/server` (see `vitest.config.mts`).

`tests/helpers/fetch-fake.ts` intercepts *all* `fetch`: LINE and OpenRouter are
faked, any other host is refused outright so a test can never make a paid model
call. **Supabase is left real** — the atomic claim and the FAQ ranking are
plpgsql, and faking them would test a reimplementation.

Because one cloud project is shared, `fileParallelism` is off and isolation is
by convention: test contacts use a reserved prefix, visitor conversations are
swept by issued session ids, and the sweep runs before the suite as well as
after. A crashed run must not leave rows in the inbox a reviewer opens.

## Agent skills

### Issue tracker

Local markdown under `.scratch/` — one directory per feature. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, unchanged (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`, which covers what to do when they are absent (they are, today).
