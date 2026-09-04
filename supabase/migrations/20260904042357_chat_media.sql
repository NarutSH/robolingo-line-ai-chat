-- Pictures: the ones the shop sends, the ones customers send, and the one the
-- agent can put in front of someone who asked what is on the menu.
--
-- Three things are needed and they are all additive. Nothing here reshapes a
-- column that already carries data.


-- 1. Where a message's picture lives
--
-- Deliberately NOT stored in `messages.content`. That column is fed straight to
-- the model by toModelHistory() and straight to the conversation list as
-- last_message_preview -- a URL in there would read to the agent as something
-- the customer said, and to the operator as the text of the last message. So
-- `content` keeps holding words a human would read ('[image]', or a caption),
-- and the file gets a column of its own.
alter table public.messages
  add column if not exists media_url text;

comment on column public.messages.media_url is
  'Public URL of the image this message carries. Null for text. content_type says which.';


-- 2. A picture the shop has published against an FAQ answer
--
-- `slug` exists only so the agent has a stable, readable handle to ask for --
-- 'menu' rather than a uuid. It is null for every entry that has no picture,
-- which is most of them, and unique where it is set.
alter table public.faq_entries
  add column if not exists image_url text,
  add column if not exists slug text;

create unique index if not exists faq_entries_slug_key
  on public.faq_entries (slug)
  where slug is not null;

comment on column public.faq_entries.image_url is
  'Public URL of a picture that answers this entry. Attaching one is a data edit, like changing the opening hours.';


-- 3. The bucket
--
-- Public read, because LINE fetches originalContentUrl from its own servers
-- with no credentials of ours -- a signed URL would expire and a private bucket
-- would simply fail to deliver. Writes are another matter: every write goes
-- through the secret key on the server, which bypasses RLS, and no policy is
-- added here. So the bucket is readable by anyone holding a URL and writable by
-- nobody but us, which is the same shape as every other table in this schema.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  true,
  5242880,                                   -- 5 MB; LINE's own ceiling is 10
  array['image/jpeg', 'image/png']           -- what LINE will accept
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- 4. search_faq gains the two fields the picture tool needs
--
-- The ranking is untouched. The agent is told which matches have a picture and
-- what to call one, so `show_image` can only ever name something this lookup
-- just returned -- the same rule that stops it inventing an opening time.
--
-- Dropped rather than replaced: `create or replace` refuses to change the row
-- type defined by OUT parameters, and adding a returned column is exactly that.
drop function if exists public.search_faq(text, integer);

create function public.search_faq(p_query text, p_limit integer default 4)
returns table (question text, answer text, score integer, slug text, has_image boolean)
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
    ) as score,
    f.slug,
    (f.image_url is not null) as has_image
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


-- 5. The one entry that will carry a picture
--
-- The slug is set now so the shop only has to fill in image_url -- a data edit,
-- no deploy -- to switch the feature on for the question customers ask most.
update public.faq_entries
set slug = 'menu', updated_at = now()
where question = 'เมนูแนะนำมีอะไรบ้าง';
