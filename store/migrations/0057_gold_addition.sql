-- 0057_gold_addition.sql
--
-- GOLD GROWS FROM LIVE: ORIGIN POSTS OF REAL COINS, ADDED A DAY AT A TIME.
--
-- The committed gold set (eval/src/gold) is the floor every re-tune of the post judge is held to:
-- a block of examples that shuts out real coin posts is never applied. That set was frozen from
-- history. This table adds to it from what happened since, each row dated, from two places:
--
--   recall   a coin from the daily recall check (internal.recall_check, 0047) that bonded and
--            whose creator linked an X post made before the coin launched — the creator's own
--            word that this post started it
--   missed   a post the owner pasted as missed (internal.missed_post) that later got a coin
--
-- ★ ADDED, NEVER EDITED. One row per post, written once (tools/retune.ts, before each re-tune);
-- the text and picture are as read on the day. A post whose text could not be read is not added
-- that day and is tried again the next, rather than added with an empty body that every judge
-- would fail — gold with a hole in it would block a good block of examples.
--
-- What breaks if changed carelessly: `item_id` is the feed's id ('x:<status id>'). The re-tune
-- keeps any post in the examples block out of the gold test by that id; a different spelling
-- would let a post be both taught and tested.
--
-- `internal`, no grant: our test set, never shown.

create table internal.gold_addition (
  item_id      text primary key check (item_id ~ '^[a-z]+:.+'),
  source       text not null check (source in ('recall', 'missed')),
  coin_mint    text not null,
  coin_name    text,
  post_text    text not null check (length(post_text) > 0),
  image_uri    text,
  posted_at    timestamptz,
  launched_at  timestamptz,
  -- The day it joined gold (UTC), and when the row was written.
  added_on     date not null,
  added_at     timestamptz not null
);

create index gold_addition_added_at on internal.gold_addition (added_at);

comment on table internal.gold_addition is
  'Origin posts of real coins added to the gold set from live (the daily recall check, and the owner''s missed posts that got a coin), dated. Gold is the floor every re-tune is held to.';
