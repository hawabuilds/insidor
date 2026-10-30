/**
 * `node --env-file=.env.local --experimental-strip-types tools/odds-bands.ts [--split 2026-10-20] [--write]`
 *
 * TURNS THE BACKFILL'S MONTH OF LAUNCHES INTO THE GROUPS A TOKEN PAGE'S ODDS ARE READ FROM (0155). Reads
 * tools/odds-backfill.ts's JSONL, and for each launch, at each signal time (its first second, minute 1,
 * minute 5 — services/read launch-odds.ts `signalMomentMs`), works out:
 *
 *   its facts   what the read service can see live at that moment: first-second buyers and buys, the
 *               creator's opening buy, trades so far, the move since its first trade.
 *   its hour    from the price AT THAT MOMENT (never the launch price): whether it went on to reach 2x,
 *               3x, 5x, 10x within its first hour, was rugged, or never moved (Policy.launchOdds says how
 *               each is counted). And the same from three seconds later, as a check that a trader who
 *               saw the page a beat late would have seen the same thing.
 *
 * Launches are grouped by `openingScore` (launch-odds.ts) into bands. The bands are built on the launches
 * before `--split` and tested on those after: a band whose story (more or less often to double, more or
 * less often rugged, than all launches) did not repeat after the split is merged into its neighbour, and
 * one that cannot be made to hold is written with `held_up` false — the page then shows it as no different
 * from a normal launch. Each single fact gets badges the same way: value ranges with enough launches, a
 * colour from how they compared with all launches (Policy.launchOdds.lift), kept only where the colour
 * repeated after the split (amber where it did not).
 *
 * ★ WEIGHTED. The backfill read every graduate it sampled and only a slice of the rest, so each launch
 * counts for its stratum's population over its stratum's sample. Unweighted, every rate would be the
 * graduates' and wildly high. `launches` is the raw count — what a figure rests on.
 * ★ THE DEV BUY IS IN DOLLARS LIVE AND IN SOL HERE. The rate is measured, not assumed: the median of
 * chainwatch's dollar reading over our SOL reading, on the launches both saw (internal.launch_open).
 * The same overlap checks that our "first second" (the launch's slot and the two after it) counts the
 * buyers chainwatch counts in its first 1,000 ms.
 *
 * Writes `bands.json` and `bands.sql` beside the backfill; `--write` also replaces 0155's rows in one
 * transaction (the read service shows whatever is there). What breaks if changed carelessly: the weights,
 * and measuring from the launch price — both make the odds look far better than any trader got.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { openingScore, rugSign, signalMomentMs, SIGNALS, type Opening, type OddsFact, type Signal, type Tone } from '../services/read/src/launch-odds.ts';

const P = DEFAULT_POLICY.launchOdds;
const DIR = process.env['ODDS_DIR'] ?? '/tmp/insidor-odds';
/** The launchpad curve's starting price in SOL a token: 30 SOL of virtual reserve over 1,073,000,000 tokens. */
const CURVE_START = 30 / 1_073_000_000;
/** The backfill's "first second": the launch's slot and the next two (slots are about 400 ms). */
const FIRST_SECOND_SLOTS = 2;
/** Three seconds later, in slots. */
const LATE_SLOTS = FIRST_SECOND_SLOTS + 8;
const LATE_MS = 3_000;
/** Bands and badges need this many launches after the split before "held up" means anything. */
const MIN_TEST = 30;
/** A band repeats when its rate after the split is on the same side of all launches' as before. */
const SAME_SIDE_SLACK = 0.1;

const EDGES: Record<Signal, readonly number[]> = {
  second_1: [0, 1, 2, 3, 5, 8, 12, 15, 20, 30],
  minute_1: [0, 1, 3, 10, 20, 40, 70, 100, 150, 200, 300, 500, 1000],
  minute_5: [0, 1, 3, 10, 30, 60, 100, 200, 300, 500, 700, 1000],
};
const FACT_EDGES: Record<OddsFact, readonly number[]> = {
  first_second_buyers: EDGES.second_1,
  first_second_buys: [0, 1, 2, 3, 5, 8, 12, 15, 20, 30],
  dev_buy: [0, 0.01, 5, 20, 50, 100, 200, 500],
  trades_so_far: EDGES.minute_5,
  moved_since_launch: [0, 0.5, 0.9, 1.1, 1.5, 2, 3, 5, 10],
};
const FACTS_AT: Record<Signal, readonly OddsFact[]> = {
  second_1: ['first_second_buyers', 'first_second_buys', 'dev_buy'],
  minute_1: ['trades_so_far', 'moved_since_launch', 'first_second_buyers', 'dev_buy'],
  minute_5: ['trades_so_far', 'moved_since_launch', 'first_second_buyers', 'dev_buy'],
};

