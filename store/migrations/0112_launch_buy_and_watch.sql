-- 0112_launch_buy_and_watch.sql
--
-- THE CREATOR'S OPENING BUY ON EACH COIN, AND THE TABLES FOR A WATCHED COIN'S TRADES.
--
-- ── 1. THE OPENING BUY, on public.asset ──────────────────────────────────
--
-- The launch frame the mint stream receives already carries what the creator bought in the
-- same transaction that made the coin: the tokens, the SOL paid, and the coin's market cap in
-- SOL right after. Until now chainwatch dropped all three, so "the creator sold" could never be
-- measured against what the creator held. They are facts about the world and they sit on the
-- coin's own row, next to `creator`.
--
--   creator_buy_tokens  tokens the creator received in the launch transaction (whole tokens,
--                       not raw units). 0 is a real answer: a launch with no opening buy.
--   creator_buy_sol     SOL the creator paid for them. 0 likewise.
--   launch_mcap_sol     the coin's market cap in SOL right after that buy.
--
-- NULL on all three means NOT RECORDED: a coin added by a search or a listing (origin
-- 'backfill'), a coin from before this migration, or a frame that did not carry the field. It
-- never means the creator bought nothing, and a reader that turns NULL into 0 invents a
-- creator who held no tokens and so could never have sold.
--
-- ── 2. WATCHED COINS AND THEIR TRADES, in internal ───────────────────────
--
-- internal.coin_watch is the list of coins someone wants trades for: the post-to-one-coin
-- matcher marks its candidates here (reason, since, until). internal.coin_trade_minute and
-- internal.coin_trade_state are where per-minute trade buckets and each coin's running state
-- would be kept.
--
-- ★ NOTHING FILLS THE TWO TRADE TABLES YET, AND AN EMPTY ONE IS NOT A QUIET COIN. The only
-- per-coin trade feed on the relay we already use is metered (0.01 SOL per 10,000 trades, from
-- an account-linked key; pumpportal.fun/fees, read 2026-10-19), so the writer was not built
-- without the owner's word. Until it is, a coin with no rows here was NOT MEASURED: a rule that
-- reads "no rows" as "no buyers" or "creator did not sell" is scoring an outage as zero.
-- The tables exist now so the matcher can be written against their final shape.
--
-- Retention, when filled: minute buckets 7 days (a pruning job deletes older rows); state rows
-- live as long as their coin is of interest. A bucket row is ~120 bytes with its index share.
--
-- What breaks if changed carelessly: the trade tables' columns are the contract the matcher is
-- built against in parallel (internal.coin_watch is written by it). Renaming a column breaks a
-- reader in another service with no compile error, because SQL is strings.

alter table public.asset
  add column creator_buy_tokens numeric check (creator_buy_tokens is null or creator_buy_tokens >= 0),
  add column creator_buy_sol    numeric check (creator_buy_sol is null or creator_buy_sol >= 0),
  add column launch_mcap_sol    numeric check (launch_mcap_sol is null or launch_mcap_sol > 0);

comment on column public.asset.creator_buy_tokens is
  'Tokens the creator received in the launch transaction, from the launch frame (0112). 0: no opening buy. NULL: not recorded (a backfilled coin, or older than 0112), never "bought nothing".';
comment on column public.asset.creator_buy_sol is
  'SOL the creator paid in the launch transaction (0112). NULL: not recorded, never zero.';
comment on column public.asset.launch_mcap_sol is
  'The coin''s market cap in SOL right after the creator''s opening buy, from the launch frame (0112). NULL: not recorded.';

create table internal.coin_watch (
  address  text primary key check (length(address) between 32 and 64),
  -- Why the coin is watched, in the writer's words ('candidate', 'name_match', ...). Free text:
  -- it is a note for whoever reads the table, not a vocabulary anything branches on.
  reason   text not null check (length(reason) between 1 and 200),
  since    timestamptz not null,
  -- When to stop. NULL: the reader's default (launch + 60 minutes).
  until    timestamptz,
  constraint watch_ends_after_it_starts check (until is null or until > since)
);

create index coin_watch_until_idx on internal.coin_watch (until);

comment on table internal.coin_watch is
  'Coins someone wants live trades for (0112): the post-to-one-coin matcher''s candidates. until NULL means launch + 60 min. No trade writer exists yet (the per-coin trade feed is metered), so being listed here does not mean trades are being recorded.';

create table internal.coin_trade_minute (
  address          text not null,
  minute           timestamptz not null check (date_trunc('minute', minute) = minute),
  buys             integer not null check (buys >= 0),
  sells            integer not null check (sells >= 0),
  -- Distinct buying wallets in this minute, and those that had never bought this coin before.
  buyers           integer not null check (buyers >= 0 and buyers <= buys),
  new_buyers       integer not null check (new_buyers >= 0 and new_buyers <= buyers),
  buy_sol          numeric not null check (buy_sol >= 0),
  sell_sol         numeric not null check (sell_sol >= 0),
  net_sol          numeric not null,
  creator_sold_sol numeric not null check (creator_sold_sol >= 0),
  last_mcap_sol    numeric not null check (last_mcap_sol > 0),
  -- NULL: no SOL price was at hand when the bucket was written. Never 0.
  last_mcap_usd    numeric check (last_mcap_usd is null or last_mcap_usd > 0),
  primary key (address, minute)
);

create index coin_trade_minute_minute_idx on internal.coin_trade_minute (minute);

comment on table internal.coin_trade_minute is
  'One watched coin''s trades in one minute (0112). Kept 7 days. A minute with no row was not measured or had no trade; which one is told by internal.coin_trade_state and coin_watch, never by assuming zero. Empty until the per-coin trade feed is approved (it is metered).';

create table internal.coin_trade_state (
  address        text primary key,
  unique_buyers  integer not null check (unique_buyers >= 0),
  peak_mcap_sol  numeric not null check (peak_mcap_sol > 0),
  last_mcap_sol  numeric not null check (last_mcap_sol > 0),
  creator_sold   boolean not null,
  first_trade_at timestamptz not null,
  last_trade_at  timestamptz not null,
  updated_at     timestamptz not null,
  constraint trades_in_order check (last_trade_at >= first_trade_at)
);

comment on table internal.coin_trade_state is
  'A watched coin''s running trade state (0112), kept current by the trade writer. No row: not measured, never "no buyers". Empty until the per-coin trade feed is approved (it is metered).';
