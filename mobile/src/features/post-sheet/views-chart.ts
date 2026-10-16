/**
 * THE POST SHEET'S VIEWS CHART, AS DECISIONS: what the chart draws for one interval (1m to 1D) in
 * either view, Total views (a line) or Views gained (bars, one per interval, as a coin chart's
 * volume), and the Per minute pill's number. Apart from ViewsChart.tsx so `node --test` holds them.
 *
 * ★ EVERY MARK IS ONE OF OUR OWN READINGS, OR THE DIFFERENCE BETWEEN TWO OF THEM. Nothing is
 * interpolated into a time we did not read:
 *
 *   - THE SPAN is from when the post went up to now. Never before the post; when the post's time is
 *     unknown, from our first reading.
 *   - TOTAL: per interval, the last counted reading in it, drawn at the time it was taken. The line
 *     BREAKS where two drawn readings are more than 3x the expected spacing apart, the expected
 *     spacing being the interval or the readings' usual (median) spacing, whichever is longer. So an
 *     outage shows as a gap, and the normal few minutes between readings never does. A reading the
 *     source rounded away (null) is stepped over, as before (the owner's call): it is not a gap.
 *   - BEFORE THE FIRST COUNT there are no readings. That stretch is a dashed line from 0 at posting
 *     (a post starts with no views) to the first counted reading, labelled, never drawn as data.
 *   - GAINED: an interval's bar is its last counted reading minus the last counted reading before
 *     it, and only when that earlier reading is in the interval just before. The post's own start
 *     counts as a reading of 0 (every post starts there), so the first interval has a bar. An interval with no
 *     reading has no bar, and when readings are further apart than an interval the gain between
 *     them is spread over several intervals we cannot split, so it is shown as missing rather than
 *     piled onto one bar.
 *   - PER MINUTE: the newest counted reading against the newest one at least a minute before it,
 *     divided by the minutes between them, and said with that span ("last 9m"), or with the time it
 *     ends at when the newest reading is more than five minutes old.
 *
 * What breaks if changed carelessly: the adjacency rule on bars. Dropping it makes a 40-minute
 * outage one tall bar, a spike that never happened.
 */

import { compact } from '../../shared/format/number.ts';
import type { Reading } from './sheet-view.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
export type Interval = (typeof INTERVALS)[number];
export const INTERVAL_MS: Readonly<Record<Interval, number>> = { '1m': MINUTE, '5m': 5 * MINUTE, '15m': 15 * MINUTE, '1h': HOUR, '4h': 4 * HOUR, '1D': 24 * HOUR };
export type ViewsMode = 'total' | 'gained';

/** How many expected spacings apart two drawn readings may be before the line breaks. */
export const BREAK_AFTER = 3;
/** The shortest span the Per minute pill is measured over. */
export const PER_MINUTE_MIN_MS = MINUTE;
/** Newer than this, the Per minute span is "last 9m"; older, it says when it ends. */
export const PER_MINUTE_FRESH_MS = 5 * MINUTE;
/** The most labelled steps the y axis is cut into. */
const MAX_STEPS = 3;

export interface ViewsPoint {
  readonly at: number;
  readonly value: number;
}

export interface GainBar {
  /** The interval: [start, end). */
  readonly start: number;
  readonly end: number;
  readonly gain: number;
  /** The two readings the gain is between. */
  readonly fromAt: number;
  readonly toAt: number;
}

export interface ViewsPlan {
  readonly from: number;
  readonly to: number;
  /** True when `from` is the post's own time. */
  readonly fromPosted: boolean;
  /** Total: unbroken runs of drawn readings. */
  readonly runs: readonly (readonly ViewsPoint[])[];
  /** Gained: one bar per interval we can say. */
  readonly bars: readonly GainBar[];
  /** The dashed stretch from 0 at posting to the first counted reading; null when the post's time is unknown. */
  readonly before: { readonly from: ViewsPoint; readonly to: ViewsPoint; readonly label: string } | null;
  /** The y axis, bottom to top, in clean steps. */
  readonly ticks: readonly number[];
  readonly markers: readonly { readonly kind: 'found' | 'coin'; readonly at: number }[];
  /** The newest counted reading. */
  readonly last: ViewsPoint;
  /** Why Gained has no bar at this interval, when it has none. */
  readonly noBars: string | null;
}

