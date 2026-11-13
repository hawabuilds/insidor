/**
 * GET /calls?window=week|month|all — INSIDOR'S OWN TRACK RECORD, the Feed tab's Calls list (the
 * owner, 2026-11-13: "not for traders, it's to see the calls Insidor has made and its x's"). Every
 * coin For You ever named as a post's one coin, with when we found the post, when the coin launched,
 * the price you could first have bought it at, and how high it went from there.
 *
 *   found     the post's first frame on For You (public.feed_post.first_shown_at) — the same moment
 *             the profile's "caught early" reads (catches.ts), so the two never disagree
 *   launched  the coin's mint (public.asset.minted_at, else the card's own copy)
 *   start     the market cap at the LATER of the two: a post found before its coin existed starts at
 *             the coin's launch price (nobody could buy earlier); one found after starts at the price
 *             when we found it
 *   peak      the highest hourly CLOSE from the start's hour on, never a wick (catches.ts says why)
 *   multiple  peak over start
 *
 * ★ OUR OWN CANDLES FIRST, MARKET READINGS ONLY WHERE WE HOLD NONE. Our candles (0144) are built from
 * the trades themselves; a market reading is a vendor's spot figure and has been wrong by 80x ($FEAR:
 * $13.8M read, about $160k traded). So a coin we chart is measured on our candles alone; a reading is
 * used only for a coin we never charted, or one whose pool trades in a token we do not price (364,
 * own-market.ts). A launch price needs a recording that began at the launch. An after-launch start is
 * the first minute candle within START_WINDOW of the moment; minute rows are kept a week, so an older
 * call starts at the CLOSE of the hour we found it in — a price traded after we found it, never the
 * hour's open, which could be a cheaper price from before. Anything else is `not_recorded`: the row
 * shows a dash with its reason, never a guessed number.
 *
 * ★ WORKED OUT IN THE BACKGROUND, KEPT IN MEMORY. One coin's numbers cost one query of about 50 ms on
 * the candle and reading indexes; the same for all calls in one statement ran 27 s and more, because
 * the planner cannot push a joined address into the candle view's two branches. So each coin is read
 * on its own, one at a time, and kept: a call found in the last RECENT_MS is read again every
 * REFRESH_MS (its peak may still be climbing), an older one every OLD_MS. The first request starts
 * the loop and is answered `counting` until the first pass is done; nothing runs in a process nobody
 * asks.
 *
 * ★ A PEAK NEEDS MONEY BEHIND IT (MIN_TRADED_SHARE). A thin pool can print any price; a row whose
 * trading since the start is too small for its peak is `thin_trading` — a dash and "Little money
 * traded" on the phone — rather than a 4,000x the owner already called a scam.
 *
 * ★ FACTS ONLY. Each number on a row is a price anyone could check on the coin's chart at that time.
 * The list is ordered by the multiple; a row with no multiple goes last, ordered by when it was found,
 * and still counts as a call, so the record's count includes the calls we cannot measure.
 *
 * What breaks if changed carelessly: the start for an early call. Using the price at the moment we
 * found the post would read a coin that did not exist yet; using the price when the CARD first showed
 * the coin (coin_shown) would make every early call look later than it was.
 */

import type { Db, Row } from './queries.ts';
import type { Logger } from './log.ts';

/** The quote tokens our candles are priced in: SOL and the two dollar stablecoins (own-market.ts PRICED_QUOTES). */
const PRICED_QUOTES = ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'];
/** What the launchpad mints every coin with: a coin with no reading of its own still has this supply. */
const LAUNCHPAD_SUPPLY = 1e9;
const LAUNCHPAD_SUFFIX = 'pump';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** How long after the start a first trade still counts as the start price. */
const START_WINDOW_MIN = 10;
const RECENT_MS = 3 * DAY;
const REFRESH_MS = 10 * MINUTE;
const OLD_MS = 6 * HOUR;
/**
 * A peak counts only when money moved behind it: the dollars traded from the start on must reach this
 * share of the peak's market cap. The owner's scam rule from the real-runner review (reports/
 * real-runners-2026-11-09.md): a scam's price is high but almost no money moves through it; every
 * one of the 26 runners the owner kept traded at least this share, and $mihao's $150M "peak" on $1M
 * traded did not. Below it the multiple is `thin_trading`, never shown as a run.
 */
