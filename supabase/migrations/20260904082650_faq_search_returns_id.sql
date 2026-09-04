-- search_faq names the row it matched.
--
-- The ranking is untouched, deliberately: this migration exists so the training
-- board can run the real lookup and point at the answer that won, and a change
-- to the scoring in the same breath would make that board's first report a
-- report about this migration rather than about the shop's tags.
--
-- The console is the only new caller. The agent's tools read question, answer,
-- slug and has_image exactly as before and are indifferent to a column they do
-- not select.
--
-- Dropped rather than replaced: `create or replace` refuses to change the row
-- type defined by OUT parameters, and adding a returned column is exactly that.
-- Same reason the chat_media migration had to drop it.
drop function if exists public.search_faq(text, integer);

create function public.search_faq(p_query text, p_limit integer default 4)
returns table (
  id uuid,
  question text,
  answer text,
  score integer,
  slug text,
  has_image boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    f.question,
    f.answer,
    (
      (select coalesce(sum(length(t)), 0)::int from unnest(f.tags) as t where p_query ilike '%' || t || '%')
      + case when p_query ilike '%' || f.question || '%' then 10 else 0 end
    ) as score,
    f.slug,
    f.image_url is not null as has_image
  from public.faq_entries f
  where f.is_active
    and (
      exists (select 1 from unnest(f.tags) as t where p_query ilike '%' || t || '%')
      or p_query ilike '%' || f.question || '%'
    )
  order by score desc, f.sort_order
  limit greatest(1, least(coalesce(p_limit, 4), 10));
$$;

revoke all on function public.search_faq(text, integer) from public, anon, authenticated;
grant execute on function public.search_faq(text, integer) to service_role;
