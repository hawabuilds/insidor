/**
 * GET /coin/:assetKey/odds — WHAT HAPPENED TO PAST LAUNCHES THAT OPENED LIKE THIS ONE, for the token page's
 * Info tab (the owner, 2026-10-30: the odds and the rug risk at a glance). The groups and their history are
 * 0155's, built offline by tools/odds-bands.ts from a month of launches read from the chain; this file only
 * puts one live coin in its group, from facts about its own opening, and words the group's history.
 *
 * ★ HISTORY, NEVER A FORECAST. Every figure that leaves here is a count of what already happened to other
 * launches — "Launches that opened like this one, last 30 days: 31% went on to double from there" — beside
 * the same figure for all launches and the number of launches it rests on. Nothing says what THIS coin will
 * do. A group resting on fewer than `launchOdds.minLaunches` launches says "Too early to tell"; a group whose
 * story did not hold up on the launches after the tool's split date is shown as no different from a normal
 * launch, because that is all we can honestly say about it.
 *
 * ★ THE SAME FACTS THE TOOL COUNTED, AT THE SAME MOMENT. The tool imports `openingScore`, `signalMomentMs`
 * and `minuteFacts` from here, so a coin is grouped by exactly the definition its group was built with:
 *   second_1   its first second of trading (internal.launch_open, through public.launch_first_second):
 *              distinct buyers, buys, the creator's opening buy.
 *   minute_1/5 its trades since launch and its move since its first trade, from our one-minute candles,
 *              counted up to the end of the clock minute holding launch + 1 (or 5) minutes — the first
 *              moment a candle count is whole. A coin without candles from its launch has only second_1.
 * The latest signal a coin has reached is the one shown, and the reply says which.
 *
 * ★ AN ABSENCE IS SAID, NEVER ZERO. A coin whose first second we did not see is `{ kind: 'none', why }`, and
 * the page says so; the groups not yet built are the same, so the route works before 0155 is filled.
 *
 * What breaks if changed carelessly: `openingScore`. The groups' edges in 0155 are ranges of it; changing
 * it without rebuilding them puts every coin in the wrong group, silently.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { VENUE_ID } from '@insidor/venue-solana-pumpfun';

import type { Db, Row } from './queries.ts';

export type Signal = 'second_1' | 'minute_1' | 'minute_5';
export const SIGNALS: readonly Signal[] = ['second_1', 'minute_1', 'minute_5'];
export type OddsFact = 'first_second_buyers' | 'first_second_buys' | 'dev_buy' | 'moved_since_launch' | 'trades_so_far';
export type Tone = 'green' | 'amber' | 'red';
/** The block's one-word summary. Any rug sign wins over every other. */
export type Look = 'runner' | 'mixed' | 'rug' | 'dead' | 'early';

/** What a coin's opening says, as far as it is known. Null: not measured, never zero. */
export interface Opening {
  readonly buyers: number | null;
  readonly buys: number | null;
  readonly devBuyUsd: number | null;
  readonly tradesSoFar: number | null;
  readonly movedSinceLaunch: number | null;
}

/** One group's history from 0155 (band 0: every launch). */
export interface BandRow {
  readonly signal: Signal;
  readonly band: number;
  readonly scoreFrom: number | null;
  readonly scoreTo: number | null;
  readonly launches: number;
  /** Shares 0..1 that hit each of `launchOdds.multiples`, in order. */
  readonly hit: readonly number[];
  readonly rugged: number;
  readonly neverMoved: number;
  readonly heldUp: boolean;
  readonly launchedFromMs: number;
  readonly launchedToMs: number;
}

export interface BadgeRow {
  readonly fact: OddsFact;
  readonly signal: Signal;
  readonly from: number;
  readonly to: number | null;
  readonly tone: Tone;
  readonly launches: number;
  readonly hit2x: number;
  readonly rugged: number;
}

export interface OddsBadge {
  readonly tone: Tone;
  /** The coin's own fact: "14 buyers in its first second". */
  readonly fact: string;
  /** What launches with it did, against all launches: "doubled 31% vs 12%". Two fields, laid out apart by the
      page: the phone's screen rules allow no middle dot or bullet between them. */
  readonly compare: string;
  /** The same in full, for a tap: what was counted, over how many launches. */
  readonly explain: string;
}

export interface OddsShares {
  readonly launches: number;
  readonly hit: readonly { readonly x: number; readonly share: number }[];
  readonly rugged: number;
  readonly neverMoved: number;
}

