-- The answers the shop gives most often, so changing the opening hours is a
-- data edit rather than a deploy.
--
-- No extensions. `pg_trgm` and `unaccent` live in the `extensions` schema on
-- Supabase Cloud, which is not on a migration session's search_path -- the same
-- trap that made `gen_random_bytes()` fail in the initial schema.

create table if not exists public.faq_entries (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  answer      text not null,
  -- Short keywords a customer would actually type, in both languages. See the
  -- note on search_faq below for why these carry the matching.
  tags        text[] not null default '{}',
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Adding an embedding column and an index later is a pure addition; nothing
-- here has to be reshaped for it.

comment on table public.faq_entries is
  'Shop FAQ. Read only through the service role, by the agent''s search_faq tool.';

create index if not exists faq_entries_active_idx
  on public.faq_entries (is_active, sort_order);

-- RLS on with zero policies, matching every other table: the secret key on the
-- server is the only way a row is ever read.
alter table public.faq_entries enable row level security;


-- Matching, and why it runs backwards
--
-- Thai is written without spaces, so a Thai question arrives as one
-- unsegmented token: "เปิดกี่โมง" cannot be split into words by anything in
-- core Postgres, and full-text search would index it as a single meaningless
-- lexeme. Splitting the *query* is therefore hopeless.
--
-- So the match runs the other way: each entry carries short tags, and a tag
-- scores if it appears inside the customer's question. "เปิด" and "กี่โมง" are
-- both substrings of "เปิดกี่โมง", and "hours" is a substring of "what are your
-- hours" -- one rule that works in both languages without a segmenter.
--
-- At this size (a couple of dozen entries) that is not a compromise, it is the
-- right amount of machinery. Embeddings become worth their weight when the
-- corpus is large enough that a human cannot skim it.
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
      (select count(*)::int from unnest(f.tags) as t where p_query ilike '%' || t || '%')
      + case when p_query ilike '%' || f.question || '%' then 2 else 0 end
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


-- Seed: Baan Kafae, a fictional single-branch coffee shop.
insert into public.faq_entries (question, answer, tags, sort_order) values
  (
    'เปิดกี่โมง',
    'บ้านกาแฟเปิดทุกวัน 07:00–19:00 น. ครับ ครัวปิดรับออเดอร์สุดท้าย 18:30 น. / We are open every day 07:00–19:00, last order 18:30.',
    array['เปิด','ปิด','กี่โมง','เวลา','วันไหน','open','opening','hours','close','closing','time'],
    10
  ),
  (
    'ร้านอยู่ที่ไหน',
    'อยู่ซอยสุขุมวิท 31 เดินจาก BTS พร้อมพงษ์ ทางออก 5 ประมาณ 6 นาทีครับ / Sukhumvit 31, about a 6-minute walk from BTS Phrom Phong exit 5.',
    array['ที่ไหน','อยู่','แผนที่','สาขา','ทาง','ไป','address','where','location','map','bts','directions'],
    20
  ),
  (
    'มีที่จอดรถไหม',
    'มีที่จอดรถหน้าร้าน 4 คันครับ ถ้าเต็มมีอาคารจอดรถห่างไป 100 เมตร คิด 20 บาท/ชม. / Four spaces in front. When full, there is a car park 100m away at 20 THB per hour.',
    array['จอดรถ','ที่จอด','รถ','parking','park','car'],
    30
  ),
  (
    'มี wifi ไหม',
    'มีครับ ฟรีไม่จำกัดเวลา ขอรหัสได้ที่เคาน์เตอร์ มีปลั๊กไฟทุกโต๊ะริมผนัง / Yes, free and unlimited. Ask at the counter for the password; every wall-side table has a power outlet.',
    array['wifi','ไวไฟ','อินเทอร์เน็ต','เน็ต','รหัส','ปลั๊ก','internet','password','plug','outlet','power'],
    40
  ),
  (
    'เมนูแนะนำมีอะไรบ้าง',
    'ที่ขายดีคือ ลาเต้น้ำผึ้งมะนาว, เอสเพรสโซ่โทนิก และดริปเมล็ดดอยช้างคั่วกลาง ส่วนของหวานแนะนำบาสก์ชีสเค้กครับ / Best sellers: honey-lemon latte, espresso tonic, and a medium-roast Doi Chang pour-over. For dessert, the basque cheesecake.',
    array['เมนู','แนะนำ','ขายดี','อะไรดี','กาแฟ','ของหวาน','เค้ก','menu','recommend','signature','best','popular','coffee','cake','dessert'],
    50
  ),
  (
    'ราคาประมาณเท่าไหร่',
    'กาแฟร้อน 65–95 บาท เย็น 75–110 บาท ดริปพิเศษ 120 บาท เค้ก 95–135 บาทครับ / Hot coffee 65–95 THB, iced 75–110, single-origin pour-over 120, cake 95–135.',
    array['ราคา','เท่าไหร่','กี่บาท','แพง','ถูก','price','prices','cost','how much','expensive'],
    60
  ),
  (
    'จ่ายเงินยังไงได้บ้าง',
    'รับเงินสด พร้อมเพย์ และบัตรเครดิต/เดบิตครับ ยอดตั้งแต่ 100 บาทขึ้นไปรูดบัตรได้ / Cash, PromptPay QR, and credit or debit card. Card payments from 100 THB.',
    array['จ่าย','ชำระ','เงินสด','พร้อมเพย์','บัตร','โอน','qr','pay','payment','card','cash','promptpay','transfer'],
    70
  ),
  (
    'จองโต๊ะได้ไหม',
    'รับจองล่วงหน้าเฉพาะโต๊ะ 6 ที่นั่งขึ้นไปครับ โต๊ะเล็กเป็นแบบมาก่อนได้ก่อน / Reservations for tables of six or more only. Smaller tables are first come, first served.',
    array['จอง','โต๊ะ','จองโต๊ะ','ล่วงหน้า','ที่นั่ง','book','booking','reserve','reservation','table','seat'],
    80
  ),
  (
    'พาสัตว์เลี้ยงเข้าได้ไหม',
    'โซนด้านนอกพาน้องหมาน้องแมวเข้าได้ครับ ขอเป็นสายจูงหรือกระเป๋า ส่วนโซนแอร์ในร้านไม่อนุญาตครับ / Pets are welcome in the outdoor area on a lead or in a carrier. The air-conditioned room is pet-free.',
    array['สัตว์เลี้ยง','หมา','แมว','น้องหมา','pet','pets','dog','cat','animal'],
    90
  ),
  (
    'มีนมทางเลือกไหม',
    'มีนมโอ๊ต นมอัลมอนด์ และนมถั่วเหลืองครับ เพิ่ม 20 บาท / Oat, almond and soy milk are available for 20 THB extra.',
    array['นมโอ๊ต','โอ๊ต','อัลมอนด์','ถั่วเหลือง','นม','แพ้นม','วีแกน','oat','almond','soy','milk','vegan','dairy','lactose'],
    100
  ),
  (
    'สั่งเดลิเวอรีได้ไหม',
    'สั่งผ่าน Grab และ LINE MAN ได้ครับ ช่วง 08:00–18:00 น. หรือสั่งล่วงหน้าทางแชทนี้แล้วมารับเองก็ได้ / Available on Grab and LINE MAN, 08:00–18:00. You can also order ahead in this chat and collect.',
    array['เดลิเวอรี','ส่ง','สั่ง','กลับบ้าน','takeaway','delivery','grab','lineman','order','pickup','takeout'],
    110
  ),
  (
    'ขายเมล็ดกาแฟไหม',
    'ขายครับ ถุง 250 กรัม 320 บาท เมล็ดดอยช้างและดอยแม่สลอง คั่วใหม่ทุกสัปดาห์ บดให้ฟรีครับ / Yes — 250g bags at 320 THB, Doi Chang and Doi Mae Salong, roasted weekly. We grind for free.',
    array['เมล็ด','เมล็ดกาแฟ','ซื้อกลับ','คั่ว','บด','beans','bean','roast','grind','buy','whole bean'],
    120
  ),
  (
    'นั่งทำงานได้ไหม',
    'ได้ครับ มีโต๊ะยาวสำหรับนั่งทำงาน 10 ที่ ไม่จำกัดเวลา แต่ช่วงเสาร์–อาทิตย์ 12:00–15:00 น. ขอจำกัด 2 ชั่วโมงครับ / Yes, ten seats at the long working table with no time limit, except weekends 12:00–15:00 when we ask for a two-hour limit.',
    array['ทำงาน','นั่งนาน','โน้ตบุ๊ก','เรียน','ประชุม','work','working','laptop','study','wfh','remote','meeting'],
    130
  ),
  (
    'รับจัดเลี้ยงหรือออเดอร์ใหญ่ไหม',
    'รับครับ ออเดอร์ 20 แก้วขึ้นไปแจ้งล่วงหน้า 1 วัน มีส่วนลด 10% ทักมาในแชทนี้ได้เลยครับ / Yes. Orders of 20 cups or more need one day''s notice and get 10% off. Just message us here.',
    array['จัดเลี้ยง','ออเดอร์ใหญ่','เยอะ','ประชุม','ส่วนลด','catering','bulk','large order','event','discount'],
    140
  );