const MIN_TRADED_SHARE = 0.15;
/** A multiple at or over this is one that "went 10x+" on the record's strip. */
const TEN_X = 10;
const WINDOWS = { week: 7 * DAY, month: 30 * DAY, all: null } as const;
export type CallsWindow = keyof typeof WINDOWS;

export function isCallsWindow(w: string | null): w is CallsWindow {
  return w !== null && Object.hasOwn(WINDOWS, w);
}

/**
 * Every coin For You named as a post's one coin, at its earliest post: that post's first frame, the
 * coin's mint, ticker and picture. Not its name: a coin's name is anything its creator typed, and the
 * phone refuses a whole reply that carries one of our vendors' names (one runner, $ANTS, is named after one); the row
 * shows the ticker alone. Only coins with an observed asset row (a coin we cannot place is left
 * out, as on the running strip), and never a withdrawn card.
 */
export const CALLS_SQL = `
select distinct on (f.payload #>> '{coins,coin,address}')
       f.payload #>> '{coins,coin,address}' as address,
       (extract(epoch from f.first_shown_at) * 1000)::bigint as found,
       (extract(epoch from coalesce(a.minted_at, to_timestamp((f.payload #>> '{coins,coin,mintedAt,at}')::float8 / 1000))) * 1000)::bigint as minted,
       coalesce(nullif(f.payload #>> '{coins,coin,ticker}', ''), a.symbol) as ticker,
       coalesce(nullif(f.payload #>> '{coins,coin,imageUrl}', ''), a.image_uri) as image_url
  from public.feed_post f
  join public.asset a on a.asset_key = 'solana:' || (f.payload #>> '{coins,coin,address}')
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload #>> '{coins,kind}' in ('one', 'matched')
   and coalesce(f.payload #>> '{coins,coin,address}', '') <> ''
   and a.origin = any($1::text[])
 order by f.payload #>> '{coins,coin,address}', f.first_shown_at`;

/**
 * One coin's prices: $1 address, $2 the start (ms), $3 true when found before launch, $4 the priced
 * quote tokens. Candle prices are per coin and come back with the supply to make them market caps;
 * the readings are market caps already and are read only where the candles cannot answer (a CASE
 * skips the subquery it does not take).
 */
export const CALL_PRICES_SQL = `
with ch as (
  select c.recorded_from, c.from_launch, (c.quote_mint is null or c.quote_mint = any($4::text[])) as priced
    from public.coin_chart c where c.address = $1
), s as (select to_timestamp($2::double precision / 1000) as at)
select
  (select m.market_cap_usd / m.price_usd from public.market_reading m
    where m.chain = 'solana' and m.address = $1 and m.market_cap_usd > 0 and m.price_usd > 0
    order by m.taken_at desc limit 1) as supply,
  (select priced from ch) as charted,
  case when (select priced and from_launch from ch) and $3::boolean then
         (select k.o from public.coin_candle k where k.address = $1 and k.minutes = 60 order by k.bucket asc limit 1)
       when (select priced and recorded_from <= s.at from ch) and not $3::boolean then
         coalesce(
           (select k.o from public.coin_candle k where k.address = $1 and k.minutes = 1
               and k.bucket >= date_trunc('minute', s.at) and k.bucket < s.at + interval '${START_WINDOW_MIN} minutes'
             order by k.bucket asc limit 1),
           (select k.c from public.coin_candle k where k.address = $1 and k.minutes = 60 and k.bucket = date_trunc('hour', s.at)))
  end as start_price,
  case when (select priced and recorded_from < s.at + interval '1 hour' from ch) then
         (select max(k.c) from public.coin_candle k where k.address = $1 and k.minutes = 60 and k.bucket >= date_trunc('hour', s.at))
  end as peak_price,
  case when (select priced and recorded_from < s.at + interval '1 hour' from ch) then
         (select sum(k.volume_usd) from public.coin_candle k where k.address = $1 and k.minutes = 60 and k.bucket >= date_trunc('hour', s.at))
  end as traded_usd,
  case when coalesce((select priced from ch), false) then null else
         (select m.market_cap_usd from public.market_reading m
           where m.chain = 'solana' and m.address = $1 and m.market_cap_usd > 0
             and m.taken_at >= s.at and m.taken_at < s.at + interval '${START_WINDOW_MIN} minutes'
           order by m.taken_at asc limit 1)
  end as start_reading,
  case when coalesce((select priced from ch), false) then null else
         (select max(m.market_cap_usd) from public.market_reading m
           where m.chain = 'solana' and m.address = $1 and m.market_cap_usd > 0 and m.taken_at >= s.at)
  end as peak_reading,
  case when coalesce((select priced from ch), false) then null else
         (select sum(h.v) from (select max(m.volume_1h_usd) as v from public.market_reading m
             where m.chain = 'solana' and m.address = $1 and m.taken_at >= s.at and m.volume_1h_usd >= 0
             group by date_trunc('hour', m.taken_at)) h)
  end as reading_traded_usd
from s`;