export type LaunchOddsReply =
  | {
      readonly kind: 'odds';
      readonly at: Signal;
      readonly look: Look;
      /** "Launches that opened like this one, last 30 days" — or the group's own words. */
      readonly headline: string;
      /** What the group is, in words: "8–14 buyers in the first second". */
      readonly group: string;
      /** False when the group did not hold up; its figures are then all launches'. */
      readonly held: boolean;
      readonly like: OddsShares;
      readonly normal: OddsShares;
      readonly badges: readonly OddsBadge[];
      readonly days: number;
    }
  | { readonly kind: 'none'; readonly why: 'not_launchpad' | 'not_seen' | 'not_built' };

/** When a signal looks at a coin launched at `launchMs`. second_1: one second in; a minute signal: the end of the clock minute holding launch + its offset. */
export function signalMomentMs(launchMs: number, signal: Signal, policy: Policy = DEFAULT_POLICY): number {
  if (signal === 'second_1') return launchMs + 1_000;
  const at = launchMs + policy.launchOdds.signalAfterMs[signal];
  return (Math.floor(at / 60_000) + 1) * 60_000;
}

/** The number a coin is grouped by at a signal: its first second's distinct buyers, or its trades so far. */
export function openingScore(signal: Signal, o: Opening): number | null {
  return signal === 'second_1' ? o.buyers : o.tradesSoFar;
}

/** A minute signal's facts from one-minute candles (bucket start in ms, open, close, trades), ascending. */
export function minuteFacts(candles: readonly { readonly bucketMs: number; readonly o: number; readonly c: number; readonly trades: number }[], momentMs: number): { readonly tradesSoFar: number; readonly movedSinceLaunch: number | null } {
  const upTo = candles.filter((k) => k.bucketMs < momentMs);
  const first = upTo[0];
  const last = upTo[upTo.length - 1];
  return {
    tradesSoFar: upTo.reduce((s, k) => s + k.trades, 0),
    movedSinceLaunch: first !== undefined && last !== undefined && first.o > 0 ? last.c / first.o : null,
  };
}

/** The value of a badge's fact for this coin. */
export function factValue(fact: OddsFact, o: Opening): number | null {
  switch (fact) {
    case 'first_second_buyers':
      return o.buyers;
    case 'first_second_buys':
      return o.buys;
    case 'dev_buy':
      return o.devBuyUsd;
    case 'moved_since_launch':
      return o.movedSinceLaunch;
    case 'trades_so_far':
      return o.tradesSoFar;
  }
}

