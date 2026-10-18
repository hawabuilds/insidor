-- 0109_people_feed.sql
--
-- THE FEED OF PEOPLE YOU FOLLOW: their buys and sells and their comments, newest first
-- (services/social activity.ts, as `insidor_people`). Trador's Following feed, on Insidor's rows.
--
-- ── WHOSE TRADES MAY BE SHOWN ─────────────────────────────────────────────
--
-- `people.profile.trades_public` is the profile switch "Show my trades to followers". It is ON
-- by default, as Trador's (`users.portfolio_public`, its 0012): following someone is following
-- what they do, and their trades are the point of it (the owner, 2026-10-18, knowing it makes
-- every existing person's landed trades visible to their followers when this runs). Turning it
-- off takes them off the Feed at once. The chain is public either way; this governs what
-- Insidor shows, and the switch says so. The social service filters on it in the same query that
-- reads the trades, so there is no second place that could forget it.
--
-- ── WHAT THE SOCIAL SERVICE MAY READ ──────────────────────────────────────
--
-- `public.trade` was readable only by the read service's app role. The social service's role
-- now reads it too, select only: it never writes a trade (that is the trade service's three
-- functions, 0062). The table carries no keys and no transaction bytes, only the facts of each
-- trade, and RLS already lets our four roles through (0073).
--
-- ── INDEXES ───────────────────────────────────────────────────────────────
--
--   trade_landed_idx         a followed person's landed buys and sells, newest first, and the
--                            whole list's (Latest), each a page of 21 from the top of the index.
--   comment_top_level_idx    every visible top-level comment newest first, for Latest; a followed
--                            person's comments use comment_author_idx (0043).
--   profile_wallet_idx       the join from a trade's wallet to the person who made it.
-- Plain CREATE INDEX: the tables are a few rows today (9 trades, 0 comments on 18 Oct 2026), so
-- the SHARE lock the migrator's transaction takes is milliseconds.
--
-- What breaks if changed carelessly: `trades_public` is read on every Feed page; dropping its
-- filter from the trade read shows the trades of people who turned the switch off.

alter table people.profile add column trades_public boolean not null default true;

create index profile_wallet_idx on people.profile (wallet) where wallet is not null;

create index trade_landed_idx on public.trade (wallet, settled_at desc)
  where status = 'confirmed' and kind in ('buy', 'sell') and settled_at is not null;
create index trade_landed_all_idx on public.trade (settled_at desc)
  where status = 'confirmed' and kind in ('buy', 'sell') and settled_at is not null;

create index comment_top_level_idx on people.comment (created_at desc)
  where parent_id is null and hidden_at is null;

grant select on public.trade to insidor_people;
