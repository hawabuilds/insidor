/**
 * OUR OWN CANDLES (0144): what chainwatch's charts write — each charted coin's row, its one-minute and
 * one-hour candles as deltas — and the two reads it needs on its way: the coins charted before it
 * started, and the coins the product is watching (charted on their first trade however quiet).
 *
 * Separate from trade-feed.ts because its writes have the opposite shape: those rows are written
 * whole and replace what was there; these are deltas the table MERGES (counts added, high and low
 * widened, the open and close kept by which trade was earliest and latest in the bucket). So two
 * processes, or one process either side of a restart, add up instead of overwriting each other.
 *
 * What breaks if changed carelessly: the merge's open and close. `o_ms` / `c_ms` are the milliseconds
 * into the bucket of the trade that set them; compare anything else and a late delta rewrites the
 * open of a minute that already had one.
 */

import type { Db } from '../client.ts';

export interface ChartCoinWrite {
  readonly address: string;
  readonly recordedFromMs: number;
  readonly fromLaunch: boolean;
  readonly lastTradeMs: number;
  readonly pool: string;
  readonly poolAddress: string | null;
  readonly quoteMint: string;
}

export interface CandleDeltaWrite {
  readonly address: string;
  readonly bucketMs: number;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly oMs: number;
  readonly cMs: number;
  readonly volumeUsd: number;
  readonly buys: number;
  readonly sells: number;
}

export interface ChartWrite {
  readonly coins: readonly ChartCoinWrite[];
  readonly minutes: readonly CandleDeltaWrite[];
  readonly hours: readonly CandleDeltaWrite[];
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** How long a watched coin, or a picked one, stays charted on its first trade. */
const LISTED_DAYS = 2;
const LISTED_MS = LISTED_DAYS * 86_400_000;
/**
 * How far behind the newest `since` / `updated_at` held each catch-up of `listed` reaches. Both are
 * stamped from their writer's clock (the runner's), so a row written just after a read can carry an
 * instant just before it; the overlap re-reads those few rows rather than missing one.
 */
const LISTED_OVERLAP_MS = 5 * 60_000;

/** `listed`'s held rows: see there. */
interface ListedState {
  readonly watchSince: Map<string, number>;
  readonly picks: Map<string, { readonly address: string | null; readonly picked: boolean; readonly atMs: number }>;
  watchNewestMs: number | null;
  pickNewestMs: number | null;
}

export class PgChartRepo {
  readonly #db: Db;
  readonly #listed: ListedState = { watchSince: new Map(), picks: new Map(), watchNewestMs: null, pickNewestMs: null };

  constructor(db: Db) {
    this.#db = db;
  }

  async charted(sinceMs: number): Promise<readonly { readonly address: string; readonly lastTradeMs: number }[]> {
    const rows = await this.#db.query<{ address: string; last_trade_at: string }>(
      `select address, last_trade_at from internal.chart_coin where last_trade_at >= $1`,
      [iso(sinceMs)],
    );
    return rows.map((r) => ({ address: r.address, lastTradeMs: new Date(r.last_trade_at).getTime() }));
  }

