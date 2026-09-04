-- Reordering the answers as one statement.
--
-- Order is relative: moving an answer up means the one above it moves down, so
-- a reorder is never a single-row edit. Sending one update per row would leave
-- the list half-renumbered if the second one failed, and a half-renumbered list
-- is not a state the operator can see or correct — the numbers are behind an
-- Advanced disclosure precisely because they are not what they are working in.
--
-- `unnest ... with ordinality` gives each id its position in the array, so the
-- whole list is rewritten by one update inside one transaction.
create or replace function public.reorder_faq_entries(p_ids uuid[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  touched integer;
begin
  -- Spaced by ten so an operator who does set a number by hand under Advanced
  -- has somewhere to put it between two existing answers without a reorder.
  update public.faq_entries f
  set sort_order = (ordered.position * 10),
      updated_at = now()
  from (
    select id, ordinality as position
    from unnest(p_ids) with ordinality as t(id, ordinality)
  ) as ordered
  where f.id = ordered.id
    and f.sort_order is distinct from (ordered.position * 10);

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.reorder_faq_entries(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_faq_entries(uuid[]) to service_role;
