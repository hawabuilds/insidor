/**
 * THE VIEWS-GAINED CHART, AS DECISIONS — the one chart on the narrative page and on the post sheet
 * (the owner's design of 2026-10-17): views gained per interval as one line, the First found / Found
 * and coin markers at their exact times, the three times along the bottom, and the words the fact
 * line says about who was first. Apart from GainChart.tsx so `node --test` holds the rules.
 *
 * ★ THE GAIN RULE IS THE PROJECTOR'S (core group/narrative.ts `narrativeReach`), repeated here for
 * one post because the post sheet has the post's own readings and the narrative page has the
 * projector's sum. A post's gain between two of its readings is spread evenly over the time between
 * them; before its first reading and after its last it adds nothing. That is the increment between
 * two real readings shared out over the minutes it happened in, never a point we did not read: so a
 * post found late has no spike at the moment we found it, and a sparse TikTok reading is a slope.
 * A lower reading than the one before adds nothing (the source re-counting, not views lost).
 *
 * ★ SLOTS, THEN INTERVALS. Everything is five-minute slots first (`SLOT_MS`, the projector's step),
 * then added up into the chosen interval, buckets ending at the series' end (now). A bucket is
 * null, a gap in the line, only when no slot in it was being read at all (an outage, or before
 * anything was read); a bucket some posts were read in is their sum, the owner's rule ("after its
 * last reading a post adds nothing"). The newest bucket is the end label and the fact line's
 * "Last 15m", so the two always agree.
 *
 * ★ TIMES ARE THE PROOF, so they are exact: markers sit at their own instant, never snapped to a
 * bucket; a launch is printed to the minute only from the chain's own clock, or from the live
 * notice when its few seconds either side stay inside one minute (else both minutes are said);
 * a launch whose clock is not known is said as not known, with no line. "Found Xm before" is said
 * only when the find is before the earliest the coin can have been made; "Coin was Xm before we
 * found it" when the coin is before the earliest the find can be; within the bound, neither is
 * claimed. Minutes are cut down, never rounded up, so "before" is never overstated.
 *
 * What breaks if changed carelessly: putting a post's first reading in as a gain from 0 brings
 * back the late-found spike the owner asked to be rid of.
 */

import type { LaunchClock } from '../../shared/api/post-sheet.ts';
import { compact } from '../../shared/format/number.ts';
import type { Reading } from './sheet-view.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The finest slot: the projector's step and the chart's shortest interval. */
export const SLOT_MS = 5 * MINUTE;

export const GAIN_INTERVALS = ['5m', '15m', '1h', '4h', '1D'] as const;
export type GainInterval = (typeof GAIN_INTERVALS)[number];
export const GAIN_INTERVAL_MS: Readonly<Record<GainInterval, number>> = { '5m': 5 * MINUTE, '15m': 15 * MINUTE, '1h': HOUR, '4h': 4 * HOUR, '1D': DAY };
/**
 * The narrative page's intervals: the five above and "All", the whole story from its first post to
 * now (the owner, 2026-10-17). "All" draws the projector's coarser series (half-hours from its first
 * reading) when it has one, so a story older than a day is drawn whole.
 */
export const CHART_INTERVALS = [...GAIN_INTERVALS, 'All'] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

/** All's bucket: the finest of half an hour, 1h, 2h or 4h that keeps the line to `ALL_MAX_BUCKETS` points. */
const ALL_MAX_BUCKETS = 48;
export function allBucketMs(spanMs: number, stepMs: number): number {
  const fit = [30 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR].filter((b) => b >= stepMs).find((b) => spanMs / b <= ALL_MAX_BUCKETS);
  return fit ?? 4 * HOUR;
}

/** "Last 15m", "Last hour", "Last day". */
export const LAST_WORDS: Readonly<Record<GainInterval, string>> = { '5m': 'Last 5m', '15m': 'Last 15m', '1h': 'Last hour', '4h': 'Last 4h', '1D': 'Last day' };

/** Views gained in each slot from `fromMs`; null where nothing was being read. */
export interface GainSlots {
  readonly fromMs: number;
  readonly stepMs: number;
  readonly values: readonly (number | null)[];
}

