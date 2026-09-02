-- Rank FAQ matches by how specific the matching tag is, not how many matched.
--
-- Counting matches treats every tag as equal evidence, which it is not. Asking
-- "พาหมาไปได้ไหม" (may I bring my dog) matched the *location* entry, because its
-- tag 'ไป' -- "go" -- is a substring of almost any Thai sentence, and one weak
-- match tied with the pets entry's real one on 'หมา'.
--
-- Summing the matched tags' lengths makes a longer tag count for more, which is
-- a decent proxy for specificity: a three-character word carries more evidence
-- than a two-character particle. Combined with dropping the genuinely generic
-- tags below, an accidental match can no longer outrank a real one.

create or replace function public.search_faq(p_query text, p_limit integer default 4)
returns table (question text, answer text, score integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.question,
    f.answer,
    (
      (select coalesce(sum(length(t)), 0)::int from unnest(f.tags) as t where p_query ilike '%' || t || '%')
      + case when p_query ilike '%' || f.question || '%' then 10 else 0 end
    ) as score
  from public.faq_entries f
  where f.is_active
    and (
      exists (select 1 from unnest(f.tags) as t where p_query ilike '%' || t || '%')
      or p_query ilike '%' || f.question || '%'
    )
  order by score desc, f.sort_order
  limit greatest(1, least(coalesce(p_limit, 4), 10));
$$;

-- `revoke ... from public` also strips what service_role inherits through it,
-- so the grant has to be put back explicitly or the server loses its own access.
revoke all on function public.search_faq(text, integer) from public, anon, authenticated;
grant execute on function public.search_faq(text, integer) to service_role;

-- 'ไป' (go) and 'ทาง' (way) are common enough in ordinary Thai that they match
-- questions about anything at all.
update public.faq_entries
set tags = array_remove(array_remove(tags, 'ไป'), 'ทาง'),
    updated_at = now()
where 'ไป' = any(tags) or 'ทาง' = any(tags);
