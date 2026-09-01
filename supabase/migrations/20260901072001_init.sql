-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_init — core messaging schema
--
-- Security posture: RLS is enabled on every table with ZERO policies, so the
-- publishable/anon key can read nothing through PostgREST. All access goes
-- through the server using the secret key. The browser holds the publishable
-- key only to subscribe to Realtime (see 0002).
-- ─────────────────────────────────────────────────────────────────────────────

-- No extensions required. `gen_random_uuid()` has been in the Postgres core
-- since 13, so this schema installs cleanly on any Postgres 13+ instance.
--
-- Deliberately NOT using pgcrypto's `gen_random_bytes()`: Supabase Cloud installs
-- extensions into the `extensions` schema, which is not on the migration session's
-- search_path, so `gen_random_bytes()` resolves locally but fails on Cloud with
-- `42883 function does not exist`. `pg_trgm` arrives with the FAQ migration that
-- actually uses it, schema-qualified.

do $$ begin create type conversation_channel as enum ('line','web');            exception when duplicate_object then null; end $$;
do $$ begin create type conversation_mode    as enum ('ai','manual');            exception when duplicate_object then null; end $$;
do $$ begin create type ai_status            as enum ('idle','running','error'); exception when duplicate_object then null; end $$;
do $$ begin create type message_direction    as enum ('inbound','outbound');     exception when duplicate_object then null; end $$;
do $$ begin create type message_sender       as enum ('line_user','web_visitor','operator','ai','system'); exception when duplicate_object then null; end $$;

-- ── contacts ────────────────────────────────────────────────────────────────
create table if not exists public.line_users (
  id                 uuid primary key default gen_random_uuid(),
  line_user_id       text not null unique,          -- 'U' + 32 hex
  display_name       text,
  picture_url        text,
  status_message     text,
  language           text,
  is_friend          boolean not null default true,
  profile_fetched_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── short codes for the web↔LINE relay (phase 3) ────────────────────────────
-- 30-symbol alphabet: Crockford-ish base32 minus 0/1/I/L/O/U to kill ambiguity
-- when an operator retypes a code off their phone screen.
create or replace function public.gen_short_code() returns text
language sql volatile as $$
  select string_agg(
    substr('23456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 30)::int, 1), ''
  ) from generate_series(1, 4);
$$;

-- ── conversations ───────────────────────────────────────────────────────────
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  channel              conversation_channel not null,
  mode                 conversation_mode not null default 'manual',
  line_user_id         uuid references public.line_users(id) on delete cascade,
  web_session_id       text,
  short_code           text default public.gen_short_code(),
  -- The topic name IS the capability: Realtime public channels let anyone with
  -- the publishable key subscribe to any topic they can name, so the name is a
  -- secret handed out only by an authorized API response.
  realtime_token       text not null default replace(gen_random_uuid()::text, '-', ''),
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  unread_count         integer not null default 0,
  -- AI run lock; see the atomic claim in lib/ai/orchestrator.ts (phase 2)
  ai_status            ai_status not null default 'idle',
  ai_run_id            uuid,
  ai_started_at        timestamptz,
  handoff_reason       text,
  handoff_at           timestamptz,
  created_at           timestamptz not null default now(),
  constraint conv_party_ck check (
    (channel = 'line' and line_user_id  is not null and web_session_id is null) or
    (channel = 'web'  and web_session_id is not null and line_user_id  is null)
  )
);

-- Partial uniques rather than a PK on line_user_id: one conversation per 1:1 OA
-- chat today, but this leaves room for group chats without rewriting the table.
create unique index if not exists conversations_line_user_uk   on public.conversations(line_user_id)   where channel = 'line';
create unique index if not exists conversations_web_session_uk on public.conversations(web_session_id) where channel = 'web';
create unique index if not exists conversations_short_code_uk  on public.conversations(short_code)     where short_code is not null;
create unique index if not exists conversations_rt_token_uk    on public.conversations(realtime_token);
create index        if not exists conversations_inbox_idx      on public.conversations(last_message_at desc);

-- ── messages ────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  direction              message_direction not null,
  sender                 message_sender not null,
  content_type           text not null default 'text',   -- text | sticker | image | unsupported
  content                text not null default '',
  line_message_id        text,   -- inbound: event.message.id | outbound: sentMessages[0].id
  line_event_id          text,   -- inbound: event.webhookEventId
  line_reply_token       text,
  line_reply_token_at    timestamptz,
  quoted_line_message_id text,   -- the relay's routing key (phase 3)
  delivery_status        text not null default 'sent',   -- queued | sent | failed
  delivery_error         text,
  raw                    jsonb,
  created_at             timestamptz not null default now()
);

create unique index if not exists messages_line_message_uk on public.messages(line_message_id) where line_message_id is not null;
create index        if not exists messages_conv_created_idx on public.messages(conversation_id, created_at desc, id desc);
create index        if not exists messages_quoted_idx       on public.messages(quoted_line_message_id) where quoted_line_message_id is not null;

-- ── webhook dedupe ──────────────────────────────────────────────────────────
-- Primary idempotency layer. Covers follow/unfollow/postback too, which the
-- messages table cannot. LINE may redeliver without setting isRedelivery, so
-- this is keyed on the event id alone.
create table if not exists public.line_webhook_events (
  webhook_event_id text primary key,
  event_type       text not null,
  is_redelivery    boolean not null default false,
  received_at      timestamptz not null default now(),
  payload          jsonb
);

-- ── shared config ───────────────────────────────────────────────────────────
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
insert into public.app_config (key, value)
values ('inbox_realtime_token', replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- ── RLS: on everywhere, no policies anywhere ────────────────────────────────
alter table public.line_users          enable row level security;
alter table public.conversations       enable row level security;
alter table public.messages            enable row level security;
alter table public.line_webhook_events enable row level security;
alter table public.app_config          enable row level security;
