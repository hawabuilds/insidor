/**
 * GET /calls/:window (week | month | all) — INSIDOR'S OWN TRACK RECORD, the Feed tab's Calls list
 * (the owner, 2026-11-13: "not for traders, it's to see the calls Insidor has made and its x's").
 * Every coin For You named as a post's one coin AND that we told people about, with the market cap we
 * told them and how high the coin went from there.
 *
 *   notified  the coin's moment in public.coin_notified (0143/0145/0158): the earlier of its first
 *             coin notification and the first card that showed it as a post's coin — the very moment
 *             the token chart's bubble marks, so the list and the chart never disagree
 *   start     the market cap that moment said (the owner, 2026-11-14: "it should be showing x's from
 *             when we notified users"), not a price from before anyone was told
 *   launched  the coin's mint (public.asset.minted_at, else the card's own copy), for "Notified 3m
 *             after launch"
 *   peak      the highest hourly CLOSE from the notified hour on, never a wick (catches.ts says why)
 *   multiple  peak over start
 *
 * A coin For You showed but never told anyone about has no notified moment and is not a call: it is
 * left off rather than measured from a moment nobody saw.
 *
 * ★ THE PEAK FROM OUR OWN CANDLES FIRST, MARKET READINGS ONLY WHERE WE HOLD NONE. Our candles (0144)
 * are built from the trades themselves; a market reading is a vendor's spot figure and has been wrong
 * by 80x ($FEAR: $13.8M read, about $160k traded). So a coin we chart is measured on our candles
 * alone; a reading is used only for a coin we never charted, or one whose pool trades in a token we
 * do not price (364, own-market.ts). The readings are read through public.coin_market_history
 * (0170): the read role is not granted market_reading itself.
 *
 * ★ A PEAK NEEDS MONEY BEHIND IT (MIN_TRADED_SHARE). A thin pool can print any price; a row whose
 * trading since it was notified is too small for its peak is `thin_trading` — a dash and "Little
 * money traded" on the phone — rather than a 4,000x the owner already called a scam.
 *
 * ★ WORKED OUT IN THE BACKGROUND, KEPT IN MEMORY. One coin's numbers cost one query of about 50 ms on
 * the candle and reading indexes; the same for all calls in one statement ran 27 s and more, because
 * the planner cannot push a joined address into the candle view's two branches. So each coin is read
 * on its own, one at a time, and kept: a call notified in the last RECENT_MS is read again every
 * REFRESH_MS (its peak may still be climbing), an older one every OLD_MS. The first request starts
 * the loop and is answered `counting` until the first pass is done; nothing runs in a process nobody
 * asks.
 *
 * ★ FACTS ONLY. The start is the cap we told people; the peak a price the coin traded at. The list is
 * ordered by the multiple; a row with no multiple goes last, newest first, and still counts as a call.
 *
 * What breaks if changed carelessly: the start. Measuring from when we found the post, or from the
 * coin's launch, credits Insidor with a run nobody it told could have caught.
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
/** The record's two bars: calls that at least doubled, and calls that went 10x or more. */
const TWO_X = 2;
const TEN_X = 10;
const WINDOWS = { week: 7 * DAY, month: 30 * DAY, all: null } as const;
export type CallsWindow = keyof typeof WINDOWS;

export function isCallsWindow(w: string | null): w is CallsWindow {
  return w !== null && Object.hasOwn(WINDOWS, w);
}

/**
 * Every coin For You named as a post's one coin and that has a notified moment: when, the cap said
 * then, the coin's mint, ticker and picture. Not its name: a coin's name is anything its creator
 * typed, and the phone refuses a whole reply that carries one of our vendors' names (one runner,
 * $ANTS, is named after one); the row shows the ticker alone. Only coins with an observed asset row
 * (a coin we cannot place is left out, as on the running strip), and never a withdrawn card.
 */