export interface GainBucket {
  readonly start: number;
  readonly end: number;
  readonly value: number | null;
}

/** One post's slots from its own readings, ending at `now`: the projector's rule (see the header). */
export function postSlots(readings: readonly Reading[], now: number, stepMs: number = SLOT_MS): GainSlots | null {
  const pts = readings.filter((r): r is { atMs: number; value: number } => r.value !== null && r.atMs <= now).sort((a, b) => a.atMs - b.atMs);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first === undefined || last === undefined) return null;
  const count = Math.ceil((now - first.atMs) / stepMs) || 1;
  const fromMs = now - count * stepMs;
  const values: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    const a = fromMs + i * stepMs;
    const b = a + stepMs;
    if (last.atMs < a || first.atMs >= b) {
      values.push(null);
      continue;
    }
    let sum = 0;
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1];
      const q = pts[k];
      if (p === undefined || q === undefined || q.atMs <= p.atMs) continue;
      const overlap = Math.min(q.atMs, b) - Math.max(p.atMs, a);
      if (overlap > 0) sum += (Math.max(0, q.value - p.value) * overlap) / (q.atMs - p.atMs);
    }
    values.push(Math.round(sum));
  }
  return { fromMs, stepMs, values };
}

/**
 * The slots added up into `intervalMs` buckets ending at the slots' end, from `since` on (a bucket
 * that ends at or before it is dropped). A bucket is null only when every slot in it is.
 */
export function buckets(slots: GainSlots, intervalMs: number, since: number | null = null): GainBucket[] {
  const end = slots.fromMs + slots.values.length * slots.stepMs;
  const per = Math.max(1, Math.round(intervalMs / slots.stepMs));
  const size = per * slots.stepMs;
  const out: GainBucket[] = [];
  for (let e = end; e > slots.fromMs; e -= size) {
    const s = e - size;
    if (since !== null && e <= since) break;
    let sum = 0;
    let read = false;
    for (let t = Math.max(s, slots.fromMs); t < e; t += slots.stepMs) {
      const v = slots.values[Math.round((t - slots.fromMs) / slots.stepMs)];
      if (v === null || v === undefined) continue;
      read = true;
      sum += v;
    }
    out.push({ start: s, end: e, value: read ? sum : null });
  }
  return out.reverse();
}

/** The newest bucket's gain at this interval: the end label and the fact line's "Last 15m". */
export function lastGain(slots: GainSlots | null, interval: GainInterval): number | null {
  if (slots === null) return null;
  const all = buckets(slots, GAIN_INTERVAL_MS[interval]);
  return all[all.length - 1]?.value ?? null;
}

/** "+420K". */
export const plus = (n: number): string => `${n >= 0 ? '+' : ''}${compact(n)}`;

/** "14:22" today, "Thu 14:22" on another day: the user's own clock, to the minute. */
export function hm(at: number, now: number): string {
  const d = new Date(at);
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return new Date(now).toDateString() === d.toDateString() ? t : `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${t}`;
}

/** A coin's launch as the screens may print it: the minute (or the two it may be in), or not known. */
export type LaunchTime =
  | { readonly kind: 'at'; readonly at: number; readonly earliest: number; readonly latest: number; readonly text: string }
  | { readonly kind: 'unknown' };

export function launchTime(at: number | null, clock: LaunchClock, now: number): LaunchTime {
  if (at === null || clock.kind === 'unknown') return { kind: 'unknown' };
  const b = clock.kind === 'within' ? clock.withinS * 1000 : 0;
  const lo = hm(at - b, now);
  const hi = hm(at + b, now);
  return { kind: 'at', at, earliest: at - b, latest: at + b, text: lo === hi ? lo : `${lo} to ${hi}` };
}

/** "40s", "2m", "1h 5m", "49d 22h" past two days: cut down, never rounded up. */
export function gapText(ms: number): string {
  if (ms < MINUTE) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / MINUTE);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (ms >= 2 * DAY) return h % 24 === 0 ? `${Math.floor(h / 24)}d` : `${Math.floor(h / 24)}d ${h % 24}h`;
  return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
}

