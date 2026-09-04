# Webchat for a LINE Official Account

One inbox for a coffee shop. Customers write from the shop's LINE Official
Account or from a chat widget on its website. An AI answers first, and a member
of staff can take over at any point.

| | |
|---|---|
| Console | https://robolingo-line-ai-chat.vercel.app/console |
| Chat widget | https://robolingo-line-ai-chat.vercel.app/chat |
| LINE OA | _(add link before sending)_ |

> The console password was sent with this link, not committed here.

## Stack

| | |
|---|---|
| **Next.js 16** (App Router, TypeScript) on Vercel | Route handlers do all the work. Fluid compute lets a route answer, then keep working. |
| **Supabase Cloud** | Postgres for every row, Realtime for the live inbox, Storage for pictures. Some logic is plpgsql because it must be atomic. |
| **LangChain v1 → OpenRouter** | A ReAct agent with three tools. The model is one environment variable. |
| **Bun** and **Vitest** | 133 tests, run against the real database. |

## Run it

```bash
bun install
cp .env.example .env.local     # fill in the values
bunx supabase link && bunx supabase db push
bun run dev
```

Point the LINE channel webhook at `/api/line/webhook`.

```bash
bun run test        # not `bun test`, which runs Bun's own runner
bun run typecheck
bun run lint
```

## How it works

```
LINE ──▶ /api/line/webhook ─┐
                            ├─▶ conversations ──▶ /console ──▶ operator
web  ──▶ /api/chat/messages ┘        │
                                     └──▶ agent ──▶ search_faq ──▶ reply
```

**In.** The webhook verifies the signature, calls one plpgsql function, and
returns 200. The profile refresh and the AI run happen after the response, in
two separate `after()` calls.

**Out.** Every outbound message goes through `lib/messaging/dispatch.ts` — the
agent's, the operator's, the system's. It writes the row, sends it, and marks it
sent or failed.

**Who answers.** `conversations.mode` is `ai` or `manual`. An AI run takes a
claim, and re-reads the mode again just before sending.

**What it knows.** Only the `faq_entries` table, through the `search_faq` tool.
If nothing matches, the bot says so and hands the customer to a person.

## Design decisions

These are the choices worth defending. Each one came from something breaking.

**The signature is checked against raw bytes.** The body is read once as text
and the HMAC runs over that string. Parsing it as JSON first would change what
is being verified. A bad signature returns 401, so it appears in LINE's error
stats instead of vanishing into a quiet 200.

**Ingest is one plpgsql transaction.** Claim the event id, upsert the contact,
find or create the conversation, insert the message. Claiming the id in the same
transaction as the write is what makes LINE's redelivery safe: a repeat finds
the id taken and does nothing twice.

**Nothing slow runs before the 200.** LINE retries anything slower than about a
second. The profile lookup and the AI run are separate `after()` calls, so a
failed profile lookup cannot cost the customer their answer.

**One outbound funnel, row written before the send.** A message LINE rejects
stays on screen, marked failed, with the reason, and can be sent again. Reply
token versus push is decided in one place: a 50-second margin, the message id as
`X-Line-Retry-Key`, and a dead token falls back to push.

**Three inbox states, not two.** A conversation the AI handed over and one an
operator picked up are both `manual`, but only the first has someone waiting and
nobody helping. `handoff_reason` tells them apart. Escalations sort first.

**A burst of messages becomes one answer.** Each run waits 4 seconds, then
stands down if a newer message arrived. The wait sits *before* the claim —
claiming first made every message after the first one silent.

**FAQ matching runs backwards.** Thai has no spaces, so a question arrives as
one token that nothing in core Postgres can split. Instead each answer carries
short tags, and a tag scores if it appears *inside* the customer's message. One
rule, both languages, no word splitter.

**Score sums tag length, not tag count.** Counting treats every tag as equal
proof. `ไป` ("go") sits inside almost any Thai sentence and once beat a real
match on a question about dogs. Length is a fair proxy for how specific a word
is.

**The bot can only repeat what the lookup returned.** No invented opening time,
no invented price. `show_image` can only name an entry `search_faq` just gave
it. A made-up price is one the shop can be held to.

**Pictures use the same funnel**, with the URL in `messages.media_url` and never
in `content` — `content` is what the model reads and what the inbox preview
shows. The bucket is public because LINE fetches the image with none of our
credentials.

## The console

**Inbox** (`/console`) — every conversation from both channels, live over
Realtime with a polling fallback. Take over, hand back, or ask the AI for a
draft that is written into the box and sent by nobody but you.

**Training** (`/console/training`) — the FAQ, editable without a deploy.
Trigger words are chips showing the points each adds, because they are the only
thing that decides which answer wins. Two warnings appear as you type: a word
too short to mean anything, and a word another live answer already claims. ⌘K
runs the real ranking function and shows what would come back, with scores.

**Assistant** (`/console/assistant`) — the system prompt and the voice, stored
in the database and read on every run. The Thai sentence particle is a radio
group, not a text box: Thai forces the choice on every sentence and nothing used
to make it, so one reply could mix ครับ and ค่ะ. The prompt is fully editable;
when an edit drops a safety rule, the screen names it and says what it was
holding, but does not block the save.

## Security

**RLS is on for every table, with zero policies.** Nothing reaches a row except
the server holding the secret key. The browser holds only the publishable key
and uses it for Realtime alone, so there is no policy surface to get wrong.
`tests/row-level-security.test.ts` proves it with the browser's own key, and
would catch a future table that forgot the line.

**Two cookies, one secret.** An operator session (shared password, HMAC) and a
visitor session id, signed over different input spaces so neither replays as the
other. `proxy.ts` redirects on a missing cookie, but `requireOperator()` inside
each route is the real check. Visitor routes accept no conversation id from the
client at all, so reaching someone else's conversation is impossible rather than
forbidden.

**Schema changes are migration files** made with the Supabase CLI, never typed
into the SQL editor. An applied migration is never edited; when the FAQ ranking
turned out to be wrong, it was fixed forward in a new file.

## Tests

Route handlers are the seam. A test imports `POST` or `GET` and calls it with a
real `Request`, covering routing, auth, validation, writes and dispatch together.

One `fetch` interceptor controls every external boundary. LINE and OpenRouter
are faked. **Supabase is left real**, because the atomic claim and the FAQ
ranking are plpgsql and a fake would test a reimplementation. Any other host is
refused, so a test can never spend money on a live model call.

The suite shares one cloud project with the demo data, so isolation is by
convention: test contacts use a reserved prefix, visitor conversations are swept
by issued session ids, and the sweep runs before the suite as well as after — a
crashed run must not leave rows in the inbox a reviewer opens.

## Layout

```
app/api/**            route handlers, the tested seam
app/console/**        inbox, training, assistant
lib/line/             signature, client, event mapping
lib/ai/               agent, tools, prompt, debounce
lib/data/             every query
lib/messaging/        the one outbound funnel
lib/auth/             the two cookies
supabase/migrations/  the only source of schema truth
```

`lib/env.ts` validates the environment once at import, so a bad deploy fails at
boot naming the variable. `/api/health` reports what is configured and whether
the database answers. Without an OpenRouter key the app runs as it did before
the agent existed: messages arrive, staff reply, nothing throws.
