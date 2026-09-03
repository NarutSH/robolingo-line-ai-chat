# Webchat for a LINE Official Account

A coffee shop's customer conversations, in one inbox. Messages arrive from the
shop's LINE Official Account and from an anonymous chat widget on its website;
an AI agent answers first, and a member of staff can take any conversation over
at any point.

| | |
|---|---|
| **Webchat console** | https://robolingo-line-ai-chat.vercel.app/console |
| **Web chat widget** | https://robolingo-line-ai-chat.vercel.app/chat |
| **LINE Official Account** | _(add the OA's link here before submitting)_ |
| **Repository** | https://github.com/NarutSH/robolingo-line-ai-chat |

> **The console password is sent separately, not in this repository.** If you
> open `/console` and it asks for a password, that is the login working — the
> password is in the message this link came with.

Built with Next.js 16 (App Router), TypeScript, Supabase Postgres, the LINE
Messaging API, and LangChain v1 over OpenRouter. Deployed on Vercel.

---

## How a message gets in

```
LINE  ──POST──▶  /api/line/webhook
                      │
                      ├─ verify X-Line-Signature over the raw body
                      ├─ ingest_line_message()  ← one atomic call
                      └─ 200 OK  ──────────────────────┐
                                                       │
                      after() ─── refresh profile      │  response already sent
                              └── AI answers ──────────┘
```

Three decisions shape this route, and they are all about the 200.

**The signature is checked against the exact bytes that arrived.** The body is
read once, as text, and the HMAC is computed over that string — reading it again
as JSON first would change what is being verified. A bad signature returns 401
rather than a quiet 200, so it shows up in LINE's own error statistics instead
of vanishing.

**Everything the request phase does is atomic and fast.** A single plpgsql
function claims the webhook event, upserts the contact, finds or creates their
conversation, and records the message. Claiming the event id in the same
transaction as the write is what makes LINE's redelivery safe: a repeat arrives,
finds the event already claimed, and returns 200 without doing anything twice.

**Nothing slow happens before the 200.** LINE expects a response within about a
second and retries anything slower — so the profile lookup and the AI run both
go in `after()`, which Vercel's Fluid compute runs after the response is on the
wire. They are two separate `after()` calls, not one: a profile lookup that
fails must not cost the customer their answer.

## How a message gets out

Every outbound message — from the agent, from an operator, from the system —
goes through one path that records the row, sends it, marks it sent or failed,
and updates the conversation preview. **The order is load-bearing:** the row is
written *before* the send, so a message LINE rejects stays visible in the thread
marked as failed, instead of disappearing into the logs while the operator
believes it went out.

The reply-versus-push rule lives in exactly one place, because getting it wrong
is expensive in two different ways:

- A **reply token** is valid for one minute, single use, and costs no quota. The
  AI answers seconds after the webhook, so its reply almost always uses one.
- A **push** has no expiry but is metered. An operator answering minutes later
  has no live token, so their message pushes — with the message row's id as
  `X-Line-Retry-Key`, so a retried request cannot send twice.

The margin is 50 seconds rather than 60, so a slow model call cannot land just
past the boundary holding a token LINE has already expired. If a token turns out
to be dead anyway, the send falls back to a push rather than losing the message.

A **web** conversation has nothing to call out to. The message row *is* the
delivery, and the visitor's page reads it — so it is marked sent as soon as it
is written, and the same code path serves both channels.

## Who is answering

Every conversation is in one of two modes.

**`ai`** — the agent answers and staff supervise. This is where new
conversations start.

**`manual`** — only a person replies. A conversation gets here two ways: an
operator presses **Take over**, or the agent hands off by itself.

The agent hands off when `search_faq` returns nothing that answers the question,
when the customer asks for a person, when they are complaining, or when they
want something only a person can do. It records why, writes a note into the
thread so whoever picks it up sees the reason in place, and — importantly — it
still sends one short acknowledgement. A customer who is handed over and then
hears nothing has no way to tell they were heard, which is worse than the wrong
answer the handoff exists to avoid.

Two things stop a customer being answered twice:

- **A claim.** A run takes the conversation with a conditional update. A second
  webhook arriving at the same instant blocks on the row lock, re-reads it, sees
  the claim and exits. The claim expires after two minutes, and an errored run
  is claimable immediately — a run killed by a deploy would otherwise leave a
  conversation permanently mute, which is a far worse failure than the double
  reply the claim prevents.
- **A late re-read.** The mode is checked again immediately before sending. An
  operator who took over while the model was still thinking has already decided
  they are handling it, and a reply landing on top of them is worse than no
  reply at all — so that reply is discarded rather than sent.

**Suggest a reply** runs the same agent and puts the result in the operator's
composer. It writes nothing and sends nothing. Pressing send stays a person's
decision, which is the whole reason the button exists instead of the AI simply
answering. The handoff tool is withheld on that path — the operator is already
the human it would hand to.

## What the agent knows

Everything the agent can say about the shop comes from one table, looked up
through one tool. It is instructed never to state an opening time, price,
promotion or policy that did not come back from that lookup: an invented price
is worse than an admission of not knowing, because the shop can be held to it.

**The FAQ match runs backwards, and that is the interesting part.** Thai is
written without spaces, so a Thai question arrives as a single unsegmented
token — `เปิดกี่โมง` cannot be split into words by anything in core Postgres,
and full-text search would index it as one meaningless lexeme. Splitting the
*query* is hopeless. So each entry carries short tags instead, and a tag scores
if it appears **inside** the customer's question: `เปิด` is a substring of
`เปิดกี่โมง`, and `hours` is a substring of `what are your hours`. One rule,
both languages, no segmenter and no extension.

Matches are scored by the summed length of the matching tags rather than by how
many matched, because tags are not equal evidence. A first version counted them,
and `พาหมาไปได้ไหม` — "may I bring my dog" — matched the *location* entry through
its tag `ไป`, "go", which is a substring of almost any Thai sentence.

`pg_trgm` and `unaccent` are deliberately unused: on Supabase Cloud they live in
the `extensions` schema, which is not on a migration session's `search_path`, so
depending on them makes migrations fail in a way that is confusing to diagnose.
At a couple of dozen entries this is not a compromise — it is the right amount
of machinery. Embeddings become worth their weight when the corpus is too large
for a person to skim.

## Data

Five tables plus the FAQ. `conversations` is the spine: it carries the channel
(`line` or `web`), the mode, the AI run state, and the handoff reason.
`messages` records direction, sender (`line_user`, `web_visitor`, `operator`,
`ai`, `system`), delivery status and the LINE ids on both sides.
`line_webhook_events` exists solely so redelivery has something to collide with.

**RLS is enabled on every table with zero policies.** Nothing reaches a row
except the server holding the secret key. The browser never queries the database
directly, so there is no policy surface to get wrong — the API routes are the
only way in, and they check authorisation themselves.

**Every schema change is a migration file created with the Supabase CLI**
(`bunx supabase migration new …`, applied with `db push`). Nothing is typed into
the SQL editor, so the database's state is reproducible from the repository and
reviewable in a diff. When a migration that had already been applied turned out
to have a ranking bug, it was fixed forward in a new migration rather than
edited in place.

## Who can see what

**Operators** sign in with a shared password against an HMAC-signed cookie.
There is deliberately no user system: the brief asks for a working webchat, not
identity management. It exists because the deployed URL is handed to a stranger
and the console shows real people's names and photographs. `proxy.ts` redirects
on a missing cookie, but that is only a cheap guess — every protected route
calls `requireOperator()` itself, which is the authoritative check.

**Web visitors** are only ever "the same browser as last time": a signed cookie
holding a session id, signed with the same secret over a different input space
so neither cookie can be replayed as the other. The visitor routes accept no
conversation id from the client at all. That is what makes reaching another
visitor's conversation impossible rather than merely forbidden — there is no way
to ask for one.

## Tests

```bash
bun run test      # the suite (not `bun test`, which runs Bun's own runner)
bun run typecheck # tsc --noEmit
```

**One seam: the route handlers, driven directly.** A test imports `POST` or
`GET` from a route module and calls it with a constructed `Request`, which
exercises routing, signature verification, auth, validation, persistence and
outbound dispatch together — the behaviour, rather than the units it is made of.

Everything external reaches the network through `fetch`: the LINE SDK (no
runtime dependencies as of v11), `supabase-js`, and the OpenRouter client all
do. So a single interceptor controls every boundary at once. LINE and OpenRouter
are faked; **Supabase is left real**, because the atomic claim that makes
redelivery safe is plpgsql and a faked database would be testing a
reimplementation of it. Any other host is refused outright rather than quietly
allowed through, so a test can never spend money on a live model call.

Tests share the one cloud project with the demo data, so isolation is by
convention: every test contact is minted under a reserved prefix and removed by
cascade, anonymous conversations are cleaned up by the session ids the routes
handed out, and the sweep runs before the suite as well as after — a crashed run
must not leave rows in the inbox a reviewer opens.

A few assertions sit below that seam on purpose, and say so where they are: the
FAQ ranking and the concurrency claim are both guarantees that live in the
database, and two webhooks arriving at the same instant cannot be staged through
sequential handler calls.

## Running it

```bash
bun install
cp .env.example .env.local     # then fill it in
bun run dev
```

`bunx supabase link` and `bunx supabase db push` apply the schema to a Supabase
project. Point the LINE channel's webhook at `/api/line/webhook`.

Environment is validated once at import, so a misconfigured deploy fails at boot
with the offending variable named, rather than at the first webhook. A localhost
Supabase URL on a deployed instance is rejected outright — it is valid-looking,
boots cleanly, and then makes every query die as `fetch failed` after seven
seconds with no hint as to why.

`/api/health` reports which capabilities are configured and whether the database
is reachable, so a broken deploy can be diagnosed without reading logs. Without
an OpenRouter key the app runs exactly as it did before the agent existed:
messages arrive, staff reply, and nothing throws.