/** `peakS`: seconds after launch the hour's peak came. */
interface Outcome { readonly peak: number; readonly rugged: boolean; readonly peakS: number }
/** `momentS`: seconds after launch the signal looked. */
/** `slow`: first reached 2x of the entry after hour one and within a day; null when hours 1–24 were not read. */
/** `peakDayS`: seconds from the signal to the day's peak, for a launch that reached 2x within the day; null when it did not or its day was not read. */
interface Seen { readonly opening: Opening; readonly now: Outcome; readonly late: Outcome; readonly momentS: number; readonly slow: boolean | null; readonly dayRead: boolean; readonly peakDayS: number | null }
interface Launch {
  readonly address: string;
  readonly launchMs: number;
  readonly w: number;
  readonly devBuySol: number;
  readonly at: Partial<Record<Signal, Seen>>;
}

type Trade = readonly [slotOff: number, sOff: number, wallet: number, buy: number, sol: number, price: number, pool: number];

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};

/** The hour after an entry: the peak over the entry price, and whether it was rugged. */
function hourAfter(trades: readonly Trade[], after: (t: Trade) => boolean, entry: number): Outcome {
  let peak = entry;
  let peakS = 0;
  let low = Infinity;
  for (const t of trades) {
    if (t[1] * 1_000 > P.firstHourMs || !after(t)) continue;
    if (t[5] > peak) {
      peak = t[5];
      peakS = t[1];
      low = Infinity;
    } else low = Math.min(low, t[5]);
  }
  const rose = peak >= (1 + P.rugRise) * entry;
  const fell = low !== Infinity && peak - low >= P.rugGiveBack * (peak - Math.min(CURVE_START, entry));
  return { peak: peak / entry, rugged: rose && fell, peakS };
}

/** The price of the last trade before a condition fails, else the curve's start. */
function priceBy(trades: readonly Trade[], by: (t: Trade) => boolean): number {
  let p = CURVE_START;
  for (const t of trades) {
    if (!by(t)) break;
    p = t[5];
  }
  return p;
}

interface Rec {
  a: string; s: 'g' | 'o'; m: number; slot0: number | null; bt0: number | null; creator: string | null; creatorW: number | null;
  windows: [number, number][]; trades: Trade[]; txs?: number; unpriced?: number; denseTo?: number; denseEnded?: boolean;
}

/** How far from launch every trade was read: the backfill's own mark, or for its first rows the windows before the first grid jump. */
function denseOf(r: Rec): { to: number; ended: boolean } {
  if (r.denseTo !== undefined) return { to: r.denseTo, ended: r.denseEnded === true };
  let to = 0;
  for (const [a, b] of r.windows) {
    if (a > to && a >= 420 && (a - 420) % 120 === 0) return { to, ended: false };
    to = Math.max(to, b);
  }
  return { to, ended: to >= 3_600 || r.windows.length <= 2 };
}

