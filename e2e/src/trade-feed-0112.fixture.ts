/**
 * THE TRADE FEED'S TABLES (0112), AS A TEST FIXTURE ONLY: the contract chainwatch's trade
 * subscriptions write to, created here so the one-coin e2e can run against them before 0112 is in
 * store/migrations. 0112 is another branch's migration; this file must never become one. When 0112
 * is merged its own file creates these tables and the test drops this fixture (`ifMissing`).
 *
 * What breaks if changed carelessly: a column that is not in the contract. The runner reads exactly
 * these names (store/src/repo/one-coin.ts); a fixture that grew its own would let the test pass on
 * columns the real migration does not have.
 */

export const TRADE_FEED_0112 = `
create table if not exists internal.coin_watch (
  address  text primary key,
  reason   text not null,
  since    timestamptz not null,
  until    timestamptz not null
);
create table if not exists internal.coin_trade_minute (
  address           text not null,
  minute            timestamptz not null,
  buys              integer not null,
  sells             integer not null,
  buyers            integer not null,
  new_buyers        integer not null,
  buy_sol           numeric not null,
  sell_sol          numeric not null,
  net_sol           numeric not null,
  creator_sold_sol  numeric not null default 0,
  last_mcap_sol     numeric,
  last_mcap_usd     numeric,
  primary key (address, minute)
);
create table if not exists internal.coin_trade_state (
  address         text primary key,
  unique_buyers   integer not null,
  peak_mcap_sol   numeric,
  last_mcap_sol   numeric,
  creator_sold    boolean not null default false,
  first_trade_at  timestamptz,
  last_trade_at   timestamptz,
  updated_at      timestamptz not null
);
`;
