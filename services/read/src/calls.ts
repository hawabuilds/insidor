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
 *   peak      the highest price the coin traded at from the notified hour on: each hour's HIGH where
 *             that hour traded real money (SPIKE_SHARE), its close where it did not
 *   multiple  peak over start
 *
 * A coin For You showed but never told anyone about has no notified moment and is not a call: it is
 * left off rather than measured from a moment nobody saw.
 *
 * ★ THE PEAK FROM THE WHOLE HISTORY (the owner, 2026-11-14: "some of the coins' ATH was much
 * higher ... make sure it's accurate from now on"). Our own candles (0144) begin when chainwatch first
 * charted a coin — after the run for a quarter of last week's calls, and never before 27 October — so
 * they alone missed most runs ($Kim 1.0x against a $15.6M top). Every call's hourly history from its
 * own pool is now kept in public.coin_hour_history (0171; the runner's work/call-history.ts), and the
 * peak is the higher of that and our candles. Market readings answer only for a coin neither covers:
 * a vendor's spot figure has been wrong by 80x ($FEAR). They are read through
 * public.coin_market_history (0170): the read role is not granted market_reading itself.
 *
 * ★ A HIGH NEEDS MONEY IN ITS HOUR (SPIKE_SHARE). A single thin print can put any high on an hour:
 * $DICTATOR's history holds a $329M high on a $16K coin. An hour's high counts only when that hour
 * traded at least SPIKE_SHARE of the high's market cap in dollars; otherwise the hour counts at its
 * close, a price the coin held.
 *
 * ★ THE CAP WE TOLD PEOPLE, CHECKED AGAINST THE CHART. The notified cap is the market reading of the
 * moment, and a reading can be wrong: $CHUNGUS's card read $42K in an hour its pool never traded
 * above half that. A told cap above twice that hour's high is not a price the coin traded at; that
 * call starts at the hour's HIGH instead — the most anyone could have paid then, so the multiple can
 * only understate (the close can be a dump at the hour's end). ($PUMPKIN's $1.49M alert was a real
 * price: its pool reached $1.5M in its first hour on $43K traded, and it stays "little traded".)
 * And a call whose only moment is an alert from before 27 October 18:35 UTC
 * (CARD_MOMENTS_FROM, when 0145 began writing card moments) starts when its card first showed the coin,
 * if that was earlier and the coin existed by then: the post's first For You frame, or the coin's
 * match to the post when that came later (0173; 114 of 118 were matched within five minutes of the
 * frame). $FTR was on For You a minute after launch, its first alert five hours later. That start is
 * priced from the first reading after it, checked the same way.
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
/**
 * An hour's high counts only when that hour traded at least this share of the high's market cap in
 * dollars. Chosen on the backfill of 14 November: it keeps the tops of the runners the owner kept
 * ($Kim, $paws, $FTR) and drops $DICTATOR's $329M print on $16K.
 */
const SPIKE_SHARE = 0.05;
/** A told cap above this many times its hour's high is not a price the coin traded at. */
const TOLD_CAP_OVER_HIGH = 2;
/** When 0145 began writing card moments (internal.schema_migration): before it, an alert is a stand-in. */
const CARD_MOMENTS_FROM = '2026-10-27T18:35:18Z';
/** How long after a moved start a reading still prices it. */
const START_READING_MIN = 10;
/** The record's two bars: calls that at least doubled, and calls that went 10x or more. */
const TWO_X = 2;
const TEN_X = 10;
const WINDOWS = { week: 7 * DAY, month: 30 * DAY, all: null } as const;
export type CallsWindow = keyof typeof WINDOWS;

export function isCallsWindow(w: string | null): w is CallsWindow {
  return w !== null && Object.hasOwn(WINDOWS, w);
}

/**
 * Every call: a coin a For You card names as its post's one coin (not a withdrawn card), OR a coin we
 * sent a "coin launched" notification for (public.coin_call_alert, 0172) — the notification is the
 * call and stays one whatever the card says later; 366 of 530 such coins were missing before. Each
 * with its notified moment, the cap said then, its mint, ticker and picture, and when For You first
 * showed its post (the card's, else the notified post's). Not its name: a coin's name is anything its
 * creator typed, and the phone refuses a whole reply that carries one of our vendors' names (one
 * runner, $ANTS, is named after one). Only coins with an observed asset row (a coin we cannot place
 * is left out, as on the running strip).
 */
export const CALLS_SQL = `
with card as (
  select distinct on (f.payload #>> '{coins,coin,address}')
         f.payload #>> '{coins,coin,address}' as address, f.item_id, f.first_shown_at, f.payload
    from public.feed_post f
   where f.feed_id = 'fyp'
     and f.withdrawn_at is null
     and f.payload #>> '{coins,kind}' in ('one', 'matched')
     and coalesce(f.payload #>> '{coins,coin,address}', '') <> ''
   order by f.payload #>> '{coins,coin,address}', f.first_shown_at
), addrs as (
  select address from card
  union
  select address from public.coin_call_alert
), calls as (
  select x.address, n.notified_at, n.mc_usd, n.source,
         coalesce(cd.first_shown_at,
                  (select min(f.first_shown_at) from public.feed_post f where f.feed_id = 'fyp' and f.item_id = al.item_id)) as first_shown_at,
         coalesce(a.minted_at, to_timestamp((cd.payload #>> '{coins,coin,mintedAt,at}')::float8 / 1000)) as minted_at,
         coalesce(nullif(cd.payload #>> '{coins,coin,ticker}', ''), a.symbol) as ticker,
         coalesce(nullif(cd.payload #>> '{coins,coin,imageUrl}', ''), a.image_uri) as image_url,
         (select m.found_at from public.coin_first_matched m
           where m.item_id = coalesce(cd.item_id, al.item_id) and m.address = x.address) as matched_at
    from addrs x
    join public.asset a on a.asset_key = 'solana:' || x.address
    join public.coin_notified n on n.address = x.address
    left join card cd on cd.address = x.address
    left join public.coin_call_alert al on al.address = x.address
   where a.origin = any($1::text[])
), shown as (
  -- An old call's card moment: its first For You frame, or the coin's match to the post when that came
  -- later (0173). No match time (before 19 October): the frame, as the owner's October briefing measured.
  select c.*, greatest(c.first_shown_at, coalesce(c.matched_at, c.first_shown_at)) as card_at
    from calls c
), moved as (
  select s.*,
         (s.source = 'alert' and s.notified_at < $2::timestamptz
            and s.card_at > s.minted_at and s.card_at < s.notified_at) as moved
    from shown s
)
select m.address,
       (extract(epoch from case when m.moved then m.card_at else m.notified_at end) * 1000)::bigint as notified,
       m.moved,
       (extract(epoch from m.first_shown_at) * 1000)::bigint as found,
       case when m.moved then null else m.mc_usd end as notified_cap,
       (extract(epoch from m.minted_at) * 1000)::bigint as minted,
       coalesce(m.ticker, t.ticker) as ticker,
       m.image_url
  from moved m
  left join public.coin_hour_ticker t on t.address = m.address`;

/**
 * One coin's prices since its call: $1 address, $2 the call's moment (ms), $3 the priced quote tokens,
 * $4 SPIKE_SHARE, $5 START_READING_MIN. Two hourly histories, each guarded the same way (an hour's
 * high only when the hour traded SPIKE_SHARE of it, else its close), each with its dollars traded
 * since and the high and close of the call's own hour:
 *
 *   hist_*  the coin's own pool's history (0171), any time
 *   own_*   our candles (0144), only when priced in a token we price and recording by the call's hour
 *
 * and the readings for a coin neither covers. Prices are per coin and come back with the supply that
 * makes them market caps (the coin's own, else the launchpad's fixed one, in SQL so the guard can use
 * it). A CASE skips the readings' subqueries when they are not needed.
 */
export const CALL_PRICES_SQL = `
with s as (select to_timestamp($2::double precision / 1000) as at),
sup as (
  select coalesce(
    (select m.market_cap_usd / m.price_usd from public.coin_market_history m
      where m.address = $1 and m.market_cap_usd > 0 and m.price_usd > 0
      order by m.taken_at desc limit 1),
    case when $1 like '%${LAUNCHPAD_SUFFIX}' then ${LAUNCHPAD_SUPPLY}::double precision end) as supply
),
ch as (
  select (c.quote_mint is null or c.quote_mint = any($3::text[])) and c.recorded_from < s.at + interval '1 hour' as ok
    from public.coin_chart c, s where c.address = $1
),
hist as (
  select k.bucket, k.h, k.c, k.volume_usd from public.coin_hour_history k, s
   where k.address = $1 and k.bucket >= date_trunc('hour', s.at)
),
own as (
  select k.bucket, k.h, k.c, k.volume_usd from public.coin_candle k, s
   where k.address = $1 and k.minutes = 60 and k.bucket >= date_trunc('hour', s.at)
     and coalesce((select ok from ch), false)
)
select
  sup.supply,
  (select count(*) from hist) as hist_hours,
  (select max(case when k.volume_usd >= $4::double precision * k.h * sup.supply then k.h else k.c end) from hist k) as hist_peak,
  (select sum(k.volume_usd) from hist k) as hist_traded,
  (select k.h from hist k, s where k.bucket = date_trunc('hour', s.at)) as hist_hour_high,
  (select k.c from hist k, s where k.bucket = date_trunc('hour', s.at)) as hist_hour_close,
  coalesce((select ok from ch), false) as charted,
  (select max(case when k.volume_usd >= $4::double precision * k.h * sup.supply then k.h else k.c end) from own k) as own_peak,
  (select sum(k.volume_usd) from own k) as own_traded,
  (select k.h from own k, s where k.bucket = date_trunc('hour', s.at)) as own_hour_high,
  (select k.c from own k, s where k.bucket = date_trunc('hour', s.at)) as own_hour_close,
  (select m.market_cap_usd from public.coin_market_history m, s
    where m.address = $1 and m.market_cap_usd > 0
      and m.taken_at >= s.at and m.taken_at < s.at + make_interval(mins => $5::int)
    order by m.taken_at asc limit 1) as start_reading,
  case when exists (select 1 from hist) or exists (select 1 from own) then null else
         (select max(m.market_cap_usd) from public.coin_market_history m, s
           where m.address = $1 and m.market_cap_usd > 0 and m.taken_at >= s.at)
  end as peak_reading,
  case when exists (select 1 from hist) or exists (select 1 from own) then null else
         (select sum(h.v) from (select max(m.volume_1h_usd) as v from public.coin_market_history m, s
             where m.address = $1 and m.taken_at >= s.at and m.volume_1h_usd >= 0
             group by date_trunc('hour', m.taken_at)) h)
  end as reading_traded_usd
from sup`;

export type Measured = { readonly v: number } | { readonly v: null; readonly why: string };

export interface Call {
  readonly address: string;
  readonly ticker: string | null;
  readonly imageUrl: string | null;
  /** When we told people, ms: the notified moment, or For You's first showing for an old call (`moved`). */
  readonly notifiedAt: number;
  /** True when the moment is For You's first showing standing in for an old call's late alert. */
  readonly moved: boolean;
  /** When the post was first on For You, ms (catches.ts's moment): before the launch, we saw it first. */
  readonly foundAt: number | null;
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
    const foundAt = num(r['found']);
    const image = text(r['image_url']);
    return [{ address, ticker: text(r['ticker']), imageUrl: image !== null && image.startsWith('https://') ? image : null, notifiedAt, moved: r['moved'] === true, foundAt, notifiedCapUsd: cap !== null && cap > 0 ? cap : null, mintedAt }];
  });
}

