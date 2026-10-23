-- 0128_reproduced_post.sql
--
-- THE QUOTED POST, AS THE QUOTE'S OWN PAYLOAD CARRIED IT (the owner, 2026-10-24: "I want to see the
-- original image of quote-tweeted posts along with the quote-tweeted message").
--
-- ★ WHY. A quote post's card showed only its own words. The meme is usually the quoted post's
-- picture, and the quoted post was a public.item row for 21 of the 44 quote posts For You showed
-- in the three days to 24 Oct (9 of the 18 with no picture of their own): the rest were never
-- found by a search. The text source sends the quoted post
-- whole inside every quote post it returns, so it costs nothing to keep — and it was being dropped
-- on the floor, all but its id.
--
-- ★ ITS OWN TABLE, NEVER A public.item ROW. A post seen only inline was not found by any search.
-- Written into public.item it would be judged (a paid call), grouped, counted, embedded and given a
-- found-by lane like a post a search returned; here nothing that judges, counts or groups posts can
-- meet it. The read side prefers the public.item row when there is one (fresher, and its own) and
-- falls back to this one — including when the item row was slimmed and its picture link emptied.
--
-- One row per QUOTED post, keyed by its id in our form (`x:<id>`), so it meets public.item by
-- item_id. Many quotes of one post write the same row; the newest read wins.
--
--   author_*     the account as the payload showed it: handle (no '@'), name, picture link. The
--                read prefers public.author's row for the same key when there is one (it holds our
--                copy of the face, 0079)
--   media        the MediaRef list, as public.item.media holds it
--   read_at      when we read the payload that carried it; an older read never overwrites a newer
--
-- No pointer to public.item: the quoted post is usually one we never stored (0031's reason).
--
-- `public`, read by the app role (the read service names the quoted account's face on the card).
-- Written only by PgItemRepo.upsert, on the service credential, beside the quote post itself.
--
-- What breaks if changed carelessly: the item_id form. It must be exactly public.item's, or a quoted
-- post we also hold as an item is shown twice-sourced and the fresher row is never preferred. The
-- writer looks this table up before writing and the readers treat it missing as "no quoted posts",
-- so code deployed before this migration behaves as before.

create table public.reproduced_post (
  item_id             text primary key check (length(item_id) between 1 and 200),
  source              text not null,
  source_item_id      text not null,
  author_key          text not null,
  author_handle       text,
  author_name         text,
  author_picture_url  text check (author_picture_url is null or author_picture_url like 'https://%'),
  posted_at           timestamptz,
  lang                text,
  body                text not null,
  media               jsonb not null default '[]'::jsonb,
  read_at             timestamptz not null
);

comment on table public.reproduced_post is
  'A quoted post as its quote post''s payload carried it: words, media, account. Shown inside the quote''s card; never a public.item row, never judged, counted or grouped.';

/* 0073's rule for every table in `public`: row security on, our four roles let through. */
alter table public.reproduced_post enable row level security;
create policy insidor_roles on public.reproduced_post for all
  to insidor_app, insidor_people, insidor_service, insidor_internal using (true) with check (true);

/* The service role writes through 0001's default privileges; the app role reads by this grant alone. */
grant select on public.reproduced_post to insidor_app;