function launchOf(r: Rec, w: number): Launch | 'unpriced' | 'unread' {
  if (r.slot0 === null || r.bt0 === null || r.creator === null) return 'unread';
  const trades = r.trades.filter((t) => t[5] > 0);
  /* Trades seen with no SOL price (a curve quoted in another token): nothing here can be measured. */
  if (trades.length === 0 && ((r.unpriced ?? 0) > 0 || (r.txs === undefined && r.windows[0]?.[1] !== 0))) return 'unpriced';
  const cw = r.creatorW;
  const firstSecond = trades.filter((t) => t[0] <= FIRST_SECOND_SLOTS && t[3] === 1);
  const devBuySol = trades.filter((t) => t[0] === 0 && t[2] === cw && t[3] === 1).reduce((s, t) => s + t[4], 0);
  const first = trades[0]?.[5] ?? CURVE_START;
  const launchMs = r.bt0 * 1_000;
  const dense = denseOf(r);
  const base = { buyers: new Set(firstSecond.map((t) => t[2])).size, buys: firstSecond.length, devBuyUsd: devBuySol, tradesSoFar: null, movedSinceLaunch: null };
  const at: Partial<Record<Signal, Seen>> = {};

  const sNow = (t: Trade): boolean => t[0] <= FIRST_SECOND_SLOTS;
  const sLate = (t: Trade): boolean => t[0] <= LATE_SLOTS;
  const e1 = priceBy(trades, sNow);
  const e1l = priceBy(trades, sLate);
  const now1 = hourAfter(trades, (t) => !sNow(t), e1);
  at.second_1 = { momentS: 1, opening: base, now: now1, late: hourAfter(trades, (t) => !sLate(t), e1l), slow: slowRun(r.a, now1, e1), dayRead: dayOf.has(r.a), peakDayS: dayPeak(r.a, now1, e1, 1) };

  for (const signal of ['minute_1', 'minute_5'] as const) {
    const moment = signalMomentMs(launchMs, signal) - launchMs;
    const before = (t: Trade): boolean => t[1] * 1_000 < moment;
    const beforeLate = (t: Trade): boolean => t[1] * 1_000 < moment + LATE_MS;
    const upTo = trades.filter(before);
    /* Every trade up to the moment read, or the coin's trades ended before it; else its price there is the grid's. */
    const whole = dense.ended || dense.to * 1_000 >= moment;
    const entry = upTo.length > 0 ? (upTo[upTo.length - 1] as Trade)[5] : CURVE_START;
    if (!whole && upTo.length === 0) continue;
    at[signal] = {
      momentS: moment / 1_000,
      slow: slowRun(r.a, hourAfter(trades, (t) => !before(t), entry), entry),
      dayRead: dayOf.has(r.a),
      peakDayS: dayPeak(r.a, hourAfter(trades, (t) => !before(t), entry), entry, moment / 1_000),
      opening: { ...base, tradesSoFar: upTo.length, movedSinceLaunch: upTo.length > 0 ? entry / first : null },
      now: hourAfter(trades, (t) => !before(t), entry),
      late: hourAfter(trades, (t) => !beforeLate(t), priceBy(trades, beforeLate)),
    };
  }
  return { address: r.a, launchMs, w, devBuySol, at };
}

/* ── rates ─────────────────────────────────────────────────────────────── */

/** `peakP50S`, `peakP75S`: over the launches that reached 2x within the day (day reads only), the weighted median and 75th percentile of seconds from the signal to the day's peak. */
interface Rates { n: number; w: number; hit: number[]; rugged: number; never: number; lateHit: number[]; peakP50S: number | null; peakP75S: number | null; slow: number | null }
function rates(xs: readonly { l: Launch; s: Seen }[]): Rates {
  const r: Rates = { n: xs.length, w: 0, hit: P.multiples.map(() => 0), rugged: 0, never: 0, lateHit: P.multiples.map(() => 0), peakP50S: null, peakP75S: null, slow: null };
  const peaks: { s: number; w: number }[] = [];
  let slowW = 0;
  let slowOf = 0;
  for (const { l, s } of xs) {
    r.w += l.w;
    if (s.peakDayS !== null) peaks.push({ s: s.peakDayS, w: l.w });
    P.multiples.forEach((k, i) => {
      if (s.now.peak >= k) r.hit[i] = (r.hit[i] ?? 0) + l.w;
      if (s.late.peak >= k) r.lateHit[i] = (r.lateHit[i] ?? 0) + l.w;
    });
    if (s.now.rugged) r.rugged += l.w;
    if (s.slow !== null) {
      slowOf += l.w;
      if (s.slow) slowW += l.w;
    }
    if (s.now.peak < P.neverMovedBelow) r.never += l.w;
  }
  /* Fewer doublers than this and a peak time is one or two coins' story. */
  if (peaks.length >= MIN_TEST) {
    peaks.sort((a, b) => a.s - b.s);
    const total = peaks.reduce((s, p) => s + p.w, 0);
    const at = (q: number): number | null => {
      let acc = 0;
      for (const p of peaks) {
        acc += p.w;
        if (acc >= q * total) return p.s;
      }
      return null;
    };
    r.peakP50S = at(0.5);
    r.peakP75S = at(0.75);
  }
  /* Over the launches whose day was read, and only once enough were. */
  if (slowOf > 0 && xs.filter((x) => x.s.slow !== null).length >= MIN_TEST) r.slow = slowW / slowOf;
  const d = r.w > 0 ? r.w : 1;
  return { ...r, hit: r.hit.map((h) => h / d), lateHit: r.lateHit.map((h) => h / d), rugged: r.rugged / d, never: r.never / d };
}