/**
 * Who was first, in words: "Found 58m before $GTA", "Coin was 6m before we found it", or null when
 * either time is missing or the find sits inside the coin's few seconds of doubt.
 */
export function firstWords(found: number | null, launch: LaunchTime, ticker: string): { readonly lead: string; readonly gap: string; readonly tail: string } | null {
  if (found === null || launch.kind !== 'at') return null;
  if (found < launch.earliest) return { lead: 'Found', gap: `${gapText(launch.earliest - found)} before`, tail: ticker };
  if (found > launch.latest) return { lead: 'Coin was', gap: `${gapText(found - launch.latest)} before`, tail: 'we found it' };
  return null;
}

/* ── layout ───────────────────────────────────────────────────────────── */

/** A pill's width, estimated from its text at 12px semibold, before it renders. */
const PILL_CHAR = 6.9;
const PILL_PAD = 22;
const PILL_GAP = 6;

export interface PillIn {
  readonly key: string;
  readonly text: string;
  /** Its x on the plot, or null for a launch whose time is not known (no line). */
  readonly x: number | null;
}

export interface PillOut extends PillIn {
  readonly left: number;
  readonly width: number;
  readonly row: number;
}

/**
 * The marker pills placed over their lines, each in the first row where it overlaps nothing: a
 * second pill that would cover the first goes on the row below it, never hidden (the owner's rule).
 */
export function placePills(pills: readonly PillIn[], width: number): PillOut[] {
  const rows: { left: number; right: number }[][] = [];
  return pills.map((p) => {
    const w = Math.ceil(p.text.length * PILL_CHAR + PILL_PAD);
    const centre = p.x ?? w / 2;
    const left = Math.max(0, Math.min(width - w, centre - w / 2));
    let row = 0;
    while ((rows[row] ?? []).some((o) => left < o.right + PILL_GAP && left + w + PILL_GAP > o.left)) row += 1;
    (rows[row] ??= []).push({ left, right: left + w });
    return { ...p, left, width: w, row };
  });
}

/**
 * One smooth path through points, monotone between them (Fritsch–Carlson), so the line never bulges
 * above a peak or below zero between two readings, which a plain curve would draw as views nobody had.
 */
export function smoothPath(pts: readonly { readonly x: number; readonly y: number }[]): string {
  const n = pts.length;
  const p0 = pts[0];
  if (p0 === undefined) return '';
  if (n === 1) return `M${p0.x - 2},${p0.y}L${p0.x + 2},${p0.y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i] ?? p0;
    const b = pts[i + 1] ?? p0;
    dx.push(b.x - a.x);
    m.push(b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x));
  }
  const t: number[] = [m[0] ?? 0];
  for (let i = 1; i < n - 1; i++) {
    const a = m[i - 1] ?? 0;
    const b = m[i] ?? 0;
    t.push(a * b <= 0 ? 0 : (3 * ((dx[i - 1] ?? 0) + (dx[i] ?? 0))) / ((2 * (dx[i] ?? 0) + (dx[i - 1] ?? 0)) / a + ((dx[i] ?? 0) + 2 * (dx[i - 1] ?? 0)) / b));
  }
  t.push(m[n - 2] ?? 0);
  let d = `M${p0.x.toFixed(1)},${p0.y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i] ?? p0;
    const b = pts[i + 1] ?? p0;
    const h = (dx[i] ?? 0) / 3;
    d += `C${(a.x + h).toFixed(1)},${(a.y + h * (t[i] ?? 0)).toFixed(1)} ${(b.x - h).toFixed(1)},${(b.y - h * (t[i + 1] ?? 0)).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }
  return d;
}

/** The sparkline's interval on a Narratives card: the coarsest that still gives eight points. */
export function sparkInterval(slots: GainSlots): number {
  const span = slots.values.length * slots.stepMs;
  return [HOUR, 15 * MINUTE, 5 * MINUTE].find((i) => span / i >= 8) ?? SLOT_MS;
}
