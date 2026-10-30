-- 0154_launch_signals.sql
--
-- WHAT A LAUNCH'S FIRST MINUTE SAYS, AND WHICH WALLETS HAVE BEEN EARLY TO WINNERS (the owner, 2026-10-30:
-- "beat the runner" — back the coin that will run before it takes off). The signal research
-- (reports/signals/stage1.md §5) found facts at second one that held out of sample: 15+ first-second
-- buyers (0150 has them), 30%+ of supply bought in the launch block (×3.6), a dev buy of 10+ SOL (×6),
-- and 1+ "smart" wallet among the first buyers (×4–5); the dev selling early was a weak minus (×0.4).
-- Chainwatch already reads every trade (chart.ts); this records the rest from the same trades, for free,
-- and a nightly job (tools/smart-wallets.ts) keeps the smart list. NOTHING HERE DECIDES A PICK YET: the
-- owner replays each pick change first, and a replay needs these rows to exist.
--
-- ── 1. internal.launch_open, five facts more ──────────────────────────────
--
--   pool              the pool the launch first traded in. A coin later charted (0144) in ANOTHER pool
--                     left its launchpad: that is how a graduation is told, from our own charts.
--   dev_buy_sol       the creator's opening buy in SOL (the research's cut is in SOL, not dollars).
--   block_share       tokens bought in the launch block over the launchpad's supply (dev included). The
--                     stream has no block number, so "the block" is the buys within
--                     `launchSignals.blockWindowMs` of the launch on the chain's clock — an approximation
--                     to check against chain reads before anything decides on it.
--   first_buyers      the first-second buyers' wallets in buying order, at most `firstBuyersKept`.
--   dev_sold          the creator sold within `devSellWindowMs`. NULL: no opening buy was seen, so
--                     there was no "dev" to watch — never "did not sell".
--   graduated_seen_at set by the nightly job when the coin was seen trading in another pool. NULL is "not
--                     seen graduating", which for a coin we stopped charting is not "did not graduate".
--
-- NULL in the five recorded columns on a row from before 0154 means NOT RECORDED.
--
-- ★ SMALL ON PURPOSE (the database is on a transfer budget). The row is written ONCE, when the dev's
-- minute is over (a minute later than 0150's rows were), so a launch costs one insert, not one and an
-- update. An average launch has 2.6 first-second buyers, so the wallets add ~150 bytes: 0150's rows
-- measured ~220 bytes with the index on 30 Oct, so ~46,000 rows a day at ~390 bytes ≈ 18 MB a day
-- written, ~250 MB held over the 14 days. Graduates
-- (about 2% of launches) are kept 30 days, so the smart list can look back that far.
--
-- ── 2. internal.smart_wallet and internal.smart_wallet_run ────────────────
--
-- Each night: a wallet among the first buyers of 2+ launches that graduated in the last 30 days, unless
-- its launches name 5+ different promoting X accounts (a sniper bot or an exchange buys everything). One
-- list per night, kept 30 days, so a replay uses the list AS IT STOOD before a launch: a wallet judged
-- smart on the very launch being scored would be the research's leak. The run row says the night was
-- judged and on how much: an empty list after a run is "nobody qualified", and no run row is "not judged".
--
-- What breaks if changed carelessly: `pool` and `graduated_seen_at`. The graduation test is "charted in a
-- pool other than the launch's"; a writer that stores another pool name here (the latest, say) makes
-- every coin look ungraduated and empties the smart list without an error.

alter table internal.launch_open
  add column pool              text check (pool is null or length(pool) between 1 and 64),
  add column dev_buy_sol       double precision check (dev_buy_sol is null or dev_buy_sol >= 0),
  add column block_share       real check (block_share is null or (block_share >= 0 and block_share <= 1)),
  add column first_buyers      text[] check (first_buyers is null or cardinality(first_buyers) <= 64),
  add column dev_sold          boolean,
  add column graduated_seen_at timestamptz;

create index launch_open_graduated_idx on internal.launch_open (launched_at) where graduated_seen_at is not null;

create table internal.smart_wallet (
  judged_on  date     not null,
  wallet     text     not null check (length(wallet) between 1 and 200),
  graduates  smallint not null check (graduates >= 1),
  accounts   smallint not null check (accounts >= 0),
  primary key (judged_on, wallet)
);

create table internal.smart_wallet_run (
  judged_on  date        primary key,
  ran_at     timestamptz not null,
  launches   integer     not null check (launches >= 0),
  graduates  integer     not null check (graduates >= 0),
  wallets    integer     not null check (wallets >= 0)
);

comment on column internal.launch_open.first_buyers is
  'The first-second buyers'' wallets in buying order, at most launchSignals.firstBuyersKept (0154). NULL: not recorded (before 0154).';
comment on column internal.launch_open.dev_sold is
  'The creator sold within launchSignals.devSellWindowMs of the launch. NULL: no opening buy seen, or before 0154; never "did not sell".';
comment on table internal.smart_wallet is
  'Each night''s smart wallets: first buyers of 2+ recent graduates, bots and exchanges (5+ promoting accounts) left out. Internal; never shown.';
comment on table internal.smart_wallet_run is
  'One row per night the smart wallet list was judged, with what it was judged on. No row: not judged that night.';
