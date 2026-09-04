# Webchat for a LINE Official Account

One inbox for a coffee shop's customers. Messages come from the shop's LINE
Official Account and from a chat widget on its website. An AI answers first. A
member of staff can take over at any time.

| | |
|---|---|
| **Console** | https://robolingo-line-ai-chat.vercel.app/console |
| **Chat widget** | https://robolingo-line-ai-chat.vercel.app/chat |
| **LINE Official Account** | _(add the OA link here before submitting)_ |
| **Repository** | https://github.com/NarutSH/robolingo-line-ai-chat |

> The console password is sent separately, not in this repo. If `/console` asks
> for a password, the login is working. The password came with this link.

---

## Architecture

```
   LINE app                     Web browser
       │                             │
       │ webhook                     │ fetch
       ▼                             ▼
┌─────────────────────────────────────────────┐
│              Next.js 16 (App Router)        │
│                on Vercel                    │
│                                             │
│  /api/line/webhook    /api/chat/messages    │
│  /api/conversations   /api/faq              │
│  /api/assistant       /console  /chat       │
└───────┬─────────────────────────┬───────────┘
        │                         │
        │ secret key              │ LangChain v1
        ▼                         ▼
┌───────────────────┐   ┌─────────────────────┐
│  Supabase Cloud   │   │     OpenRouter      │
│                   │   │                     │
│  Postgres + RLS   │◀──│  agent + 3 tools    │
│  Realtime         │   │  search_faq         │
│  Storage          │   │  show_image         │
└───────────────────┘   │  handoff_to_human   │
                        └─────────────────────┘
```

**Next.js 16, App Router, TypeScript.** Route handlers do all the work. The
browser never talks to the database directly. Server code runs on Vercel Fluid
compute, which lets a route return a response and keep working after it.

**Supabase Cloud** is the only store. Postgres holds every row. Realtime pushes
new messages to the console. Storage holds pictures. Some logic lives in the
database as plpgsql, because it has to be atomic.

**OpenRouter through LangChain v1.** `createAgent` builds a ReAct agent with
three tools. OpenRouter means the model can be swapped by changing one
environment variable. The agent may only speak from the shop's own FAQ.

**Bun** installs and runs everything. **Vitest** runs the tests.

---

## How a message comes in

```
LINE  ──POST──▶  /api/line/webhook
                      │
                      ├─ check X-Line-Signature over the raw bytes
                      ├─ ingest_line_message()   ← one atomic call
                      └─ 200 OK ────────────────────────┐
                                                        │
                      after() ─── refresh profile       │  reply already sent
                              └── AI answers ───────────┘
```

Three choices shape this route. All of them are about the 200.

**The signature is checked against the exact bytes that arrived.** The body is
read once, as text. The HMAC is computed over that string. Reading it as JSON
first would change what is being checked. A bad signature returns 401, not a
quiet 200, so it shows up in LINE's own error stats.

**The request phase is atomic and fast.** One plpgsql function claims the event
id, upserts the contact, finds or creates the conversation, and writes the
message. Claiming the event id in the same transaction as the write is what
makes LINE's redelivery safe. A repeat arrives, finds the id taken, and returns
200 without doing anything twice.

**Nothing slow happens before the 200.** LINE wants a reply in about a second
and retries anything slower. So the profile lookup and the AI run both go in
`after()`. They are two separate calls, not one: a failed profile lookup must
not cost the customer their answer.

## How a message goes out

Every outbound message uses one path: `lib/messaging/dispatch.ts`. The agent,
an operator and the system all go through it.

The row is written **before** the send. A message that LINE rejects stays on
screen, marked failed, with the reason. The operator can send it again.

Reply token or push is decided here and nowhere else. A reply token is free but
dies after about a minute, so the funnel uses it inside a 50 second margin and
falls back to a push. The message id goes out as `X-Line-Retry-Key`, so a retry
after a timeout cannot send the same text twice.

Web conversations are marked sent on write. There is nothing to deliver: the
widget polls, and Realtime tells it sooner.