/**
 * One call's numbers from CALL_PRICES_SQL's row.
 *
 *   start  the cap we told people (or, for a moved old call, the first reading after For You showed
 *          it), unless it is above TOLD_CAP_OVER_HIGH times its hour's high — then the hour's high;
 *          with no told cap and no reading, the hour's high (its close only when no high is known)
 *   peak   the higher of the two guarded histories; the readings only when neither has an hour
 *
 * Prices are per coin and need the supply SQL returned (the coin's own, else the launchpad's); without
 * one a candle price is not a market cap and the call is `not_recorded`.
 */
export function measure(call: Call, row: Row | undefined): CallRow {
  const supplyRead = num(row?.['supply']);
  const supply = supplyRead !== null && supplyRead > 0 ? supplyRead : call.address.endsWith(LAUNCHPAD_SUFFIX) ? LAUNCHPAD_SUPPLY : null;
  const cap = (price: number | null) => (price !== null && price > 0 && supply !== null ? price * supply : null);
  const positive = (v: number | null) => (v !== null && v > 0 ? v : null);
  const most = (...vs: (number | null)[]) => vs.reduce<number | null>((m, v) => (v === null ? m : m === null ? v : Math.max(m, v)), null);
  const charted = row?.['charted'] === true;
  const histPeak = cap(num(row?.['hist_peak']));
  const ownPeak = charted ? cap(num(row?.['own_peak'])) : null;
  const fromHistory = histPeak !== null || ownPeak !== null;
  /* The call's own hour, as the chart has it: the high a told cap may not be far above, and the close it falls back to. */
  const hourHigh = most(cap(num(row?.['hist_hour_high'])), charted ? cap(num(row?.['own_hour_high'])) : null);
  const hourClose = cap(num(row?.['hist_hour_close'])) ?? (charted ? cap(num(row?.['own_hour_close'])) : null);
  const told = call.moved ? positive(num(row?.['start_reading'])) : call.notifiedCapUsd;
  /* When the told cap is not a price the chart traded at (or there is none), the call starts at its
     hour's HIGH, not its close: the most anyone could have paid that hour, so the multiple can only
     understate. The close can be a dump at the hour's end ($CHUNGUS: $42K told, $2K close). */
  const start = told !== null && (hourHigh === null || told <= TOLD_CAP_OVER_HIGH * hourHigh) ? told : hourHigh ?? hourClose ?? told;
  const peakRaw = fromHistory ? most(histPeak, ownPeak) : positive(num(row?.['peak_reading']));
  /* The start was itself a price the coin traded at, so the peak is never under it. */
  const peak = start !== null && peakRaw !== null ? Math.max(start, peakRaw) : peakRaw;
  const traded = fromHistory ? most(num(row?.['hist_traded']), charted ? num(row?.['own_traded']) : null) : num(row?.['reading_traded_usd']);
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
    listed = callsFrom(await deps.db.query(CALLS_SQL, [deps.origins, CARD_MOMENTS_FROM]));
    let read = 0;
    let failed = 0;
    for (const call of listed) {
      const had = kept.get(call.address);
      /* A notified moment that moved (an earlier notification landed) is a different call: read again. */
      if (had !== undefined && had.notifiedAt === call.notifiedAt && !due(call, had.at, now())) continue;
      try {
        const rows = await deps.db.query(CALL_PRICES_SQL, [call.address, call.notifiedAt, PRICED_QUOTES, SPIKE_SHARE, START_READING_MIN]);
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
        return k === undefined ? [] : [{ ...k.row, ticker: c.ticker, imageUrl: c.imageUrl, foundAt: c.foundAt }];
      });
      return board(rows, window, now());
    },
    /** For tests: run one pass now and wait for it. */
    async passNow(): Promise<void> {
      await pass();
    },
  };
}
