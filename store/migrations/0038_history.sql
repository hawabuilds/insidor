-- 0038_history.sql
--
-- PAST NARRATIVES, ONE ROW EACH, WITH THEIR TIMELINE — AND WHICH COINS BELONG TO WHICH.
--
-- History has coins and no posts we watched, so a past narrative is built from coins: grouped by
-- core/src/history/group.ts, its origin found once (tools/history-pilot.ts), and stored here with
-- the four points of its timeline — the earliest post found, the first coin, the biggest coin,
-- the peak. Search reads it (services/read/src/search.ts) so a coin still alive today shows its
-- market cap AND where it came from.
--
-- ★ A GAP IS A TYPED REASON, NEVER A BLANK. A narrative either has its origin post or says why it
-- does not: not searched yet, searched and nothing passed the checks, a creator's link that no
-- longer resolves, or a platform we cannot search. The constraint holds exactly one of the two.
-- A post after the first coin is stored with `after_launch` and shown as "went viral after
-- launch", never as where the narrative started.
--
-- Not public.story: a past narrative was never on the board, has no posts we observed and no
-- views over time, and every surface that reads public.story asserts liveness. Kept apart, no
-- live surface can show one by accident.
--
-- Coins here are kept forever: the keep rule (0036) never deletes a coin a past narrative names.
--
-- `public`, granted to the app role: what a narrative was called, when its first post and first
-- coin appeared and how big it got are facts about the world.

create table public.history_narrative (
  narrative_id   text primary key,
  title          text not null check (length(title) > 0),
  -- The origin post as shown: { "authorLabel", "permalink", "postedAt" (ms), "afterLaunch" }.
  origin_post    jsonb,
  origin_gap     text check (origin_gap in ('not_searched_yet', 'origin_not_found', 'possibly_deleted', 'tiktok_not_searchable')),
  first_coin     text not null,
  first_coin_at  timestamptz,
  biggest_coin   text not null,
  peak_market_cap_usd double precision check (peak_market_cap_usd >= 0),
  built_at       timestamptz not null,
  constraint origin_xor_gap check ((origin_post is null) <> (origin_gap is null))
);

create table public.history_coin (
  address       text primary key,
  narrative_id  text not null references public.history_narrative (narrative_id) on delete cascade
);

create index history_coin_narrative_idx on public.history_coin (narrative_id);
create index history_narrative_title_idx on public.history_narrative (lower(title));

grant select on public.history_narrative, public.history_coin to insidor_app;

comment on table public.history_narrative is
  'A past narrative built from its coins: title, origin post or the typed reason there is none, first coin, biggest coin, peak.';
