-- 0070_coin_match_signals.sql
--
-- THE FACTS THE COIN MATCH NEEDS THAT WE DID NOT KEEP, AND THE RE-TUNE'S FITTED WEIGHTS.
--
-- A feed post's coin is PROVEN by its links, its picture, or its own account posting the coin's
-- address under it, and the rest are RANKED by a score (core/src/match/post-coin.ts). Two
-- things that needs had nowhere to live (the addresses posted under a post, and by whom, ride in
-- crypto_attention's `cashtags` jsonb as `_addresses`, beside the own/others split — no column):
--
--   internal.image_hash        each picture's perceptual hash (services/runner picture-hash.ts),
--                              by its address: post pictures and coin logos alike. Free to make,
--                              so every new coin's logo is hashed and a post's picture can find
--                              the coins that took it as their logo — "search by picture" without
--                              paying to embed every logo the mint stream sees. `bits` is the hash
--                              as a signed 64-bit integer so the distance is one XOR and a bit
--                              count in SQL. `bits` null: the picture could not be read (an
--                              unknown, never "different"; `attempts` stops the retries).
--   internal.coin_match_fit    each refit of the ranking's weights by the twice-daily re-tune
--                              (tools/lib/coin-match-fit.ts): the weights, the likely bar, what it
--                              was fitted on and how it scored. The projector ranks with the newest
--                              row and falls back to Policy.postCoin.weights when there is none.
--
-- What breaks if changed carelessly: the hash's bit order. `bits` is the 16 hex digits read as one
-- big-endian 64-bit number; a writer that packs them differently makes every distance noise and no
-- error says so. `version` is stored so a changed hash is re-made, never compared with an old one.
-- And the fit rows are history: a refit is a new row, so "which weights ranked this post at 09:00"
-- stays answerable.

create table internal.image_hash (
  uri        text primary key,
  bits       bigint,
  version    text not null,
  attempts   integer not null default 1 check (attempts >= 1),
  hashed_at  timestamptz not null
);

create index image_hash_bits_idx on internal.image_hash (bits) where bits is not null;

comment on table internal.image_hash is
  'Perceptual hash of each picture by its address (post pictures and coin logos). Null bits: unreadable. Read by the coin match only.';

create table internal.coin_match_fit (
  fitted_at         timestamptz primary key,
  weights           jsonb not null,
  likely_min_share  double precision not null check (likely_min_share > 0 and likely_min_share <= 1),
  posts             integer not null check (posts >= 0),
  owner_labels      integer not null check (owner_labels >= 0),
  score             jsonb not null
);

comment on table internal.coin_match_fit is
  'Each re-tune refit of the coin-match ranking weights: the newest row ranks; none falls back to policy. A score orders a list, never proves a coin.';
