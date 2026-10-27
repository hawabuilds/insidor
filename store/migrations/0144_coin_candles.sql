-- 0144_coin_candles.sql
--
-- OUR OWN PRICE CHART FOR A COIN, BUILT FROM THE TRADE STREAM WE ALREADY HOLD (the owner, 2026-10-27:
-- "build our own candles" — a token page waited two to six seconds on the market source's first read,
-- and sometimes timed out). Chainwatch holds the one connection to the trade relay, which carries every
-- trade on the launchpad's curve and on every pool a coin trades in after it; it now folds each trade
-- of a coin worth charting into a one-minute and a one-hour candle in dollars and writes them here.
-- The read service draws the token chart from these rows and asks the market source only for a coin
-- whose history began before we were recording it.
--
-- ★ A CANDLE IS WRITTEN AS DELTAS, MERGED HERE. Each flush carries only the trades since the last one
-- for a bucket: counts and dollars are added, high and low widened, and the open (close) replaced only
-- by a trade earlier (later) in the bucket than the one already kept, by `o_ms` / `c_ms`, the
-- milliseconds into the bucket of that trade. So a restart in the middle of a minute adds the new
-- process's trades to what the old one wrote instead of replacing them, and the two halves of the
-- minute are one candle.
--
-- ★ TWO TABLES, NOT ONE AND A ROLLUP JOB. Every trade is added to its minute and to its hour in the
-- same flush, so the hourly table is complete from the first trade and never waits for a job. The
-- minute table is kept for `retention` (chainwatch deletes rows older than that, hence its delete
-- grant below — the schema's defaults give insidor_internal none); the hourly one is kept. Views of
-- five or fifteen minutes are built from minutes, views of four hours or a day from hours.
--
-- ★ `recorded_from` AND `from_launch` SAY HOW MUCH OF A COIN'S LIFE WE HOLD. A coin launched before we
-- recorded it, or trading quietly before chainwatch last started, has candles only from
-- `recorded_from`; the read service asks the market source for such a coin's longer views rather than
-- draw a chart that begins halfway through its life. `from_launch` is true only when the recording
-- began with the coin's own launch.
--
-- A coin is a small integer here, not its address, because the address would be half of every row.
--
-- What breaks if changed carelessly: `security_invoker` on the two views. Set, they would run as
-- insidor_app and fail on internal; the default (off) is the point. And `o_ms` / `c_ms`: without them
-- a merge cannot tell which trade opened a bucket, and a restart would draw a wrong open.

create table internal.chart_coin (
  id            integer generated always as identity primary key,
  address       text not null unique,
  -- The first trade of this coin held, and whether that was its launch.
  recorded_from timestamptz not null,
  from_launch   boolean not null,
  last_trade_at timestamptz not null,
  -- The pool of its latest trade, as the relay names it ('pump' is the launchpad's curve), the
  -- pool's account, and the token it is priced in: what the token page says the chart is.
  pool          text,
  pool_address  text,
  quote_mint    text
);

create table internal.coin_candle_1m (
  coin_id    integer not null references internal.chart_coin (id) on delete cascade,
  bucket     timestamptz not null,
  o          double precision not null,
  h          double precision not null,
  l          double precision not null,
  c          double precision not null,
  volume_usd double precision not null,
  buys       integer not null,
  sells      integer not null,
  o_ms       integer not null,
  c_ms       integer not null,
  primary key (coin_id, bucket)
);

create table internal.coin_candle_1h (like internal.coin_candle_1m including all);
alter table internal.coin_candle_1h
  add constraint coin_candle_1h_coin_fk foreign key (coin_id) references internal.chart_coin (id) on delete cascade;

-- The retention delete reads minutes by age across every coin.
create index coin_candle_1m_bucket_idx on internal.coin_candle_1m (bucket);

grant delete on internal.coin_candle_1m to insidor_internal;

create view public.coin_chart as
select address, recorded_from, from_launch, last_trade_at, pool, pool_address, quote_mint
  from internal.chart_coin;

comment on view public.coin_chart is
  'Each coin we draw our own chart for (0144): from when we hold its trades, whether from its launch, and the pool of its latest trade.';

create view public.coin_candle as
select c.address, 1 as minutes, m.bucket, m.o, m.h, m.l, m.c, m.volume_usd, m.buys + m.sells as trades
  from internal.coin_candle_1m m join internal.chart_coin c on c.id = m.coin_id
union all
select c.address, 60 as minutes, h.bucket, h.o, h.h, h.l, h.c, h.volume_usd, h.buys + h.sells as trades
  from internal.coin_candle_1h h join internal.chart_coin c on c.id = h.coin_id;

comment on view public.coin_candle is
  'Our own candles in dollars (0144), by the minute (kept a week) and by the hour; built from the trade stream. Runs as its owner.';

grant select on public.coin_chart to insidor_app;
grant select on public.coin_candle to insidor_app;