/** Which side of all launches a group sits on, for the two things a page says: doubling and rugs. */
function side(g: Rates, all: Rates): [number, number] {
  const s = (x: number, y: number): number => (y <= 0 ? 0 : x >= y * (1 + SAME_SIDE_SLACK) ? 1 : x <= y * (1 - SAME_SIDE_SLACK) ? -1 : 0);
  return [s(g.hit[0] ?? 0, all.hit[0] ?? 0), s(g.rugged, all.rugged)];
}
const sameStory = (train: [number, number], test: [number, number]): boolean => train.every((t, i) => t === 0 || t === test[i]);

interface Bin { from: number; to: number | null }
function binsOf(edges: readonly number[]): Bin[] {
  return edges.map((from, i) => ({ from, to: edges[i + 1] ?? null }));
}
const inBin = (b: Bin, v: number): boolean => v >= b.from && (b.to === null || v < b.to);

/** Merges bin i into its smaller neighbour. */
function mergeAt(bins: Bin[], i: number, size: (b: Bin) => number): Bin[] {
  const left = i > 0 ? size(bins[i - 1] as Bin) : Infinity;
  const right = i < bins.length - 1 ? size(bins[i + 1] as Bin) : Infinity;
  const j = left <= right ? i - 1 : i + 1;
  const [a, b] = j < i ? [bins[j] as Bin, bins[i] as Bin] : [bins[i] as Bin, bins[j] as Bin];
  const out = bins.slice();
  out.splice(Math.min(i, j), 2, { from: a.from, to: b.to });
  return out;
}

interface Group { bin: Bin; train: Rates; test: Rates; all: Rates; held: boolean }

/** Bins on a value, merged until each has `P.minLaunches` before the split and tells the same story after it. */
function groups(rows: readonly { l: Launch; s: Seen; v: number }[], edges: readonly number[], split: number): Group[] {
  const train = rows.filter((x) => x.l.launchMs < split);
  const test = rows.filter((x) => x.l.launchMs >= split);
  const allTrain = rates(train);
  const allTest = rates(test);
  let bins = binsOf(edges);
  const size = (b: Bin): number => train.filter((x) => inBin(b, x.v)).length;
  for (;;) {
    const small = bins.findIndex((b) => size(b) < P.minLaunches);
    if (small < 0 || bins.length === 1) break;
    bins = mergeAt(bins, small, size);
  }
  const judge = (b: Bin): Group => {
    const tr = rates(train.filter((x) => inBin(b, x.v)));
    const te = rates(test.filter((x) => inBin(b, x.v)));
    const held = te.n >= MIN_TEST && sameStory(side(tr, allTrain), side(te, allTest));
    return { bin: b, train: tr, test: te, all: rates(rows.filter((x) => inBin(b, x.v))), held };
  };
  for (;;) {
    const gs = bins.map(judge);
    const failing = gs.findIndex((g) => !g.held && side(g.train, allTrain).some((s) => s !== 0));
    if (failing < 0 || bins.length === 1) return bins.length === 1 ? gs.map((g) => ({ ...g, held: false })) : gs;
    bins = mergeAt(bins, failing, size);
  }
}

