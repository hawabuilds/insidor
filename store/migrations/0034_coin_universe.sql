-- 0034_coin_universe.sql
--
-- THE COIN UNIVERSE: WHAT EACH NEW COIN'S METADATA SAID, AND WHERE IT CAME FROM.
--
-- Every coin chainwatch sees is indexed (public.asset). Two facts about it had nowhere to live:
--
--   coin_metadata  what its metadata document said — name, ticker, picture, description, the
--                  creator's links — read by content address through our own gateway, or why
--                  it was not read. `not_content_addressed` is a final answer (the link names
--                  no content id, so it is never fetched); `unavailable` is retried a bounded
--                  number of times (`attempts`).
--   coin_origin    its origin status (contracts/src/origin.ts) and the post it is about, with
--                  the reason in our words. `not_checked_yet` is a row too, written when a
--                  check could not finish — a dry run, a paused line — so "we have not looked"
--                  and "we looked and found nothing" (`unlinked`) are never the same row.
--
-- Both `internal`, no grant. The creator's links are claims and never reach a payload as
-- such; the projector shows only a post we read ourselves, under a status that says how we
-- know. `post_item_id` carries no foreign key, for 0031's reason: the post may not be stored.
--
-- What breaks if changed carelessly: the status list is ORIGIN_STATUSES, kept equal by
-- store/src/migrations.test.ts. A status the code can produce and this CHECK refuses fails
-- the write after the check has been paid for.

create table internal.coin_metadata (
  asset_key     text primary key references public.asset (asset_key) on delete cascade,
  outcome       text not null check (outcome in ('read', 'not_content_addressed', 'unavailable')),
  content_id    text,
  name          text,
  ticker        text,
  description   text,
  image_uri     text,
  social_link   text,
  website       text,
  chat_link     text,
  attempts      integer not null default 1 check (attempts >= 1),
  read_at       timestamptz not null,
  constraint read_has_content_id check ((outcome = 'read') = (content_id is not null))
);

create index coin_metadata_unread_idx on internal.coin_metadata (read_at) where outcome = 'unavailable';

create table internal.coin_origin (
  asset_key     text primary key references public.asset (asset_key) on delete cascade,
  status        text not null check (status in (
                  'linked_by_creator', 'matched_by_insidor', 'found_by_team', 'influencer_origin',
                  'viral_after_launch', 'promo_only', 'account_only', 'unlinked', 'not_checked_yet')),
  post_item_id  text,
  -- The post's time minus the coin's first transaction: negative before launch, positive after.
  post_offset_ms bigint,
  why           text not null check (length(why) > 0),
  checks        integer not null default 1 check (checks >= 1),
  checked_at    timestamptz not null,
  policy_version text not null
);

create index coin_origin_status_idx on internal.coin_origin (status, checked_at);

comment on table internal.coin_metadata is
  'What each coin''s metadata document said, read by content id through our own gateway; or why it was not read.';
comment on table internal.coin_origin is
  'Each coin''s origin status (contracts/src/origin.ts), the post it is about, and why. not_checked_yet is a row, never an absence.';