export const CALLS_SQL = `
select distinct on (f.payload #>> '{coins,coin,address}')
       f.payload #>> '{coins,coin,address}' as address,
       (extract(epoch from n.notified_at) * 1000)::bigint as notified,
       n.mc_usd as notified_cap,
       (extract(epoch from coalesce(a.minted_at, to_timestamp((f.payload #>> '{coins,coin,mintedAt,at}')::float8 / 1000))) * 1000)::bigint as minted,
       coalesce(nullif(f.payload #>> '{coins,coin,ticker}', ''), a.symbol) as ticker,
       coalesce(nullif(f.payload #>> '{coins,coin,imageUrl}', ''), a.image_uri) as image_url
  from public.feed_post f
  join public.asset a on a.asset_key = 'solana:' || (f.payload #>> '{coins,coin,address}')
  join public.coin_notified n on n.address = f.payload #>> '{coins,coin,address}'
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload #>> '{coins,kind}' in ('one', 'matched')
   and coalesce(f.payload #>> '{coins,coin,address}', '') <> ''
   and a.origin = any($1::text[])
 order by f.payload #>> '{coins,coin,address}', f.first_shown_at`;

/**
 * One coin's peak since it was notified: $1 address, $2 the notified moment (ms), $3 the priced quote
 * tokens. Candle prices are per coin and come back with the supply to make them market caps; the
 * readings are market caps already and are read only where the candles cannot answer (a CASE skips
 * the subquery it does not take).
 */
export const CALL_PRICES_SQL = `
with ch as (
  select c.recorded_from, (c.quote_mint is null or c.quote_mint = any($3::text[])) as priced
    from public.coin_chart c where c.address = $1
), s as (select to_timestamp($2::double precision / 1000) as at)
select
  (select m.market_cap_usd / m.price_usd from public.coin_market_history m
    where m.address = $1 and m.market_cap_usd > 0 and m.price_usd > 0
    order by m.taken_at desc limit 1) as supply,
  (select priced and recorded_from < s.at + interval '1 hour' from ch) as charted,
  case when (select priced and recorded_from < s.at + interval '1 hour' from ch) then
         (select max(k.c) from public.coin_candle k where k.address = $1 and k.minutes = 60 and k.bucket >= date_trunc('hour', s.at))
  end as peak_price,
  case when (select priced and recorded_from < s.at + interval '1 hour' from ch) then
         (select sum(k.volume_usd) from public.coin_candle k where k.address = $1 and k.minutes = 60 and k.bucket >= date_trunc('hour', s.at))
  end as traded_usd,
  case when coalesce((select priced and recorded_from < s.at + interval '1 hour' from ch), false) then null else
         (select max(m.market_cap_usd) from public.coin_market_history m
           where m.address = $1 and m.market_cap_usd > 0 and m.taken_at >= s.at)
  end as peak_reading,
  case when coalesce((select priced and recorded_from < s.at + interval '1 hour' from ch), false) then null else
         (select sum(h.v) from (select max(m.volume_1h_usd) as v from public.coin_market_history m
             where m.address = $1 and m.taken_at >= s.at and m.volume_1h_usd >= 0
             group by date_trunc('hour', m.taken_at)) h)
  end as reading_traded_usd
from s`;

export type Measured = { readonly v: number } | { readonly v: null; readonly why: string };

export interface Call {
  readonly address: string;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  /** When we told people, ms. */
  readonly notifiedAt: number;
  /** The market cap we told them, dollars; null when that moment carried none. */
  readonly notifiedCapUsd: number | null;
  readonly mintedAt: number;
}

export interface CallRow extends Call {
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
    readonly twoX: number;
    readonly tenX: number;
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
    const notifiedAt = num(r['notified']);
    const mintedAt = num(r['minted']);
    if (address === null || notifiedAt === null || mintedAt === null) return [];
    const cap = num(r['notified_cap']);
    const image = text(r['image_url']);
    return [{ address, ticker: text(r['ticker']), imageUrl: image !== null && image.startsWith('https://') ? image : null, notifiedAt, notifiedCapUsd: cap !== null && cap > 0 ? cap : null, mintedAt }];
  });
}