/**
 * Red is a rug sign and nothing else (launch-odds.ts `rugSign`, the same rule the page's summary uses): a
 * fact whose launches rarely moved is amber, and the group says "dead". Measured on the first 3,000
 * launches, almost every launch that rose 50% gave it back within the hour, so "rugged more often" alone
 * only meant "moved more often" and painted the busiest openings — which also doubled most — red.
 */
function tone(g: Rates, all: Rates): Tone {
  const d = g.hit[0] ?? 0;
  const nd = all.hit[0] ?? 0;
  if (rugSign(g.rugged, d, all.rugged, nd)) return 'red';
  if (nd > 0 && d >= P.lift.green * nd) return 'green';
  return 'amber';
}

/* ── main ──────────────────────────────────────────────────────────────── */

const list = JSON.parse(readFileSync(join(DIR, 'launches.json'), 'utf8')) as { from: string; to: string; population: { g: number; o: number } };
/* Hours 1–24 per coin, from the backfill's `late` pass, when it has run. */
const lateFile = join(DIR, 'launches-late.jsonl');
const dayOf = new Map<string, readonly (readonly [number, number])[]>();
if (existsSync(lateFile)) for (const line of readFileSync(lateFile, 'utf8').split('\n')) if (line) {
  const x = JSON.parse(line) as { a: string; prices: [number, number][] };
  dayOf.set(x.a, x.prices);
}
/** First reached 2x of the entry after the hour and within the day — only if it had not within the hour. */
function slowRun(address: string, hour: Outcome, entry: number): boolean | null {
  const day = dayOf.get(address);
  if (day === undefined) return null;
  if (hour.peak >= (P.multiples[0] ?? 2)) return false;
  return day.some(([, p]) => p >= (P.multiples[0] ?? 2) * entry);
}

/**
 * Seconds from the signal to the day's peak, for a launch that reached 2x of its entry within the day:
 * the hour's peak or a later one from the day reads, whichever is higher. Null without a day read (the hour
 * alone would call every slow mover's peak "within the hour") or when it never reached 2x.
 */
function dayPeak(address: string, hour: Outcome, entry: number, momentS: number): number | null {
  const day = dayOf.get(address);
  if (day === undefined) return null;
  let peak = hour.peak * entry;
  let peakS = hour.peakS;
  for (const [s, p] of day) {
    if (p > peak) {
      peak = p;
      peakS = s;
    }
  }
  return peak >= (P.multiples[0] ?? 2) * entry ? Math.max(0, peakS - momentS) : null;
}

const recs = readFileSync(join(DIR, 'launches.jsonl'), 'utf8').split('\n').filter((x) => x !== '').map((x) => JSON.parse(x) as Rec);
const sampled = { g: 0, o: 0 };
for (const r of recs) sampled[r.s] += 1;
const weight = { g: list.population.g / Math.max(1, sampled.g), o: list.population.o / Math.max(1, sampled.o) };

const tally = { unread: 0, unpriced: 0 };
const launches: Launch[] = [];
for (const r of recs) {
  const l = launchOf(r, weight[r.s]);
  if (l === 'unread' || l === 'unpriced') tally[l] += 1;
  else launches.push(l);
}
console.log(`${recs.length} launches read (${sampled.g} graduates ×${weight.g.toFixed(1)}, ${sampled.o} others ×${weight.o.toFixed(1)}); ${launches.length} measured, ${tally.unpriced} on a curve not priced in SOL, ${tally.unread} with no launch in the read.`);

