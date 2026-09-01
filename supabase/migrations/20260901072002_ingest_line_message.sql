-- ─────────────────────────────────────────────────────────────────────────────
-- 0002_ingest — one atomic call for the LINE webhook's request phase
--
-- The webhook must record the event BEFORE returning 200. If this ran inside
-- after() and the invocation were killed, LINE's redelivery would find no
-- record and process the message twice. Doing it as a single rpc keeps the
-- whole critical path to one HTTP round trip.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.ingest_line_message(
  p_webhook_event_id       text,
  p_event_type             text,
  p_is_redelivery          boolean,
  p_line_user_id           text,
  p_line_message_id        text,
  p_content                text,
  p_content_type           text,
  p_quoted_line_message_id text,
  p_reply_token            text,
  p_raw                    jsonb
)
returns table (
  conversation_id uuid,
  message_id      uuid,
  contact_id      uuid,
  realtime_token  text,
  needs_profile   boolean,
  is_duplicate    boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_claimed boolean;
  v_contact       public.line_users%rowtype;
  v_conv          public.conversations%rowtype;
  v_message_id    uuid;
  v_preview       text;
begin
  -- 1. Claim the event. Zero rows back means we already handled it.
  insert into public.line_webhook_events (webhook_event_id, event_type, is_redelivery, payload)
  values (p_webhook_event_id, p_event_type, coalesce(p_is_redelivery, false), p_raw)
  on conflict (webhook_event_id) do nothing
  returning true into v_event_claimed;

  if v_event_claimed is null then
    -- Already processed. Look up the conversation so the caller still gets a row
    -- back (a bare `return query` over an empty select would return none, which
    -- the caller could not distinguish from an error).
    select c.* into v_conv
      from public.conversations c
      join public.line_users u on u.id = c.line_user_id
     where u.line_user_id = p_line_user_id
     limit 1;

    return query select v_conv.id, null::uuid, v_conv.line_user_id, v_conv.realtime_token, false, true;
    return;
  end if;

  -- 2. Upsert the contact. Profile details are fetched later, in after().
  insert into public.line_users (line_user_id)
  values (p_line_user_id)
  on conflict (line_user_id) do update set updated_at = now()
  returning * into v_contact;

  -- 3. Get or create the conversation.
  insert into public.conversations (channel, line_user_id)
  values ('line', v_contact.id)
  on conflict (line_user_id) where channel = 'line'
  do update set last_message_at = now()
  returning * into v_conv;

  -- 4. Record the message. A repeat line_message_id under a fresh event id is
  --    still a duplicate message, so fall back to the existing row.
  if p_line_message_id is not null then
    insert into public.messages (
      conversation_id, direction, sender, content_type, content,
      line_message_id, line_event_id, line_reply_token, line_reply_token_at,
      quoted_line_message_id, raw
    ) values (
      v_conv.id, 'inbound', 'line_user', coalesce(p_content_type, 'text'), coalesce(p_content, ''),
      p_line_message_id, p_webhook_event_id, p_reply_token, now(),
      p_quoted_line_message_id, p_raw
    )
    on conflict (line_message_id) where line_message_id is not null do nothing
    returning id into v_message_id;

    if v_message_id is null then
      select m.id into v_message_id
        from public.messages m
       where m.line_message_id = p_line_message_id;

      return query select v_conv.id, v_message_id, v_contact.id, v_conv.realtime_token, false, true;
      return;
    end if;

    -- 5. Keep the inbox list ordered and previewable without a join.
    v_preview := left(regexp_replace(coalesce(p_content, ''), '\s+', ' ', 'g'), 120);
    update public.conversations
       set last_message_at      = now(),
           last_message_preview = v_preview,
           unread_count         = unread_count + 1
     where id = v_conv.id;
  end if;

  return query
    select v_conv.id,
           v_message_id,
           v_contact.id,
           v_conv.realtime_token,
           (v_contact.profile_fetched_at is null),
           false;
end;
$$;

-- Locked to the secret key. Revoking from PUBLIC also strips the implicit grant
-- that service_role inherits, so it has to be granted back explicitly.
revoke all on function public.ingest_line_message(text,text,boolean,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_line_message(text,text,boolean,text,text,text,text,text,text,jsonb) to service_role;
