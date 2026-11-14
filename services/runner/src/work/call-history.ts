/**
 * EVERY CALL'S PRICE HISTORY, KEPT CURRENT (the owner, 2026-11-14: "some of the coins' ATH was much
 * higher ... make sure it's accurate from now on"). The calls board (services/read calls.ts) reads a
 * call's peak from internal.coin_hour (0171); this step is what fills it, a few coins a pass.
 *
 * Which coins: the board's own list — every coin a For You card names as its post's one coin, and
 * every coin we sent a "coin launched" notification for (0172) — read in this order —
 *
 *   1. never read
 *   2. a failed or empty read, again after RETRY_MS
 *   3. a call told in the last RECENT_MS, again after RECENT_EVERY_MS (it may still be running)
 *   4. a call told in the last MONTH_MS, again after OLD_EVERY_MS
 *
 * and at most `perPass` a pass. A call older than MONTH_MS is not read again: its run is over, and
 * the vendor's hourly history reaches back only about six weeks, so a read would add nothing.
 *
 * ★ ONLY THE CALLS OUR OWN CANDLES MISS. A call chainwatch has charted from its notified hour, in a
 * token we price (0144), already has every trade in our candles, which the board reads beside this
 * history; reading the vendor for it would spend the minute for nothing. The first deploy (14 Nov)
 * found the lookups' instance spending every minute, so this step lives on what they leave: about a
 * quarter of new calls, a few coins an hour.
 *
 * ★ WHOLE HOURS FROM THE COIN'S OWN POOL, WITH THE MONEY. Each read is the last ~1,000 hours of the
 * pool the vendor ranks first, as open, high, low, close and dollars traded, and replaces the hours
 * it already holds (the newest hour was unfinished last time). The board needs the dollars as well
 * as the high: a top that almost nothing traded at is a print, not a price (calls.ts).
 *
 * ★ FREE READS, UNDER THE SOURCE'S OWN LIMIT. The market source is the runner's own on-chain instance,
 * whose per-minute count already covers the coin lookup and the older-coin reads; each coin here is
 * two requests (its pool, its hours), asked as background so it yields the minute. A refusal is
 * written as `failed` and read again after RETRY_MS — never as a coin with no history.
 *
 * What breaks if changed carelessly: the upsert key. A re-read that added hours instead of replacing
 * them would count a run's dollars twice and let a thin top pass the board's money check.
 */

import type { FullCandle, MarketData, Pool } from '@insidor/market-geckoterminal';

import { errorText, type Logger } from '../log.ts';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const RETRY_MS = HOUR_MS;
export const RECENT_MS = 7 * DAY_MS;
export const RECENT_EVERY_MS = 3 * HOUR_MS;
export const MONTH_MS = 30 * DAY_MS;
export const OLD_EVERY_MS = DAY_MS;
/**
 * Coins read a pass: two requests each, beside everything else the lookup's minute pays for. Five
 * reads the 813 calls of 14 November in a few hours, then keeps up with the recent ones easily.
 */
export const PER_PASS = 5;

export interface CallHistoryDb {
  query(sql: string, params?: readonly unknown[]): Promise<readonly Record<string, unknown>[]>;
}

export interface CallHistoryDeps {
  readonly db: CallHistoryDb;
  readonly market: Pick<MarketData, 'hourly'>;
  readonly log: Pick<Logger, 'info' | 'warn'>;
  readonly now: () => number;
  readonly perPass?: number;
  /** How long a failed read waits before it is owed again; RETRY_MS unless a one-off backfill says 0. */
  readonly retryMs?: number;
}

/**
 * The calls owed a read, most owed first: $1 now (ms), $2..$6 the windows above, $7 the limit. The
 * list is the board's (services/read calls.ts CALLS_SQL): a coin a For You card names as its post's
 * one coin, or one we sent a "coin launched" notification for (0172), with a notified moment.
 */
export const DUE_SQL = `
with calls as (
  select f.payload #>> '{coins,coin,address}' as address
    from public.feed_post f
   where f.feed_id = 'fyp' and f.withdrawn_at is null
     and f.payload #>> '{coins,kind}' in ('one', 'matched')
     and coalesce(f.payload #>> '{coins,coin,address}', '') <> ''
  union
  select address from public.coin_call_alert
), now_ as (select to_timestamp($1::double precision / 1000) as at)
select c.address, (extract(epoch from n.notified_at) * 1000)::bigint as notified,
       (extract(epoch from r.read_at) * 1000)::bigint as read_at, r.status
  from calls c
  join public.coin_notified n on n.address = c.address
  left join internal.coin_hour_read r on r.address = c.address, now_
 where not exists (
         select 1 from internal.chart_coin ch
          where ch.address = c.address
            and ch.recorded_from <= n.notified_at + interval '1 hour'
            and (ch.quote_mint is null or ch.quote_mint in ('So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB')))
   and (r.address is null
    or (r.status <> 'read' and r.read_at < now_.at - make_interval(secs => $2::double precision / 1000))
    or (n.notified_at > now_.at - make_interval(secs => $3::double precision / 1000) and r.read_at < now_.at - make_interval(secs => $4::double precision / 1000))
    or (n.notified_at > now_.at - make_interval(secs => $5::double precision / 1000) and r.read_at < now_.at - make_interval(secs => $6::double precision / 1000)))
 order by (r.address is null) desc, r.read_at asc nulls first, n.notified_at desc
 limit $7`;