/* The dollar rate and the first-second check, on the launches chainwatch also saw. */
let solUsd = Number(arg('--sol-usd') ?? NaN);
const dbUrl = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const pool = dbUrl ? createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: dbUrl }, applicationName: 'insidor-odds-bands' }) : null;
try {
  if (pool !== null) {
    const seen = await asDb(pool).query<{ address: string; buyers: number; dev_buy_usd: number | null }>(
      `select address, buyers, dev_buy_usd from internal.launch_open where address = any($1::text[])`,
      [launches.map((l) => l.address)],
    );
    const ratios: number[] = [];
    let same = 0;
    let near = 0;
    for (const s of seen) {
      const l = launches.find((x) => x.address === s.address);
      if (l === undefined) continue;
      const ours = l.at.second_1?.opening.buyers ?? 0;
      if (ours === s.buyers) same += 1;
      if (Math.abs(ours - s.buyers) <= 1) near += 1;
      if (s.dev_buy_usd !== null && l.devBuySol > 0.001) ratios.push(s.dev_buy_usd / l.devBuySol);
    }
    ratios.sort((a, b) => a - b);
    if (!Number.isFinite(solUsd) && ratios.length > 0) solUsd = ratios[Math.floor(ratios.length / 2)] as number;
    console.log(`Overlap with chainwatch's first second: ${seen.length} launches; first-second buyers equal on ${same}, within one on ${near}. SOL at $${solUsd.toFixed(2)} (median of ${ratios.length} opening buys).`);
  }
  if (!Number.isFinite(solUsd)) throw new Error('no SOL rate: pass --sol-usd or a database with launch_open');

  const dollars = (o: Opening, l: Launch): Opening => ({ ...o, devBuyUsd: l.devBuySol * solUsd });
  const times = launches.map((l) => l.launchMs).sort((a, b) => a - b);
  const splitArg = arg('--split');
  const split = splitArg !== null ? Date.parse(splitArg) : (times[Math.floor(times.length * 0.67)] ?? 0);
  /* The listed window, not the launches' own times: a coin whose first transaction predates its listing
     would stretch "the last 30 days" to whatever its mint said. */
  const from = Date.parse(list.from);
  const to = Date.parse(list.to);
  console.log(`Built on launches before ${new Date(split).toISOString()}, tested on those after.`);

  const out: { bands: Record<string, unknown>[]; badges: Record<string, unknown>[] } = { bands: [], badges: [] };
  const pctS = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(6);
  for (const signal of SIGNALS) {
    const seen = launches.flatMap((l) => {
      const s = l.at[signal];
      return s === undefined ? [] : [{ l, s: { ...s, opening: dollars(s.opening, l) } }];
    });
    const all = rates(seen);
    out.bands.push({ signal, band: 0, score_from: null, score_to: null, launches: all.n, hit: all.hit, rugged_1h: all.rugged, never_moved: all.never, peak_p50_s: all.peakP50S, peak_p75_s: all.peakP75S, slow_2x: all.slow, held_up: true });
    console.log(`\n${signal}: ${all.n} launches. All: hit ${all.hit.map(pctS).join(' ')}  rugged ${pctS(all.rugged)}  never moved ${pctS(all.never)}  | 3 s later: ${all.lateHit.map(pctS).join(' ')}`);
    const scored = seen.flatMap((x) => {
      const v = openingScore(signal, x.s.opening);
      return v === null ? [] : [{ ...x, v }];
    });
    const gs = groups(scored, EDGES[signal], split);
    gs.forEach((g, i) => {
      out.bands.push({ signal, band: i + 1, score_from: g.bin.from, score_to: g.bin.to, launches: g.all.n, hit: g.all.hit, rugged_1h: g.all.rugged, never_moved: g.all.never, peak_p50_s: g.all.peakP50S, peak_p75_s: g.all.peakP75S, slow_2x: g.all.slow, held_up: g.held });
      console.log(
        `  [${g.bin.from}, ${g.bin.to ?? '∞'}) n=${String(g.all.n).padStart(5)} hit ${g.all.hit.map(pctS).join(' ')} rugged ${pctS(g.all.rugged)} never ${pctS(g.all.never)}` +
          ` | before: 2x ${pctS(g.train.hit[0] ?? 0)} 5x ${pctS(g.train.hit[2] ?? 0)} 10x ${pctS(g.train.hit[3] ?? 0)} (n=${g.train.n}) after: 2x ${pctS(g.test.hit[0] ?? 0)} 5x ${pctS(g.test.hit[2] ?? 0)} 10x ${pctS(g.test.hit[3] ?? 0)} (n=${g.test.n})` +
          ` | 3 s later 2x ${pctS(g.all.lateHit[0] ?? 0)} | ${g.held ? 'HELD' : 'did not hold'}`,
      );
    });
    for (const fact of FACTS_AT[signal]) {
      const rows = seen.flatMap((x) => {
        const o = x.s.opening;
        const v = fact === 'first_second_buyers' ? o.buyers : fact === 'first_second_buys' ? o.buys : fact === 'dev_buy' ? o.devBuyUsd : fact === 'trades_so_far' ? o.tradesSoFar : o.movedSinceLaunch;
        return v === null ? [] : [{ ...x, v }];
      });
      const trainAll = rates(rows.filter((x) => x.l.launchMs < split));
      const testAll = rates(rows.filter((x) => x.l.launchMs >= split));
      /* The fact's usual value (weighted median) and, per range, the weighted share of launches at or above
         its lower edge: what the Wallets card says beside a coin's own value ("Usual $20", "Top 5% of launches"). */
      const sorted = rows.slice().sort((a, b) => a.v - b.v);
      const total = sorted.reduce((s, x) => s + x.l.w, 0);
      let acc = 0;
      let usual: number | null = null;
      for (const x of sorted) {
        acc += x.l.w;
        if (usual === null && acc >= total / 2) usual = x.v;
      }
      const atLeast = (from: number): number => (total > 0 ? sorted.filter((x) => x.v >= from).reduce((s, x) => s + x.l.w, 0) / total : 0);
      for (const g of groups(rows, FACT_EDGES[fact], split)) {
        if (g.all.n < P.minLaunches) continue;
        const before = tone(g.train, trainAll);
        const t: Tone = g.test.n >= MIN_TEST && tone(g.test, testAll) === before ? before : 'amber';
        out.badges.push({ fact, signal, value_from: g.bin.from, value_to: g.bin.to, tone: t, launches: g.all.n, hit_2x: g.all.hit[0], rugged_1h: g.all.rugged, usual_value: usual, share_at_least: atLeast(g.bin.from) });
        console.log(`    ${fact.padEnd(20)} [${g.bin.from}, ${g.bin.to ?? '∞'}) n=${String(g.all.n).padStart(5)} 2x ${pctS(g.all.hit[0] ?? 0)} rugged ${pctS(g.all.rugged)} → ${t}`);
      }
    }
  }

  const window = { launched_from: new Date(from).toISOString(), launched_to: new Date(to).toISOString() };
  writeFileSync(join(DIR, 'bands.json'), JSON.stringify({ ...window, solUsd, split: new Date(split).toISOString(), ...out }, null, 1));
  const lit = (v: unknown): string => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v}'` : String(v));
  const sql = [
    'begin;',
    'delete from public.launch_odds;',
    'delete from public.launch_odds_badge;',
    ...out.bands.map((b) => {
      const h = b['hit'] as number[];
      return `insert into public.launch_odds (signal, band, score_from, score_to, launches, hit_2x, hit_3x, hit_5x, hit_10x, rugged_1h, never_moved, peak_p50_s, peak_p75_s, slow_2x, held_up, launched_from, launched_to) values (${[b['signal'], b['band'], b['score_from'], b['score_to'], b['launches'], h[0], h[1], h[2], h[3], b['rugged_1h'], b['never_moved'], b['peak_p50_s'], b['peak_p75_s'], b['slow_2x'], b['held_up'], window.launched_from, window.launched_to].map(lit).join(', ')});`;
    }),
    ...out.badges.map((b) => `insert into public.launch_odds_badge (fact, signal, value_from, value_to, tone, launches, hit_2x, rugged_1h, usual_value, share_at_least) values (${[b['fact'], b['signal'], b['value_from'], b['value_to'], b['tone'], b['launches'], b['hit_2x'], b['rugged_1h'], b['usual_value'], b['share_at_least']].map(lit).join(', ')});`),
    'commit;',
  ].join('\n');
  writeFileSync(join(DIR, 'bands.sql'), sql + '\n');
  console.log(`\nWrote ${join(DIR, 'bands.json')} and bands.sql (${out.bands.length} bands, ${out.badges.length} badges).`);
  if (process.argv.includes('--write')) {
    if (pool === null) throw new Error('--write needs DATABASE_URL');
    if (!existsSync(join(DIR, 'bands.sql'))) throw new Error('no bands.sql');
    await pool.query(sql);
    console.log('Replaced public.launch_odds and public.launch_odds_badge.');
  }
} finally {
  await pool?.end();
}
