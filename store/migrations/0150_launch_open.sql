-- 0150_launch_open.sql
--
-- EACH LAUNCH'S FIRST SECOND, AS THE TRADE STREAM SAW IT (the owner, 2026-10-29: catch a coin "as soon as
-- it is deployed" and tell the real one from its copycats). Chainwatch already reads every trade the relay
-- carries for its own charts (services/chainwatch chart-book.ts); for a coin it sees launch it now counts,
-- over the first `OPEN_WINDOW_MS` of trading, the buys, the distinct wallets that bought, and the creator's
-- own opening buy, and writes one row when that second is over.
--
-- Why these three: replayed over the launches of 29 Sep–28 Oct read from the chain (17,065 fingerprinted,
-- weighted to the month's 173,000), a launch with 15 or more buyers in its first second passed $100k at
-- 1.25% against 0.00% for one with a single buyer (the creator alone) and 0.27% overall; seven or more buys
-- in the launch block, 0.70% against 0.03%. A fresh creator wallet was no worse than an old one, so the
-- signal survives a team's new wallets. Nothing here is shown or decides anything yet: the coin pick ranks
-- by it only once live rows have confirmed the replay.
--
-- ★ SMALL ON PURPOSE: one row a launch, three numbers and two times — about 40 bytes, a few MB a day at the
-- launchpad's pace — and kept `14 days` (the pruning is the writer's, chainwatch chart.ts). No trade, no
-- wallet address is stored: the buyers are counted, not listed.
--
-- What breaks if changed carelessly: the key. One row per coin; a restart that sees the launch again finds
-- the row and leaves it (on conflict do nothing), so a second reading never overwrites the first.

create table internal.launch_open (
  address      text        primary key check (length(address) between 1 and 200),
  launched_at  timestamptz not null,
  buyers       integer     not null check (buyers >= 0),
  buys         integer     not null check (buys >= 0),
  dev_buy_usd  double precision check (dev_buy_usd is null or dev_buy_usd >= 0),
  recorded_at  timestamptz not null default now()
);

create index launch_open_launched_idx on internal.launch_open (launched_at);

comment on table internal.launch_open is
  'Each launch''s first second of trading as the trade stream saw it: buys, distinct buyers, the creator''s opening buy in dollars (null when unpriced). Internal; never shown.';