export type Measured = { readonly v: number } | { readonly v: null; readonly why: string };

export interface Call {
  readonly address: string;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  readonly foundAt: number;
  readonly mintedAt: number;
}

export interface CallRow extends Call {
  /** True when we found the post strictly before the coin launched. */
  readonly early: boolean;
  /** Market caps in dollars. */
  readonly startUsd: Measured;
  readonly peakUsd: Measured;
  readonly multiple: Measured;
}

export interface CallsBoard {
  readonly state: 'ready';
  readonly window: CallsWindow;
  readonly record: {
    readonly calls: number;
    readonly tenX: number;
    /** Calls found before their coin launched, over all calls; null when there are none. */
    readonly earlyShare: Measured;
    readonly best: Measured;
  };
  readonly rows: readonly CallRow[];
}

export type CallsReply = CallsBoard | { readonly state: 'counting' };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function callsFrom(rows: readonly Row[]): readonly Call[] {
  return rows.flatMap((r): Call[] => {
    const address = text(r['address']);
    const foundAt = num(r['found']);
    const mintedAt = num(r['minted']);
    if (address === null || foundAt === null || mintedAt === null) return [];
    const image = text(r['image_url']);
    return [{ address, ticker: text(r['ticker']), imageUrl: image !== null && image.startsWith('https://') ? image : null, foundAt, mintedAt }];
  });
}

/** When the call's price starts: the coin's launch for a post found before it, else the moment we found the post. */
export const startOf = (c: Call): number => Math.max(c.foundAt, c.mintedAt);
export const isEarly = (c: Call): boolean => c.foundAt < c.mintedAt;

/**
 * One call's numbers from CALL_PRICES_SQL's row. Candles need a supply: the coin's own (cap over
 * price on its newest reading), else the launchpad's fixed one for a launchpad coin; without either a
 * candle price is not a market cap and the call is `not_recorded`.
 */
export function measure(call: Call, row: Row | undefined): CallRow {
  const supplyRead = num(row?.['supply']);
  const supply = supplyRead !== null && supplyRead > 0 ? supplyRead : call.address.endsWith(LAUNCHPAD_SUFFIX) ? LAUNCHPAD_SUPPLY : null;
  const cap = (price: number | null) => (price !== null && price > 0 && supply !== null ? price * supply : null);
  const positive = (v: number | null) => (v !== null && v > 0 ? v : null);
  const charted = row?.['charted'] === true;
  const start = charted ? cap(num(row?.['start_price'])) : positive(num(row?.['start_reading']));
  const peakRaw = charted ? cap(num(row?.['peak_price'])) : positive(num(row?.['peak_reading']));
  /* The start is itself a price the coin traded at, so the peak is never under it. */
  const peak = start !== null && peakRaw !== null ? Math.max(start, peakRaw) : peakRaw;
  const traded = num(charted ? row?.['traded_usd'] : row?.['reading_traded_usd']);
  const missing = { v: null, why: 'not_recorded' } as const;
  const base = { ...call, early: isEarly(call), startUsd: start !== null ? { v: start } : missing };
  if (peak === null || start === null) return { ...base, peakUsd: peak !== null ? { v: peak } : missing, multiple: missing };
  /* A price nobody traded at size is not a run: with no volume known, or too little, it is not shown as one. */
  if (peak > start && (traded === null || traded < MIN_TRADED_SHARE * peak)) {
    const thin = { v: null, why: 'thin_trading' } as const;
    return { ...base, peakUsd: thin, multiple: thin };
  }
  return { ...base, peakUsd: { v: peak }, multiple: { v: peak / start } };
}

