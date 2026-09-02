-- Announce a new message the moment it is written, so an open console does not
-- have to wait for its next poll to find out.
--
-- Channels are public with an unguessable topic rather than private. A private
-- channel is authorised through RLS on realtime.messages against a Supabase Auth
-- JWT, and this app has none: operators sign in against our own signed cookie
-- and the browser holds only the publishable key. So the topic itself is the
-- capability -- a per-conversation token nobody can subscribe to without the
-- server having handed it over.

-- A shared topic for the inbox list, generated once here so it is part of the
-- schema rather than another environment variable to keep in sync.
insert into public.app_config (key, value)
values ('console_realtime_topic', replace(gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

create or replace function public.broadcast_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_topic   text;
  v_console text;
begin
  -- Broadcasting is a convenience. A message must be recorded whether or not
  -- anyone hears about it, and this trigger runs inside ingest_line_message --
  -- so an exception here would fail the ingest, return a 5xx, and put LINE into
  -- a redelivery loop over a websocket that happened to be down.
  begin
    select c.realtime_token into v_topic
    from public.conversations c
    where c.id = new.conversation_id;

    select a.value into v_console
    from public.app_config a
    where a.key = 'console_realtime_topic';

    if v_topic is not null then
      perform realtime.send(
        jsonb_build_object('conversationId', new.conversation_id, 'messageId', new.id),
        'message',
        'conversation:' || v_topic,
        false
      );
    end if;

    if v_console is not null then
      perform realtime.send(
        jsonb_build_object('conversationId', new.conversation_id),
        'message',
        'console:' || v_console,
        false
      );
    end if;
  exception
    when others then
      -- Swallowed on purpose. The console keeps a slow poll running precisely
      -- so that losing this costs latency and nothing else.
      null;
  end;

  return null;
end;
$$;

drop trigger if exists messages_broadcast on public.messages;

-- AFTER INSERT, so a message that fails to save is never announced.
create trigger messages_broadcast
after insert on public.messages
for each row
execute function public.broadcast_new_message();