const pct = (share: number): string => {
  const p = share * 100;
  if (p > 0 && p < 1) return '<1%';
  return `${Math.round(p)}%`;
};
const count = (n: number): string => Math.round(n).toLocaleString('en-US');
const usd = (n: number): string => (n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : n >= 10 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const minuteOf = (signal: Signal): string => (signal === 'minute_1' ? '1' : '5');

/** "8–14", "15 or more", "under 2". */
function range(from: number, to: number | null, unit: (n: number) => string = count): string {
  if (to === null) return `${unit(from)} or more`;
  if (from <= 0 && to !== null) return `under ${unit(to)}`;
  if (to - from <= 1 && unit === count) return unit(from);
  return `${unit(from)}–${unit(unit === count ? to - 1 : to)}`;
}

/** The fact as this coin's own number, in words. */
function factText(fact: OddsFact, signal: Signal, v: number): string {
  switch (fact) {
    case 'first_second_buyers':
      return `${count(v)} ${v === 1 ? 'buyer' : 'buyers'} in its first second`;
    case 'first_second_buys':
      return `${count(v)} ${v === 1 ? 'buy' : 'buys'} in its first second`;
    case 'dev_buy':
      return v <= 0 ? 'Creator did not buy at launch' : `Creator bought ${usd(v)} at launch`;
    case 'trades_so_far':
      return `${count(v)} trades by minute ${minuteOf(signal)}`;
    case 'moved_since_launch':
      return v >= 1.1 ? `Up ${v.toFixed(1)}x since its first trade` : v <= 0.9 ? `Down ${Math.round((1 - v) * 100)}% since its first trade` : 'Flat since its first trade';
  }
}

/** The group of launches a badge counted, in words. */
function factGroup(fact: OddsFact, signal: Signal, from: number, to: number | null): string {
  switch (fact) {
    case 'first_second_buyers':
      return `launches with ${range(from, to)} buyers in their first second`;
    case 'first_second_buys':
      return `launches with ${range(from, to)} buys in their first second`;
    case 'dev_buy':
      return from <= 0 && to !== null && to <= 0.01 ? 'launches whose creator did not buy' : `launches whose creator bought ${range(from, to, usd)}`;
    case 'trades_so_far':
      return `launches with ${range(from, to)} trades by minute ${minuteOf(signal)}`;
    case 'moved_since_launch':
      return `launches at ${range(from, to, (n) => `${n.toFixed(1)}x`)} their first trade's price by minute ${minuteOf(signal)}`;
  }
}

/** The group a coin's score falls in, at a signal; null when none covers it. */
export function bandFor(bands: readonly BandRow[], signal: Signal, score: number): BandRow | null {
  return bands.find((b) => b.signal === signal && b.band > 0 && b.scoreFrom !== null && score >= b.scoreFrom && (b.scoreTo === null || score < b.scoreTo)) ?? null;
}

function shares(b: BandRow, policy: Policy): OddsShares {
  return { launches: b.launches, hit: policy.launchOdds.multiples.map((x, i) => ({ x, share: b.hit[i] ?? 0 })), rugged: b.rugged, neverMoved: b.neverMoved };
}

const TONE_ORDER: Record<Tone, number> = { red: 0, amber: 1, green: 2 };

/** The badges for a coin at a signal, worst first, each with its comparison in its words. */
export function badgesFor(rows: readonly BadgeRow[], normal: BandRow, signal: Signal, o: Opening, days: number, policy: Policy = DEFAULT_POLICY): OddsBadge[] {
  const out: (OddsBadge & { readonly order: number })[] = [];
  const doubled = normal.hit[0] ?? 0;
  for (const r of rows) {
    if (r.signal !== signal) continue;
    const v = factValue(r.fact, o);
    if (v === null || v < r.from || (r.to !== null && v >= r.to)) continue;
    const ruggedSign = normal.rugged > 0 && r.rugged >= policy.launchOdds.lift.red * normal.rugged;
    const said =
      r.tone === 'red' && ruggedSign
        ? `rugged ${pct(r.rugged)} vs ${pct(normal.rugged)}`
        : `doubled ${pct(r.hit2x)} vs ${pct(doubled)}`;
    const told =
      r.tone === 'red' && ruggedSign
        ? `${pct(r.rugged)} were rugged within the hour (rose ${Math.round(policy.launchOdds.rugRise * 100)}%, then gave back ${Math.round(policy.launchOdds.rugGiveBack * 100)}% of the rise), against ${pct(normal.rugged)} of all launches`
        : `${pct(r.hit2x)} went on to double from there, against ${pct(doubled)} of all launches`;
    out.push({
      tone: r.tone,
      order: TONE_ORDER[r.tone],
      fact: factText(r.fact, signal, v),
      compare: said,
      explain: `Of ${count(r.launches)} ${factGroup(r.fact, signal, r.from, r.to)} in the last ${days} days, ${told}.`,
    });
  }
  return out
    .sort((a, b) => a.order - b.order)
    .slice(0, 4)
    .map(({ tone, fact, compare, explain }) => ({ tone, fact, compare, explain }));
}

/** The block's summary word: any rug sign first, then too few launches, then the group against all. */
export function lookOf(like: BandRow, normal: BandRow, badges: readonly OddsBadge[], policy: Policy = DEFAULT_POLICY): Look {
  const l = policy.launchOdds.lift;
  if (badges.some((b) => b.tone === 'red')) return 'rug';
  if (like.launches < policy.launchOdds.minLaunches) return 'early';
  if (!like.heldUp) return 'mixed';
  const d = like.hit[0] ?? 0;
  const nd = normal.hit[0] ?? 0;
  if (normal.rugged > 0 && like.rugged >= l.red * normal.rugged) return 'rug';
  if (nd > 0 && d <= nd / l.red) return like.neverMoved >= l.dead * normal.neverMoved ? 'dead' : 'mixed';
  if (normal.neverMoved > 0 && like.neverMoved >= l.dead * normal.neverMoved) return 'dead';
  if (nd > 0 && d >= l.green * nd) return 'runner';
  return 'mixed';
}

/** The group in words: what the coin's opening score range is. */
function groupText(signal: Signal, b: BandRow): string {
  const r = range(b.scoreFrom ?? 0, b.scoreTo);
  return signal === 'second_1' ? `${r} buyers in the first second` : `${r} trades by minute ${minuteOf(signal)}`;
}

/** The latest signal a coin has reached that it has the facts for. */
export function signalNow(launchMs: number, nowMs: number, haveMinutes: boolean, policy: Policy = DEFAULT_POLICY): Signal | null {
  if (nowMs < signalMomentMs(launchMs, 'second_1', policy)) return null;
  if (!haveMinutes) return 'second_1';
  if (nowMs >= signalMomentMs(launchMs, 'minute_5', policy)) return 'minute_5';
  if (nowMs >= signalMomentMs(launchMs, 'minute_1', policy)) return 'minute_1';
  return 'second_1';
}

/** The whole reply for one coin, from its opening and the built groups. Pure. */
export function oddsReply(signal: Signal, o: Opening, bands: readonly BandRow[], badges: readonly BadgeRow[], policy: Policy = DEFAULT_POLICY): LaunchOddsReply {
  const normal = bands.find((b) => b.signal === signal && b.band === 0);
  const score = openingScore(signal, o);
  if (normal === undefined) return { kind: 'none', why: 'not_built' };
  if (score === null) return { kind: 'none', why: 'not_seen' };
  const days = Math.max(1, Math.round((normal.launchedToMs - normal.launchedFromMs) / 86_400_000));
  const band = bandFor(bands, signal, score);
  const like = band !== null && band.heldUp ? band : normal;
  const shown = badgesFor(badges, normal, signal, o, days, policy);
  const look = band === null ? 'early' : lookOf(band, normal, shown, policy);
  const opened = signal === 'second_1' ? 'opened like this one' : `stood like this one at minute ${minuteOf(signal)}`;
  return {
    kind: 'odds',
    at: signal,
    look,
    headline: band !== null && band.heldUp ? `Launches that ${opened}, last ${days} days` : `All launches, last ${days} days: this one's opening was no different`,
    group: band === null ? 'No launches opened like this one' : band.heldUp ? groupText(signal, band) : 'No group of launches like it held up',
    held: band !== null && band.heldUp,
    like: shares(like, policy),
    normal: shares(normal, policy),
    badges: shown,
    days,
  };
}

/* ── the reads ─────────────────────────────────────────────────────────── */

/**
 * The coin and its first second, when chainwatch saw it, and whether we chart it from its launch. A coin
 * with no asset row is still answered when chainwatch saw it launch: chainwatch records only the
 * launchpad's launches, and most of them never get an asset row. Nothing outside the database is read, so
 * an unknown address costs one indexed lookup and is a 404.
 */
export const ODDS_COIN_SQL = `
select coalesce(a.address, f.address) as address, a.venue_id,
       extract(epoch from f.launched_at) * 1000 as launched_ms, f.buyers, f.buys, f.dev_buy_usd,
       c.from_launch
  from (select $1::text as k, split_part($1::text, ':', 2) as addr) q
  left join public.asset a on a.asset_key = q.k
  left join public.launch_first_second f on f.address = coalesce(a.address, q.addr)
  left join public.coin_chart c on c.address = coalesce(a.address, q.addr)
 where a.asset_key is not null or f.address is not null`;

/** The coin's minute candles from its launch up to a moment (ms). */
export const ODDS_CANDLES_SQL = `
select extract(epoch from bucket) * 1000 as bucket_ms, o, c, trades
  from public.coin_candle
 where address = $1 and minutes = 1 and bucket >= to_timestamp($2::float8 / 1000) - interval '1 minute' and bucket < to_timestamp($3::float8 / 1000)
 order by bucket`;

export const ODDS_BANDS_SQL = `
select signal, band, score_from, score_to, launches, hit_2x, hit_3x, hit_5x, hit_10x, rugged_1h, never_moved, held_up,
       extract(epoch from launched_from) * 1000 as from_ms, extract(epoch from launched_to) * 1000 as to_ms
  from public.launch_odds`;

export const ODDS_BADGES_SQL = `select fact, signal, value_from, value_to, tone, launches, hit_2x, rugged_1h from public.launch_odds_badge`;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const isSignal = (v: unknown): v is Signal => SIGNALS.includes(v as Signal);
const FACTS: readonly OddsFact[] = ['first_second_buyers', 'first_second_buys', 'dev_buy', 'moved_since_launch', 'trades_so_far'];
const isFact = (v: unknown): v is OddsFact => FACTS.includes(v as OddsFact);
const isTone = (v: unknown): v is Tone => v === 'green' || v === 'amber' || v === 'red';

export function bandRows(rows: readonly Row[]): BandRow[] {
  const out: BandRow[] = [];
  for (const r of rows) {
    if (!isSignal(r['signal'])) continue;
    out.push({
      signal: r['signal'],
      band: num(r['band']) ?? -1,
      scoreFrom: num(r['score_from']),
      scoreTo: num(r['score_to']),
      launches: num(r['launches']) ?? 0,
      hit: [num(r['hit_2x']) ?? 0, num(r['hit_3x']) ?? 0, num(r['hit_5x']) ?? 0, num(r['hit_10x']) ?? 0],
      rugged: num(r['rugged_1h']) ?? 0,
      neverMoved: num(r['never_moved']) ?? 0,
      heldUp: r['held_up'] === true,
      launchedFromMs: num(r['from_ms']) ?? 0,
      launchedToMs: num(r['to_ms']) ?? 0,
    });
  }
  return out;
}

export function badgeRows(rows: readonly Row[]): BadgeRow[] {
  const out: BadgeRow[] = [];
  for (const r of rows) {
    const from = num(r['value_from']);
    if (!isFact(r['fact']) || !isSignal(r['signal']) || !isTone(r['tone']) || from === null) continue;
    out.push({ fact: r['fact'], signal: r['signal'], from, to: num(r['value_to']), tone: r['tone'], launches: num(r['launches']) ?? 0, hit2x: num(r['hit_2x']) ?? 0, rugged: num(r['rugged_1h']) ?? 0 });
  }
  return out;
}

/** The route's reader: the groups kept `launchOdds.keepMs`; one coin's opening read on each call. Null: no such coin. */
export function createLaunchOdds(now: () => number = Date.now, policy: Policy = DEFAULT_POLICY) {
  let kept: { readonly at: number; readonly bands: readonly BandRow[]; readonly badges: readonly BadgeRow[] } | null = null;
  const built = async (db: Db, nowMs: number): Promise<{ readonly bands: readonly BandRow[]; readonly badges: readonly BadgeRow[] } | null> => {
    if (kept !== null && nowMs - kept.at < policy.launchOdds.keepMs) return kept;
    try {
      const [bands, badges] = await Promise.all([db.query(ODDS_BANDS_SQL, []), db.query(ODDS_BADGES_SQL, [])]);
      kept = { at: nowMs, bands: bandRows(bands), badges: badgeRows(badges) };
      return kept;
    } catch {
      /* 0155 not applied yet, or unreadable: the page says the odds are not there, not a server fault. */
      return null;
    }
  };
  return async function read(assetKey: string, db: Db): Promise<LaunchOddsReply | null> {
    const nowMs = now();
    const coin = (await db.query(ODDS_COIN_SQL, [assetKey]))[0];
    if (coin === undefined) return null;
    /* No asset row but a launch chainwatch saw: the launchpad's, by where the row came from. */
    const venue = coin['venue_id'] ?? VENUE_ID;
    if (!policy.launchOdds.on || venue !== VENUE_ID) return { kind: 'none', why: 'not_launchpad' };
    const launchMs = num(coin['launched_ms']);
    if (launchMs === null) return { kind: 'none', why: 'not_seen' };
    const groups = await built(db, nowMs);
    if (groups === null) return { kind: 'none', why: 'not_built' };
    const signal = signalNow(launchMs, nowMs, coin['from_launch'] === true, policy);
    if (signal === null) return { kind: 'none', why: 'not_seen' };
    let minutes: { readonly tradesSoFar: number | null; readonly movedSinceLaunch: number | null } = { tradesSoFar: null, movedSinceLaunch: null };
    if (signal !== 'second_1') {
      const moment = signalMomentMs(launchMs, signal, policy);
      const candles = await db.query(ODDS_CANDLES_SQL, [coin['address'], launchMs, moment]);
      minutes = minuteFacts(
        candles.map((k) => ({ bucketMs: num(k['bucket_ms']) ?? 0, o: num(k['o']) ?? 0, c: num(k['c']) ?? 0, trades: num(k['trades']) ?? 0 })),
        moment,
      );
    }
    const opening: Opening = { buyers: num(coin['buyers']), buys: num(coin['buys']), devBuyUsd: num(coin['dev_buy_usd']), ...minutes };
    return oddsReply(signal, opening, groups.bands, groups.badges, policy);
  };
}