/** The record and the ranked rows for one window: the best multiple first, unmeasured calls last, newest first. */
export function board(rows: readonly CallRow[], window: CallsWindow, nowMs: number): CallsBoard {
  const span = WINDOWS[window];
  const inside = span === null ? rows : rows.filter((r) => r.foundAt >= nowMs - span);
  const ranked = [...inside].sort((a, b) => {
    const am = a.multiple.v;
    const bm = b.multiple.v;
    if (am !== null && bm !== null) return bm - am || a.address.localeCompare(b.address);
    if (am !== null) return -1;
    if (bm !== null) return 1;
    return b.foundAt - a.foundAt || a.address.localeCompare(b.address);
  });
  const measured = ranked.filter((r) => r.multiple.v !== null);
  const best = measured[0]?.multiple ?? null;
  return {
    state: 'ready',
    window,
    record: {
      calls: ranked.length,
      tenX: measured.filter((r) => r.multiple.v! >= TEN_X).length,
      earlyShare: ranked.length === 0 ? { v: null, why: 'no_calls' } : { v: ranked.filter((r) => r.early).length / ranked.length },
      best: best ?? { v: null, why: ranked.length === 0 ? 'no_calls' : 'not_recorded' },
    },
    rows: ranked,
  };
}

/** Whether a kept call is due another read: a recent call every REFRESH_MS, an older one every OLD_MS. */
export function due(call: Call, readAt: number | undefined, nowMs: number): boolean {
  if (readAt === undefined) return true;
  const every = nowMs - call.foundAt < RECENT_MS ? REFRESH_MS : OLD_MS;
  return nowMs - readAt >= every;
}

export interface CallsDeps {
  readonly db: Db;
  readonly log: Logger;
  readonly now?: () => number;
  readonly origins: readonly string[];
}

/**
 * The kept list and its loop. `read(window)` answers from memory; the first call starts a pass, and
 * each pass ends by scheduling the next REFRESH_MS later. A coin whose read fails keeps its last
 * numbers and is tried again next pass; one never read is left out until it is.
 */
export function createCalls(deps: CallsDeps) {
  const now = deps.now ?? Date.now;
  const kept = new Map<string, { readonly row: CallRow; readonly at: number }>();
  let listed: readonly Call[] = [];
  let ready = false;
  let running: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function pass(): Promise<void> {
    const started = now();
    listed = callsFrom(await deps.db.query(CALLS_SQL, [deps.origins]));
    let read = 0;
    let failed = 0;
    for (const call of listed) {
      if (!due(call, kept.get(call.address)?.at, now())) continue;
      try {
        const rows = await deps.db.query(CALL_PRICES_SQL, [call.address, startOf(call), isEarly(call), PRICED_QUOTES]);
        kept.set(call.address, { row: measure(call, rows[0]), at: now() });
        read += 1;
      } catch (e) {
        failed += 1;
        if (failed === 1) deps.log.info('calls: a coin could not be read; tried next pass', { address: call.address, err: e instanceof Error ? e.message : String(e) });
      }
    }
    ready = true;
    deps.log.info('calls: pass done', { calls: listed.length, read, failed, ms: now() - started });
  }

  function start(): void {
    if (running !== null) return;
    running = pass()
      .catch((e: unknown) => deps.log.error('calls: the list could not be read; tried next pass', { err: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        running = null;
        timer = setTimeout(start, REFRESH_MS);
        timer.unref?.();
      });
  }

  return {
    read(window: CallsWindow): CallsReply {
      if (timer === null && running === null) start();
      if (!ready) return { state: 'counting' };
      const rows = listed.flatMap((c) => {
        const k = kept.get(c.address);
        /* The names and times are the list's newest; the numbers the last read's. */
        return k === undefined ? [] : [{ ...k.row, ...c, early: isEarly(c) }];
      });
      return board(rows, window, now());
    },
    /** For tests: run one pass now and wait for it. */
    async passNow(): Promise<void> {
      await pass();
    },
  };
}
