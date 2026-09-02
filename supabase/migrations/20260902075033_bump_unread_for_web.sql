-- A web visitor writing in should raise the unread count, the way a LINE
-- message already does inside ingest_line_message.
--
-- Without this the inbox showed every web conversation as zero unread forever,
-- quietly telling the operator that nobody was waiting.
--
-- It is a function rather than a read-then-write from the application because
-- two visitors typing at once would otherwise both read the same number and
-- both write it back plus one, losing a count.

create or replace function public.bump_unread(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations
  set unread_count = unread_count + 1,
      last_message_at = now()
  where id = p_conversation_id;
$$;

-- `revoke ... from public` also strips what service_role inherits through it,
-- so the grant has to be put back explicitly or the server loses its own access.
revoke all on function public.bump_unread(uuid) from public, anon, authenticated;
grant execute on function public.bump_unread(uuid) to service_role;