## Who answers

`conversations.mode` is `ai` or `manual`. That is one bit, and one bit is not
enough for the inbox.

Two very different conversations are both `manual`: one the AI handed over
because it was stuck, and one an operator simply picked up. The first has
somebody waiting and nobody helping. `handoff_reason` tells them apart, and
`conversationState()` turns the pair into three states: **AI**, **You**,
**Needs you**. The inbox sorts escalations first.

An AI run takes a claim with a conditional update. The claim expires after two
minutes, and a run that errored can be claimed again at once. Before sending,
the run reads the mode a second time. If an operator took over while the model
was thinking, the reply is thrown away.

**Suggest a reply** runs the same agent, writes nothing and sends nothing. It
also gets no handoff tool: the operator is already the human it would hand to.

## When a customer types in bursts

People send three short messages, not one long one. Answering each is three
replies to one thought.

Every run waits `AI_DEBOUNCE_MS` (4 seconds; 0 in tests), then checks for a
newer inbound message. If there is one, this run stops. Only the newest run
answers, and it sees the whole burst in its history.

The wait is **before** the claim, on purpose. Claiming first made every message
after the first one silent.

## What the bot knows

Everything comes from the `faq_entries` table, through the `search_faq` tool.
If nothing matches, the bot says it does not know and hands over. It never
guesses an opening time or a price.