  /**
   * The coins watched since, or picked for a post written since, `LISTED_DAYS` before `nowMs`.
   *
   * ★ HELD AND CAUGHT UP, NOT READ WHOLE EACH MINUTE. Every minute's read returned ~15,000 addresses,
   * ~1 GB a day of the database's egress on 29 Oct 2026, nearly all of them the minute before's. Now
   * the watch rows and the pick rows of the window are read once, then only those whose `since` or
   * `updated_at` is at or after the newest held (less the overlap). A watch row's `since` is set once
   * (0114: a re-watch moves only `until`), and every pick write stamps `updated_at` — a pick that
   * stops being "picked" comes back with its new outcome and leaves the set — so the held rows are the
   * table's; rows that age out of the window are dropped here. Nothing deletes from either table.
   */
  async listed(nowMs: number): Promise<ReadonlySet<string>> {
    const st = this.#listed;
    const from = nowMs - LISTED_MS;
    const after = (newest: number | null) => iso(Math.max(from, newest === null ? from : newest - LISTED_OVERLAP_MS));
    const watch = await this.#db.query<{ address: string; at: number | string }>(
      `select address, extract(epoch from since)::float8 * 1000 as at from internal.coin_watch where since >= $1`,
      [after(st.watchNewestMs)],
    );
    const picks = await this.#db.query<{ item_id: string; address: string | null; picked: boolean; at: number | string }>(
      `select item_id, address, outcome = 'picked' as picked, extract(epoch from updated_at)::float8 * 1000 as at from internal.post_coin_pick where updated_at >= $1`,
      [after(st.pickNewestMs)],
    );
    for (const r of watch) {
      const at = Number(r.at);
      st.watchSince.set(r.address, at);
      if (st.watchNewestMs === null || at > st.watchNewestMs) st.watchNewestMs = at;
    }
    for (const r of picks) {
      const at = Number(r.at);
      st.picks.set(r.item_id, { address: r.address, picked: r.picked, atMs: at });
      if (st.pickNewestMs === null || at > st.pickNewestMs) st.pickNewestMs = at;
    }
    for (const [a, at] of st.watchSince) if (at < from) st.watchSince.delete(a);
    for (const [id, p] of st.picks) if (p.atMs < from) st.picks.delete(id);
    const out = new Set<string>(st.watchSince.keys());
    for (const p of st.picks.values()) if (p.picked) out.add(p.address as string);
    return out;
  }

  async write(w: ChartWrite): Promise<void> {
    if (w.coins.length > 0) {
      const c = w.coins;
      await this.#db.query(
        `insert into internal.chart_coin (address, recorded_from, from_launch, last_trade_at, pool, pool_address, quote_mint)
         select * from unnest($1::text[], $2::timestamptz[], $3::boolean[], $4::timestamptz[], $5::text[], $6::text[], $7::text[])
         on conflict (address) do update set
           from_launch   = case when excluded.recorded_from < chart_coin.recorded_from then excluded.from_launch else chart_coin.from_launch end,
           recorded_from = least(chart_coin.recorded_from, excluded.recorded_from),
           pool          = case when excluded.last_trade_at >= chart_coin.last_trade_at then excluded.pool else chart_coin.pool end,
           pool_address  = case when excluded.last_trade_at >= chart_coin.last_trade_at then excluded.pool_address else chart_coin.pool_address end,
           quote_mint    = case when excluded.last_trade_at >= chart_coin.last_trade_at then excluded.quote_mint else chart_coin.quote_mint end,
           last_trade_at = greatest(chart_coin.last_trade_at, excluded.last_trade_at)`,
        [c.map((x) => x.address), c.map((x) => iso(x.recordedFromMs)), c.map((x) => x.fromLaunch), c.map((x) => iso(x.lastTradeMs)), c.map((x) => x.pool), c.map((x) => x.poolAddress), c.map((x) => x.quoteMint)],
      );
    }
    await this.#candles('internal.coin_candle_1m', w.minutes);
    await this.#candles('internal.coin_candle_1h', w.hours);
  }

  async #candles(table: 'internal.coin_candle_1m' | 'internal.coin_candle_1h', d: readonly CandleDeltaWrite[]): Promise<void> {
    if (d.length === 0) return;
    await this.#db.query(
      `insert into ${table} as t (coin_id, bucket, o, h, l, c, volume_usd, buys, sells, o_ms, c_ms)
       select cc.id, x.b, x.o, x.h, x.l, x.c, x.v, x.bu, x.se, x.om, x.cm
         from unnest($1::text[], $2::timestamptz[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::int[], $9::int[], $10::int[], $11::int[])
           as x(a, b, o, h, l, c, v, bu, se, om, cm)
         join internal.chart_coin cc on cc.address = x.a
       on conflict (coin_id, bucket) do update set
         o = case when excluded.o_ms < t.o_ms then excluded.o else t.o end,
         o_ms = least(t.o_ms, excluded.o_ms),
         c = case when excluded.c_ms >= t.c_ms then excluded.c else t.c end,
         c_ms = greatest(t.c_ms, excluded.c_ms),
         h = greatest(t.h, excluded.h),
         l = least(t.l, excluded.l),
         volume_usd = t.volume_usd + excluded.volume_usd,
         buys = t.buys + excluded.buys,
         sells = t.sells + excluded.sells`,
      [d.map((x) => x.address), d.map((x) => iso(x.bucketMs)), d.map((x) => x.o), d.map((x) => x.h), d.map((x) => x.l), d.map((x) => x.c), d.map((x) => x.volumeUsd), d.map((x) => x.buys), d.map((x) => x.sells), d.map((x) => Math.round(x.oMs)), d.map((x) => Math.round(x.cMs))],
    );
  }

  async prune(beforeMs: number, limit: number): Promise<number> {
    const rows = await this.#db.query<{ n: string }>(
      `with gone as (
         delete from internal.coin_candle_1m
          where ctid = any (array(select ctid from internal.coin_candle_1m where bucket < $1 limit $2))
         returning 1)
       select count(*)::text as n from gone`,
      [iso(beforeMs), limit],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Each launch's first second (0150, chainwatch launch-open.ts): one row a coin, the first reading kept
   * (on conflict do nothing), so a restart that sees a launch again never overwrites it.
   */
  async writeOpens(rows: readonly { readonly address: string; readonly launchedAtMs: number; readonly buyers: number; readonly buys: number; readonly devBuyUsd: number | null }[]): Promise<void> {
    if (rows.length === 0) return;
    await this.#db.query(
      `insert into internal.launch_open (address, launched_at, buyers, buys, dev_buy_usd)
       select * from unnest($1::text[], $2::timestamptz[], $3::int[], $4::int[], $5::float8[])
       on conflict (address) do nothing`,
      [rows.map((r) => r.address), rows.map((r) => iso(r.launchedAtMs)), rows.map((r) => r.buyers), rows.map((r) => r.buys), rows.map((r) => r.devBuyUsd)],
    );
  }

  /** Deletes the first-second rows of launches before `beforeMs`; how many went. */
  async pruneOpens(beforeMs: number): Promise<number> {
    const rows = await this.#db.query<{ n: string }>(
      `with gone as (delete from internal.launch_open where launched_at < $1 returning 1) select count(*)::text as n from gone`,
      [iso(beforeMs)],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
