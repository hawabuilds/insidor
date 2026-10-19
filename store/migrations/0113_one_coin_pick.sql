-- 0113_one_coin_pick.sql
--
-- ONE POST, ONE COIN: the candidates a launch was matched to, the one coin each post and each
-- narrative is given (or none), every change of that coin, and the weekly refit's proposals.
--
-- The runner writes all four (services/runner work/one-coin.ts, core match/one-coin.ts). The
-- projector reads the picks — only while Policy.oneCoin.mode is 'live' does a card show one — and
-- the tools read everything (tools/onecoin-shadow.ts, onecoin-replay.ts, onecoin-refit.ts).
--
--   one_coin_candidate   a coin that could be a post's: the matcher's ties (link, exact name,
--                        picture) or the second path's "biggest coin of the name" (path
--                        'existing'), with the evidence as found. One row per post and coin,
--                        updated as late metadata or a hash adds a tie. Never deleted: the
--                        replay and the refit read them back.
--   post_coin_pick       each post's one coin NOW: `outcome` picked / waiting / none, the coin and
--                        since when it is held (`decided_at`), and the standings the rule judged
--                        on (`evidence`: net buying, buyers, cap, why a coin is out, and the basis —
--                        trades, or market readings when the trade feed was not running).
--   narrative_coin_pick  the same for a narrative, judged over its posts' candidates together.
--   coin_pick_change     every time a subject's coin changed: first pick, hand-over, dropped. The
--                        history the shadow report and the refit read; append-only.
--   one_coin_fit         the weekly refit's proposal: the bars, their replay score and the bars in
--                        force's on the same cases; `applied` only when the proposal scored better.
--
-- ★ `evidence` IS OURS AND STAYS HERE. Net buying, buyer counts and the rule's reasons are the
-- system's reasoning; no grant reaches the app role, and the projector puts only the coin on a card.
--
-- ★ THE TRADE FEED IS 0112's. internal.coin_watch, coin_trade_minute and coin_trade_state are
-- created by 0112 (chainwatch's trade subscriptions); nothing here references them, so this file
-- applies whether or not 0112 is there yet, and the runner degrades to market readings without it.
--
-- `internal`, written by the runner (insidor_internal: select, insert, update by 0001's defaults).
-- What breaks if changed carelessly: the primary keys. One pick row per subject is what lets the
-- card and the push read "the" coin; a second row per post would make the card pick between them.

create table internal.one_coin_candidate (
  item_id      text not null check (length(item_id) between 1 and 200),
  address      text not null check (length(address) between 1 and 100),
  path         text not null check (path in ('launch', 'existing')),
  evidence     jsonb not null,
  launched_at  timestamptz,
  found_at     timestamptz not null,
  updated_at   timestamptz not null,
  primary key (item_id, address)
);
create index one_coin_candidate_found_idx on internal.one_coin_candidate (found_at desc);
create index one_coin_candidate_address_idx on internal.one_coin_candidate (address);

create table internal.post_coin_pick (
  item_id     text primary key check (length(item_id) between 1 and 200),
  address     text check (address is null or length(address) between 1 and 100),
  outcome     text not null check (outcome in ('picked', 'waiting', 'none')),
  decided_at  timestamptz not null,
  evidence    jsonb not null,
  updated_at  timestamptz not null,
  constraint post_coin_pick_coin_iff_picked check ((outcome = 'picked') = (address is not null))
);
create index post_coin_pick_updated_idx on internal.post_coin_pick (updated_at desc);

create table internal.narrative_coin_pick (
  narrative_id  text primary key check (length(narrative_id) between 1 and 200),
  address       text check (address is null or length(address) between 1 and 100),
  outcome       text not null check (outcome in ('picked', 'waiting', 'none')),
  decided_at    timestamptz not null,
  evidence      jsonb not null,
  updated_at    timestamptz not null,
  constraint narrative_coin_pick_coin_iff_picked check ((outcome = 'picked') = (address is not null))
);
create index narrative_coin_pick_updated_idx on internal.narrative_coin_pick (updated_at desc);

create table internal.coin_pick_change (
  id            bigint generated always as identity primary key,
  subject_kind  text not null check (subject_kind in ('post', 'narrative')),
  subject_id    text not null check (length(subject_id) between 1 and 200),
  from_address  text,
  to_address    text,
  outcome       text not null check (outcome in ('picked', 'waiting', 'none')),
  mode          text not null check (mode in ('shadow', 'live')),
  basis         text check (basis is null or basis in ('trades', 'market_readings')),
  changed_at    timestamptz not null,
  constraint coin_pick_change_changes check (from_address is distinct from to_address)
);
create index coin_pick_change_subject_idx on internal.coin_pick_change (subject_kind, subject_id, changed_at);
create index coin_pick_change_at_idx on internal.coin_pick_change (changed_at desc);

create table internal.one_coin_fit (
  id          bigint generated always as identity primary key,
  fitted_at   timestamptz not null,
  bars        jsonb not null,
  score       jsonb not null,
  current     jsonb not null,
  cases       integer not null check (cases >= 0),
  applied     boolean not null,
  note        text
);
create index one_coin_fit_applied_idx on internal.one_coin_fit (fitted_at desc) where applied;

comment on table internal.one_coin_candidate is
  'Coins that could be a post''s: the launch-time matcher''s ties (link, exact name, picture, timing) or the second path''s biggest coin of the name. Written by the runner; read by the rule, the shadow report, the replay and the refit.';
comment on table internal.post_coin_pick is
  'Each post''s one coin now (picked / waiting / none), held since decided_at, and the standings the rule judged on. Shown on cards only in Policy.oneCoin.mode live.';
comment on table internal.narrative_coin_pick is
  'Each narrative''s one coin now, judged over its posts'' candidates together. Shown only in Policy.oneCoin.mode live.';
comment on table internal.coin_pick_change is
  'Append-only history of every post and narrative coin change: first pick, hand-over, dropped.';
comment on table internal.one_coin_fit is
  'The weekly refit''s proposed one-coin bars with their replay score against the bars in force; applied only when better.';