Matching runs **backwards**. Thai is written without spaces, so a Thai question
arrives as one long token that nothing in core Postgres can split. Instead each
entry carries short tags, and a tag scores if it appears **inside** the
customer's message. `เปิด` is inside `เปิดกี่โมง`, and `hours` is inside `what
are your hours`. One rule, both languages, no word splitter.

Score is the **sum of the lengths** of the tags that matched, not the count. A
count treats every tag as equal proof, which it is not: `ไป` ("go") sits inside
almost any Thai sentence, and it once beat a real match on a question about
dogs. Length is a fair stand-in for how specific a word is.

`pg_trgm` and `unaccent` are avoided on purpose. They live in a schema that is
not on a migration's `search_path` on Supabase Cloud, which breaks migrations.

## Teaching the bot

`/console/training` is a two-pane board. Answers on the left, the one being
edited on the right. The URL holds what is open, so reload, back and a pasted
link all land in the same place.

**Trigger words are the main field.** They are the only thing that decides which
answer wins, so they sit above the answer text. Each word is a chip showing the
points it adds when it matches.

**Two warnings appear while you type.** A word too short to mean anything, and a
word another live answer already claims. Both come from real bugs: a migration
exists whose only job is to strip `ไป` and `ทาง` from every entry.

**Try a Question** (⌘K) runs the real `search_faq` and shows what comes back,
with scores. It calls the same function the agent calls. A copy in TypeScript
would drift, and then the shop would be tuning against the wrong thing.

Live and Off are two lists, because `is_active` is a `WHERE` clause. An answer
that is off is invisible to the bot, not a faded version of a live one.

## Who the bot is

`/console/assistant` holds the system prompt and a few voice settings. They live
in `app_config` and are read on every run, so a change needs no deploy.

The particle setting matters most. Thai forces a choice at the end of every
sentence, and nothing used to make it. The model picked afresh each turn, so one
reply could quote an FAQ answer written with ครับ inside a sentence ending ค่ะ.
It is a radio group with three options, not a text box, because there are only
three right answers.

The instructions are editable in full. When an edit drops a safety rule — the
FAQ tool, the "never state a fact the FAQ did not give" rule, or the handoff —
the screen names the rule and says what it was holding. It does not block the
save. The shop owns what its assistant says. It must not lose a rule without
noticing.

A setting that was never written falls back to the value in the code, so a shop
that never opens this screen gets the assistant it always had.

## Pictures

Pictures use the same outbound funnel. `dispatchOutbound` takes an `imageUrl`,
and `sendToLine` builds an image message instead of a text one. There is no
second path.

The URL lives in `messages.media_url`, never in `content`. `content` is what the
model reads and what the inbox preview shows. A URL in there would look like
something the customer said.

Files sit in a public `chat-media` bucket, because LINE fetches the image from
its own servers with none of our credentials. A signed URL would expire before
it was used.

`show_image` can only name an FAQ entry that `search_faq` just returned. Same
rule as everything else: the bot can only pass on what the lookup gave it.

Photos are shrunk in the browser before upload. The platform rejects a large
body before our handler runs, with a plain-text 413 nobody can act on.

## Data

Six tables. `conversations` is the spine: channel, mode, AI run state, handoff
reason. `messages` holds direction, sender, delivery status and the LINE ids on
both sides. `line_webhook_events` exists only so redelivery has something to
collide with. `faq_entries` is what the bot knows. `app_config` is who it is.
`line_users` is the contact.

**RLS is on for every table, with zero policies.** Nothing reaches a row except
the server holding the secret key. The browser holds only the publishable key
and uses it for Realtime alone. There is no policy surface to get wrong.

`tests/row-level-security.test.ts` keeps it that way. It asks with the browser's
own key and expects nothing back — from every table, from the `search_faq`
grant, and from the media bucket. Without it, a new table that forgot
`ENABLE ROW LEVEL SECURITY` would ship green.

**Every schema change is a migration file made with the Supabase CLI.** Nothing
is typed into the SQL editor, so the database can be rebuilt from the repo and
reviewed in a diff. An applied migration is never edited. When the FAQ ranking
turned out to be wrong, it was fixed forward in a new file.

## Who can see what

**Operators** sign in with a shared password against an HMAC-signed cookie.
There is no user system on purpose: the brief asks for a webchat, not identity
management. The login exists because the URL goes to a stranger and the console
shows real names and photos. `proxy.ts` redirects when the cookie is missing,
but that is only a cheap guess. Every protected route calls `requireOperator()`
itself, and that is the real check.

**Web visitors** are only ever "the same browser as last time": a signed cookie
holding a session id. It uses the same secret as the operator cookie but signs a
different input space, so neither can be replayed as the other. Visitor routes
accept no conversation id from the client at all. Reaching another visitor's
conversation is not forbidden, it is impossible — there is no way to ask.

## Tests

```bash
bun run test       # 133 tests. Not `bun test`, which runs Bun's own runner
bun run typecheck
bun run lint
```

**One seam: the route handlers, called directly.** A test imports `POST` or
`GET` from a route module and calls it with a real `Request`. That covers
routing, signature checks, auth, validation, writes and outbound dispatch at
once — behaviour, not units.

Everything external goes through `fetch`, so one interceptor controls every
boundary. LINE and OpenRouter are faked. **Supabase is left real**, because the
atomic claim and the FAQ ranking are plpgsql and a fake would test a
reimplementation. Any other host is refused, so a test can never spend money on
a real model call.

Tests share one cloud project with the demo data, so isolation is by convention.
Test contacts use a reserved prefix. Anonymous conversations are cleaned up by
the session ids the routes handed out. The sweep runs before the suite as well
as after: a crashed run must not leave rows in the inbox a reviewer opens.

A few assertions sit below the route seam and say so. The FAQ ranking and the
concurrency claim are guarantees that live in the database, and two webhooks
arriving at the same instant cannot be staged through sequential calls.

## Running it

```bash
bun install
cp .env.example .env.local      # then fill it in
bun run dev
```

Apply the schema with `bunx supabase link` and `bunx supabase db push`. Point
the LINE channel's webhook at `/api/line/webhook`.

The environment is checked once at import, so a bad deploy fails at boot and
names the variable. A localhost Supabase URL on a deployed instance is rejected
outright: it looks valid, boots fine, then makes every query die as
`fetch failed` after seven seconds with no clue why.

`/api/health` reports what is configured and whether the database answers, so a
broken deploy can be diagnosed without reading logs. With no OpenRouter key the
app behaves as it did before the agent existed: messages arrive, staff reply,
nothing throws.
