-- 0116_coin_first.sql
--
-- THE COIN-FIRST ROUTE'S OWN RECORD: which posts a running coin's link brought to the judge and
-- onto For You, what was spent on each, and that the route — not the view bar — let it in.
--
-- ── WHY ──────────────────────────────────────────────────────────────────
--
-- The owner, 2026-10-20: the Laura video (x:2112513331110322438), reposted by Saylor and coined
-- through that repost, was read only because another coin linked it, judged yes 47 minutes later,
-- and never shown: no lane held it, so For You never read it, and nothing read its views again. The route (Policy.rising.coinFirst, services/runner
-- work/coin-first.ts) reads such a post by id, asks the judge once, and the projector lets it onto
-- For You when the judge said yes and the one-coin rule picked a coin that ties it.
--
-- internal.coin_first_post  one row per post the route touched, keyed by the post:
--   coin_address / launched_at  the running coin that brought it, and its launch
--   via                         'link' (the coin's own link names the post) or 'hop' (it names a
--                               post that reposts or quotes this one)
--   first_coin_address          the earliest-launched observed coin tying the post either way: the
--                               launch push goes out for a coin-first post only when its picked coin
--                               is this one (services/notify launch.ts)
--   fetch_asked_at / judge_asked_at  when the route paid to read / judge it; each at most once, and
--                               the daily caps count these columns
--   credited_at                 when it was credited to the 'coin_link' lane, so For You reads it
--   admitted_at                 when a frame first put it on For You by this route alone. Set once:
--                               a post joins by this route once
--
-- Internal only: the route is the system's reasoning and never reaches a screen. The alert service
-- (insidor_people) reads it for the push rule, so it gets SELECT on this one table.
--
-- What breaks if changed carelessly: overwriting a set time. The caps count the asks, and the push
-- and the dedupe read `admitted_at`; every writer keeps the first value (coalesce).

create table internal.coin_first_post (
  item_id            text primary key check (length(item_id) between 1 and 200),
  coin_address       text not null check (length(coin_address) between 1 and 100),
  launched_at        timestamptz not null,
  via                text not null check (via in ('link', 'hop')),
  first_coin_address text check (first_coin_address is null or length(first_coin_address) between 1 and 100),
  first_seen_at      timestamptz not null,
  fetch_asked_at     timestamptz,
  judge_asked_at     timestamptz,
  credited_at        timestamptz,
  admitted_at        timestamptz,
  updated_at         timestamptz not null
);
create index coin_first_post_launched_idx on internal.coin_first_post (launched_at desc);
create index coin_first_post_fetch_idx on internal.coin_first_post (fetch_asked_at) where fetch_asked_at is not null;
create index coin_first_post_judge_idx on internal.coin_first_post (judge_asked_at) where judge_asked_at is not null;

comment on table internal.coin_first_post is
  'Posts the coin-first route touched: the running coin that linked it, what was read or judged for it, and when For You took it by this route alone. Internal; never shown.';

grant select on internal.coin_first_post to insidor_people;