function counted(readings: readonly Reading[]): ViewsPoint[] {
  return readings
    .filter((r): r is { atMs: number; value: number } => r.value !== null)
    .map((r) => ({ at: r.atMs, value: r.value }))
    .sort((a, b) => a.at - b.at);
}

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** 0 up to past `hi` (and down past `lo` when below 0) in at most three steps of 1, 2, 2.5 or 5 times a power of ten. */
export function cleanTicks(lo: number, hi: number): number[] {
  const low = Math.min(0, lo);
  const high = Math.max(0, hi);
  if (high - low <= 0) return [0, 1];
  const raw = (high - low) / MAX_STEPS;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => Math.ceil(high / s) - Math.floor(low / s) <= MAX_STEPS) ?? 10 * p);
  const ticks: number[] = [];
  for (let v = Math.floor(low / step) * step; v <= Math.ceil(high / step) * step + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Which interval a time falls in, counted from the start of the span. */
const slot = (at: number, from: number, size: number) => Math.floor((at - from) / size);

export function viewsPlan(
  readings: readonly Reading[],
  postedAt: number | null,
  now: number,
  interval: Interval,
  mode: ViewsMode,
  marks: { readonly found: number | null; readonly coin: number | null },
): ViewsPlan | null {
  const all = counted(readings);
  const first = all[0];
  const last = all[all.length - 1];
  if (first === undefined || last === undefined) return null;
  const fromPosted = postedAt !== null && postedAt <= first.at;
  const from = fromPosted ? postedAt : first.at;
  const to = Math.max(now, last.at);
  if (to <= from) return null;
  const size = INTERVAL_MS[interval];

  /* Total: the last counted reading in each interval. */
  const lastIn = new Map<number, ViewsPoint>();
  for (const r of all) lastIn.set(slot(r.at, from, size), r);
  const drawn = [...lastIn.values()].sort((a, b) => a.at - b.at);
  const usual = median(all.slice(1).map((r, i) => r.at - (all[i]?.at ?? r.at))) ?? 0;
  const gapLimit = BREAK_AFTER * Math.max(size, usual);
  const runs: ViewsPoint[][] = [];
  for (const p of drawn) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run === undefined || prev === undefined || p.at - prev.at > gapLimit) runs.push([p]);
    else run.push(p);
  }

  /* Gained: the interval's last reading against the last one before it, in the interval just before.
     The post's own start counts as a reading of 0, so the first interval has a bar too. */
  const bars: GainBar[] = [];
  const posted = fromPosted ? [{ at: from, value: 0 }] : [];
  for (const [k, end] of lastIn) {
    const start = from + k * size;
    const before = k === 0 ? posted[0] : [...posted, ...all].filter((r) => r.at < start).pop();
    if (before === undefined || before.at < start - size || before.at >= end.at) continue;
    bars.push({ start, end: start + size, gain: end.value - before.value, fromAt: before.at, toAt: end.at });
  }
  bars.sort((a, b) => a.start - b.start);

  const ticks =
    mode === 'total'
      ? cleanTicks(0, Math.max(...all.map((r) => r.value)))
      : cleanTicks(Math.min(0, ...bars.map((b) => b.gain)), Math.max(0, ...bars.map((b) => b.gain)));

  const before = fromPosted
    ? {
        from: { at: from, value: 0 },
        to: first,
        /* Found well before our first count (the first readings rounded away): the dashed part is
           before our first count, not before we found it. */
        label: marks.found !== null && marks.found < first.at - 2 * MINUTE ? 'before our first count' : 'before we found it',
      }
    : null;

  const markers = (['found', 'coin'] as const).flatMap((kind) => {
    const at = marks[kind];
    return at !== null && at >= from && at <= to ? [{ kind, at }] : [];
  });

  const noBars = bars.length > 0 ? null : !fromPosted && to - from < 2 * size ? `Not enough readings yet for ${interval} bars` : `Our readings are too far apart for ${interval} bars`;

  return { from, to, fromPosted, runs, bars, before, ticks, markers, last, noBars };
}

/** The drawn reading nearest a time, for the finger: Total's line. */
export function nearestPoint(plan: ViewsPlan, at: number): ViewsPoint | null {
  let best: ViewsPoint | null = null;
  for (const run of plan.runs) for (const p of run) if (best === null || Math.abs(p.at - at) < Math.abs(best.at - at)) best = p;
  return best;
}

/** The bar under the finger, else the nearest one: Gained's bars. */
export function nearestBar(plan: ViewsPlan, at: number): GainBar | null {
  let best: GainBar | null = null;
  const d = (b: GainBar) => (at >= b.start && at < b.end ? 0 : Math.min(Math.abs(at - b.start), Math.abs(at - b.end)));
  for (const b of plan.bars) if (best === null || d(b) < d(best)) best = b;
  return best;
}

/** "17:05", with the day ahead of it ("Thu 17:05") when the span runs past a day. */
export function clockText(at: number, longSpan: boolean): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return longSpan ? `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}` : hm;
}

/** "9m", "2h 5m": the span between two readings. */
export function spanText(ms: number): string {
  const m = Math.max(1, Math.round(ms / MINUTE));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

export interface PerMinute {
  /** Views gained a minute. */
  readonly rate: number;
  /** "+3.1K/min". */
  readonly text: string;
  /** What span it covers: "last 9m", or "9m to 18:24" when that span ended a while ago. */
  readonly over: string;
}

export function perMinute(readings: readonly Reading[], now: number): PerMinute | null {
  const all = counted(readings);
  const newest = all[all.length - 1];
  if (newest === undefined) return null;
  const back = all.filter((r) => r.at <= newest.at - PER_MINUTE_MIN_MS).pop();
  if (back === undefined) return null;
  const ms = newest.at - back.at;
  const rate = (newest.value - back.value) / (ms / MINUTE);
  const fresh = now - newest.at <= PER_MINUTE_FRESH_MS;
  return {
    rate,
    text: `${rate >= 0 ? '+' : ''}${compact(Math.round(rate))}/min`,
    over: fresh ? `last ${spanText(ms)}` : `${spanText(ms)} to ${clockText(newest.at, now - newest.at > 20 * HOUR)}`,
  };
}
