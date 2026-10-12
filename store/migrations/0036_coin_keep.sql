-- 0036_coin_keep.sql
--
-- WHERE EACH OLD COIN STOOD WHEN IT AGED OUT, SO THE UNIVERSE CAN KEEP ONLY THE COINS THAT MATTER.
--
-- Chainwatch sees every launch, ~40,000 a day, and almost none of them is ever traded. Every
-- coin is kept for `universe.keep.allMs` (fourteen days). After that a coin stays only if a
-- narrative or a post names it, it bonded, it is in the gold set, or its market cap reached
-- `universe.keep.marketCapUsd` — and the rest are deleted (runner/src/work/coin-keep.ts).
--
-- This table is the "bonded" and "how big" half of that rule: one row per coin asked about,
-- written only from a source's ANSWER. A coin the answer did not list is `listed = false` —
-- nobody traded it. A failed call writes nothing, so an outage never deletes a coin.
--
-- The cap is the highest the coin was seen at, here or in public.market_reading: "peaked above
-- the bar" can only mean "we saw it above the bar". A coin whose peak we never saw is not
-- assumed to have had one.
--
-- What is never deleted, whatever this table says: a coin with a market reading (that history
-- is append-only and references the coin), one a narrative's page or a post names, one whose
-- origin we found or that is in the gold set, and any coin not from the mint stream or a search
-- (seeds, the team's own entries). The predicate lives in one place, store/src/repo/coin-universe.ts.
--
-- `internal`, no grant: which coins we judged worth keeping is our reasoning.

create table internal.coin_standing (
  asset_key     text primary key references public.asset (asset_key) on delete cascade,
  listed        boolean not null,
  bonded        boolean not null,
  peak_market_cap_usd double precision check (peak_market_cap_usd >= 0),
  checked_at    timestamptz not null,
  constraint unlisted_is_neither check (listed or (not bonded and peak_market_cap_usd is null))
);

-- The sweep walks the mint stream's coins oldest first; without this it reads the whole table
-- every minute. Partial on the two origins the sweep may delete — the list is the same as the
-- delete statement's, and store/src/migrations.test.ts does not need to know it.
create index asset_sweep_idx on public.asset (first_seen_at) where origin in ('live_stream', 'backfill');

comment on table internal.coin_standing is
  'Where each coin stood in its market when it aged out of the keep-everything window: listed, bonded, highest market cap seen. Written only from an answer.';