/** One coin's hours, replacing any it already holds. Arrays, so a thousand hours are one statement. */
export const UPSERT_HOURS_SQL = `
insert into internal.coin_hour (address, bucket, o, h, l, c, volume_usd)
select $1, to_timestamp(t / 1000.0), o, h, l, c, v
  from unnest($2::double precision[], $3::double precision[], $4::double precision[], $5::double precision[], $6::double precision[], $7::double precision[]) as x(t, o, h, l, c, v)
on conflict (address, bucket) do update
  set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, volume_usd = excluded.volume_usd`;

export const UPSERT_READ_SQL = `
insert into internal.coin_hour_read (address, read_at, status, pool, ticker)
values ($1, to_timestamp($2::double precision / 1000), $3, $4, $5)
on conflict (address) do update
  set read_at = excluded.read_at, status = excluded.status,
      pool = coalesce(excluded.pool, internal.coin_hour_read.pool),
      ticker = coalesce(excluded.ticker, internal.coin_hour_read.ticker)`;

/** The coin's ticker as its pool names it: whichever side of the pool is the coin. */
export function tickerIn(pool: Pool | null, mint: string): string | null {
  const side = pool?.base?.address === mint ? pool.base : pool?.quote?.address === mint ? pool.quote : null;
  const s = side?.symbol?.trim().replace(/^\$/, '') ?? '';
  return s === '' ? null : s;
}

/** Hours worth keeping: positive prices and a high that is at least the hour's other prices. */
export function cleanHours(candles: readonly FullCandle[]): readonly FullCandle[] {
  return candles.filter((k) => k.o > 0 && k.l > 0 && k.c > 0 && k.h >= Math.max(k.o, k.c) && Number.isFinite(k.h));
}

/** Read one coin's hours and write them, or write why not. Returns what happened, for the pass's log. */
export async function readOne(deps: CallHistoryDeps, address: string): Promise<'read' | 'no_pool' | 'failed'> {
  const at = deps.now();
  try {
    const { pool, candles } = await deps.market.hourly(address, { background: true });
    if (pool === null) {
      await deps.db.query(UPSERT_READ_SQL, [address, at, 'no_pool', null, null]);
      return 'no_pool';
    }
    const hours = cleanHours(candles);
    if (hours.length > 0) {
      await deps.db.query(UPSERT_HOURS_SQL, [address, hours.map((k) => k.t), hours.map((k) => k.o), hours.map((k) => k.h), hours.map((k) => k.l), hours.map((k) => k.c), hours.map((k) => k.v)]);
    }
    await deps.db.query(UPSERT_READ_SQL, [address, at, hours.length > 0 ? 'read' : 'failed', pool.address, tickerIn(pool, address)]);
    return hours.length > 0 ? 'read' : 'failed';
  } catch (e) {
    deps.log.warn("a call's price history could not be read; tried again later", { coin: address, err: errorText(e) });
    await deps.db.query(UPSERT_READ_SQL, [address, at, 'failed', null, null]).catch(() => undefined);
    return 'failed';
  }
}

/** One pass: the most-owed calls, read one after another. */
export async function readCallHistory(deps: CallHistoryDeps): Promise<{ readonly read: number; readonly failed: number; readonly noPool: number }> {
  const due = await deps.db.query(DUE_SQL, [deps.now(), deps.retryMs ?? RETRY_MS, RECENT_MS, RECENT_EVERY_MS, MONTH_MS, OLD_EVERY_MS, deps.perPass ?? PER_PASS]);
  const tally = { read: 0, failed: 0, noPool: 0 };
  for (const row of due) {
    const address = typeof row['address'] === 'string' ? row['address'] : null;
    if (address === null) continue;
    const r = await readOne(deps, address);
    if (r === 'read') tally.read += 1;
    else if (r === 'no_pool') tally.noPool += 1;
    else tally.failed += 1;
  }
  if (due.length > 0) deps.log.info("calls' price history read", tally);
  return tally;
}