/**
 * One call's numbers: the start is the cap we told people; the peak comes from CALL_PRICES_SQL's row.
 * Candles need a supply: the coin's own (cap over price on its newest reading), else the launchpad's
 * fixed one for a launchpad coin; without either a candle price is not a market cap and the peak is
 * `not_recorded`.
 */
export function measure(call: Call, row: Row | undefined): CallRow {
  const supplyRead = num(row?.['supply']);
  const supply = supplyRead !== null && supplyRead > 0 ? supplyRead : call.address.endsWith(LAUNCHPAD_SUFFIX) ? LAUNCHPAD_SUPPLY : null;
  const cap = (price: number | null) => (price !== null && price > 0 && supply !== null ? price * supply : null);
  const positive = (v: number | null) => (v !== null && v > 0 ? v : null);
  const charted = row?.['charted'] === true;
  const start = call.notifiedCapUsd;
  const peakRaw = charted ? cap(num(row?.['peak_price'])) : positive(num(row?.['peak_reading']));
  /* The cap we told people was itself a price the coin traded at, so the peak is never under it. */
  const peak = start !== null && peakRaw !== null ? Math.max(start, peakRaw) : peakRaw;
  const traded = num(charted ? row?.['traded_usd'] : row?.['reading_traded_usd']);
  const missing = { v: null, why: 'not_recorded' } as const;
  const base = { ...call, startUsd: start !== null ? { v: start } : missing };
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
  const inside = span === null ? rows : rows.filter((r) => r.notifiedAt >= nowMs - span);
  const ranked = [...inside].sort((a, b) => {
    const am = a.multiple.v;
    const bm = b.multiple.v;
    if (am !== null && bm !== null) return bm - am || a.address.localeCompare(b.address);
    if (am !== null) return -1;
    if (bm !== null) return 1;
    return b.notifiedAt - a.notifiedAt || a.address.localeCompare(b.address);
  });
  const multiples = ranked.flatMap((r) => (r.multiple.v !== null ? [r.multiple.v] : []));
  return {
    state: 'ready',
    window,
    record: {
      calls: ranked.length,
      twoX: multiples.filter((m) => m >= TWO_X).length,
      tenX: multiples.filter((m) => m >= TEN_X).length,
      best: multiples.length > 0 ? { v: multiples[0]! } : { v: null, why: ranked.length === 0 ? 'no_calls' : 'not_recorded' },
    },
    rows: ranked,
  };
}

/** Whether a kept call is due another read: a recent call every REFRESH_MS, an older one every OLD_MS. */
export function due(call: Call, readAt: number | undefined, nowMs: number): boolean {
  if (readAt === undefined) return true;
  const every = nowMs - call.notifiedAt < RECENT_MS ? REFRESH_MS : OLD_MS;
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
  const kept = new Map<string, { readonly row: CallRow; readonly at: number; readonly notifiedAt: number }>();
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
      const had = kept.get(call.address);
      /* A notified moment that moved (an earlier notification landed) is a different call: read again. */
      if (had !== undefined && had.notifiedAt === call.notifiedAt && !due(call, had.at, now())) continue;
      try {
        const rows = await deps.db.query(CALL_PRICES_SQL, [call.address, call.notifiedAt, PRICED_QUOTES]);
        kept.set(call.address, { row: measure(call, rows[0]), at: now(), notifiedAt: call.notifiedAt });
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
        /* The ticker and picture are the list's newest; the numbers the last read's. */
        return k === undefined ? [] : [{ ...k.row, ticker: c.ticker, imageUrl: c.imageUrl }];
      });
      return board(rows, window, now());
    },
    /** For tests: run one pass now and wait for it. */
    async passNow(): Promise<void> {
      await pass();
    },
  };
}
