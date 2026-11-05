-- 0167_auto_buy.sql
--
-- AUTO BUY ON A WATCHED POST (the owner, 2026-11-05): a person who watches a post with no coin yet
-- sets how much to buy when its coin starts running, and Insidor buys it for them from their own
-- wallet (services/notify auto-buy.ts). Owner-only while the owner tests it (Policy.notify.autoBuy).
--
-- Two tables, both the person's own and both in `people`, like people.post_watch (0068):
--
--   people.auto_buy        one row per person and post: the settings the sheet saved.
--     wallet          the person's embedded wallet the buys come from, as their sign-in reported it
--                     when they saved; a buy never comes from any other wallet.
--     lamports        each buy, in lamports (1 SOL = 1e9). Never a float.
--     max_cap_usd     skip a coin already above this market cap when it starts running.
--     pvp_coins       how many coins racing for the post to buy, each at `lamports`; 1 is no PvP.
--     speed           the priority fee the buy is sent with: normal, fast or turbo.
--     slippage_bps    the most the price may move against the buy; the trade service's own cap
--                     still holds over it.
--     active_until    after this, nothing is bought.
--
--   people.auto_buy_fill   one row per person, post and coin: the claim on a buy, then its outcome.
--     ★ THE PRIMARY KEY IS WHAT MAKES IT ONE BUY PER COIN. The buyer inserts the claim BEFORE it
--     builds anything; a second pass, a restart or a second process finds the row and buys
--     nothing. A claim is never deleted or reset.
--     outcome         claimed (being bought), sent, skipped (with its reason) or failed (with its
--                     reason). `dry` is a buy that was built and simulated but not sent (dry run).
--
-- What breaks if changed carelessly: removing the fill table's primary key, or deleting a claim,
-- can buy the same coin twice with real money.

create table people.auto_buy (
  user_id       text not null references people.profile(user_id) on delete cascade,
  item_id       text not null,
  wallet        text not null,
  lamports      bigint not null check (lamports > 0),
  max_cap_usd   numeric check (max_cap_usd is null or max_cap_usd > 0),
  pvp_coins     smallint not null default 1 check (pvp_coins between 1 and 4),
  speed         text not null default 'fast' check (speed in ('normal', 'fast', 'turbo')),
  slippage_bps  integer not null check (slippage_bps between 1 and 5000),
  active_until  timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index auto_buy_live_idx on people.auto_buy (item_id, active_until);

create table people.auto_buy_fill (
  user_id     text not null,
  item_id     text not null,
  mint        text not null,
  outcome     text not null check (outcome in ('claimed', 'sent', 'skipped', 'failed', 'dry')),
  reason      text,
  lamports    bigint,
  cap_usd     numeric,
  tx          text,
  claimed_at  timestamptz not null default now(),
  settled_at  timestamptz,
  primary key (user_id, item_id, mint)
);

grant select, insert, update, delete on people.auto_buy to insidor_people;
grant select, insert, update on people.auto_buy_fill to insidor_people;
