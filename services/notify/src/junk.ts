/**
 * THE OWNER'S NOT-A-MEME ALARM: a push when his "Not a meme" taps per 100 For You posts shown go
 * clearly above his usual level, and one when they are back — never once a pass. The owner,
 * 2026-10-16: "alert me if my Not a meme taps per 100 shown go clearly above today's level."
 *
 * ★ WHAT IS COUNTED. Every JUNK_LOOP_MS (5 min): the For You posts first shown in the last
 * JUNK_WINDOW_MS (3 hours), and how many of them his current call on is "Not a meme" (the newest
 * row per post in internal.owner_feedback, so a post he took back is not counted). Against the
 * same count over the JUNK_BASELINE_MS (3 days) before that window. Both are per 100 posts shown.
 *
 *   Why the posts shown, and not the taps made, in the window: he taps in sessions, often on posts
 *   shown hours before. Counted as taps made in the window over posts shown in it, Wednesday to
 *   Friday would have pushed up five times, each catch-up session reading as junk. Counted per post
 *   shown, a catch-up session raises the rate of the hours it reviews, which is the question asked:
 *   how much of what reached For You was not a meme.
 *
 *   Why a rolling 3-day baseline, not a fixed number with today's date: a fixed line goes stale the
 *   first time the judge is retuned (twice a day), and then either fires every session or never.
 *   The 3 days before the window move with him. Measured at 19:40 UTC on 2026-10-16 it was 442 of
 *   973 posts, 45 per 100 — the same as today counted with all of today's taps (172 taps on 376
 *   posts shown, 46 per 100); today's same-day-only count is 134 of 376, 36 per 100, lower because
 *   posts he reviews the next morning are not in it yet.
 *
 * ★ THE RULE, so a quiet hour can never fire it and an absent owner can never clear it:
 *
 *   no claim  unless he made a post call in the last JUNK_ACTIVE_MS (30 min), the window has at
 *             least JUNK_MIN_SHOWN (20) posts shown and at least one Not a meme tap, and the
 *             baseline has at least JUNK_MIN_BASELINE_SHOWN (100) posts with a rate above 0. A
 *             window he has not looked at reads low only because he has not tapped yet; it says
 *             nothing either way, so the state is kept.
 *   up        at least JUNK_MIN_TAPS (10) Not a meme taps in the window AND the window's rate at
 *             least JUNK_UP_RATIO (1.5×) the baseline's.
 *   back      while up, the window's rate below JUNK_BACK_RATIO (1.2×) the baseline's. The gap
 *             between 1.2 and 1.5 is what stops a rate sitting at the line from pushing every
 *             five minutes.
 *
 * Replayed over every post and call from Wednesday to Friday 19:40 UTC (junk.test.ts): up once,
 * Wednesday 22:40 UTC (17 of 25 posts, 68 per 100, against 44), back Thursday 00:55 UTC (16 of 32,
 * 50 per 100). His Friday 17:00 session peaks at 62 per 100 (39 of 63, against 45: 1.38×) and does not fire.
 *
 * ★ ONCE, ACROSS RESTARTS TOO. The up push's subject is `junk|<minute it went up>`, its back push
 * `junk|back|<same>`. On its first pass this reads the newest junk claim (people.alert_claim): an up
 * with no back after it means it is still up, so a restart neither repeats the up nor forgets to say
 * back. A state change is kept only after its push is queued, so a failed queue is tried again.
 *
 * Pushed as kind 'outage' (the owner's alarms: always on, past the hourly limit), not a new kind:
 * a new kind would need a switch, the phone's list split and the core list changed for one alert
 * only the owner gets. The text says what it is (text.ts, what 'junk').
 *
 * ★ THRESHOLDS ARE HERE, NOT IN POLICY, as for the outage alarm (alarm.ts): nothing else reads them.
 *
 * What breaks if changed carelessly: counting taps made in the window instead of posts shown in it
 * (the flapping above), or dropping the activity gate — a night with nobody tapping would read as
 * a clean feed and say "back" for a feed that was never looked at.
 */

import { queue, type Db } from './deliver.ts';
import type { Facts } from './text.ts';

/** How often the alarm looks. */
export const JUNK_LOOP_MS = 5 * 60_000;
/** The posts first shown this long ago or less are the window... */
export const JUNK_WINDOW_MS = 3 * 60 * 60_000;
/** ...and the posts shown in this long before the window are the baseline. */
export const JUNK_BASELINE_MS = 3 * 24 * 60 * 60_000;
/** A post call (either verdict) this recent: he is tapping now. */
export const JUNK_ACTIVE_MS = 30 * 60_000;
/** Fewer posts shown in the window than this: too few to say. */
export const JUNK_MIN_SHOWN = 20;
/** Fewer Not a meme taps in the window than this never fires, whatever the rate. */
export const JUNK_MIN_TAPS = 10;
/** A baseline over fewer posts than this (a new database) is no baseline. */
export const JUNK_MIN_BASELINE_SHOWN = 100;
/** Up at this multiple of the baseline rate or more... */
export const JUNK_UP_RATIO = 1.5;
/** ...and back only below this one. */
export const JUNK_BACK_RATIO = 1.2;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export interface ShownPost {
  readonly id: string;
  readonly shownMs: number;
}
export interface PostCall {
  readonly id: string;
  readonly verdict: string;
  readonly atMs: number;
}

export interface JunkCounts {
  readonly window: { readonly shown: number; readonly taps: number };
  readonly baseline: { readonly shown: number; readonly taps: number };
  /** His newest post call at or before now; null when none. */
  readonly lastCallMs: number | null;
}

/** The two counts as of `nowMs`. Pure: a call after now is not seen, a post's current call is its newest. */
export function junkCounts(posts: readonly ShownPost[], calls: readonly PostCall[], lastCallMs: number | null, nowMs: number): JunkCounts {
  const current = new Map<string, { verdict: string; atMs: number }>();
  for (const c of calls) {
    if (c.atMs > nowMs) continue;
    const was = current.get(c.id);
    if (was === undefined || c.atMs >= was.atMs) current.set(c.id, { verdict: c.verdict, atMs: c.atMs });
  }
  const windowFrom = nowMs - JUNK_WINDOW_MS;
  const baselineFrom = windowFrom - JUNK_BASELINE_MS;
  const window = { shown: 0, taps: 0 };
  const baseline = { shown: 0, taps: 0 };
  for (const p of posts) {
    if (p.shownMs > nowMs || p.shownMs < baselineFrom) continue;
    const into = p.shownMs >= windowFrom ? window : baseline;
    into.shown += 1;
    if (current.get(p.id)?.verdict === 'not') into.taps += 1;
  }
  return { window, baseline, lastCallMs: lastCallMs !== null && lastCallMs <= nowMs ? lastCallMs : null };
}

export interface JunkReading {
  /** At or over the up line (with enough taps), under the back line, or between them. */
  readonly level: 'up' | 'between' | 'normal';
  readonly facts: Facts;
}

const per100 = (taps: number, shown: number): number => (100 * taps) / shown;

/** The reading, or null when it makes no claim either way (the header's "no claim"). */
export function junkReading(c: JunkCounts, nowMs: number): JunkReading | null {
  if (c.lastCallMs === null || nowMs - c.lastCallMs > JUNK_ACTIVE_MS) return null;
  if (c.window.shown < JUNK_MIN_SHOWN || c.window.taps === 0) return null;
  if (c.baseline.shown < JUNK_MIN_BASELINE_SHOWN || c.baseline.taps === 0) return null;
  const rate = per100(c.window.taps, c.window.shown);
  const base = per100(c.baseline.taps, c.baseline.shown);
  const level = c.window.taps >= JUNK_MIN_TAPS && rate >= JUNK_UP_RATIO * base ? 'up' : rate < JUNK_BACK_RATIO * base ? 'normal' : 'between';
  return {
    level,
    facts: {
      what: 'junk',
      taps: c.window.taps,
      shown: c.window.shown,
      per100: Math.round(rate),
      baselinePer100: Math.round(base),
      windowHours: Math.round(JUNK_WINDOW_MS / HOUR_MS),
      baselineDays: Math.round(JUNK_BASELINE_MS / DAY_MS),
    },
  };
}

export interface JunkEvent {
  readonly state: 'down' | 'back';
  readonly subject: string;
  readonly facts: Facts;
}

/** The mark of the up it is in (the minute it went up), or null. */
export type JunkState = string | null;

/** One pass's transition. Pure. No reading keeps the state as it was. */
export function stepJunk(state: JunkState, reading: JunkReading | null, nowMs: number): { readonly next: JunkState; readonly event: JunkEvent | null } {
  if (reading === null) return { next: state, event: null };
  if (state === null) {
    if (reading.level !== 'up') return { next: null, event: null };
    const mark = new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString();
    return { next: mark, event: { state: 'down', subject: `junk|${mark}`, facts: { ...reading.facts, state: 'down' } } };
  }
  if (reading.level !== 'normal') return { next: state, event: null };
  return { next: null, event: { state: 'back', subject: `junk|back|${state}`, facts: { ...reading.facts, state: 'back' } } };
}

/* ── the database and the queue around it ─────────────────────────────── */

export interface JunkMemory {
  state: JunkState;
  /** The state was read back from the newest junk claim (once, on the first pass). */
  restored: boolean;
}

export const junkMemory = (): JunkMemory => ({ state: null, restored: false });

export interface JunkDeps {
  readonly db: Db;
  readonly now: () => number;
  /** Policy.owner.wallets: whose taps and whose phone. */
  readonly ownerWallets: readonly string[];
  readonly log: (level: 'info' | 'error', msg: string, fields?: Record<string, unknown>) => void;
}

const toMs = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : null);

/** One pass: read, step, queue. Returns how many alerts were queued. A failed read throws (the loop logs it). */
export async function checkJunk(deps: JunkDeps, mem: JunkMemory): Promise<number> {
  if (deps.ownerWallets.length === 0) return 0;
  const now = deps.now();
  const owners = (await deps.db.query<{ userId: string }>('select user_id as "userId" from people.profile where wallet = any($1::text[])', [[...deps.ownerWallets]])).map((o) => o.userId);
  if (owners.length === 0) return 0;
  if (!mem.restored) {
    const [last] = await deps.db.query<{ subject: string }>(`select subject from people.alert_claim where user_id = any($1::text[]) and kind = 'outage' and subject like 'junk|%' order by claimed_at desc limit 1`, [owners]);
    mem.state = last === undefined || last.subject.startsWith('junk|back|') ? null : last.subject.slice('junk|'.length);
    mem.restored = true;
  }
  const from = new Date(now - JUNK_WINDOW_MS - JUNK_BASELINE_MS);
  const shown = await deps.db.query<{ id: string; at: unknown }>(`select item_id as id, first_shown_at as at from public.feed_post where feed_id = 'fyp' and first_shown_at >= $1 and first_shown_at <= $2`, [from, new Date(now)]);
  const posts = shown.flatMap((r) => {
    const ms = toMs(r.at);
    return ms === null ? [] : [{ id: r.id, shownMs: ms }];
  });
  const rows = posts.length === 0 ? [] : await deps.db.query<{ id: string; verdict: string; at: unknown }>(`select item_id as id, verdict, created_at as at from internal.owner_feedback where subject_kind = 'post' and item_id = any($1::text[]) and created_at <= $2`, [posts.map((p) => p.id), new Date(now)]);
  const calls = rows.flatMap((r) => {
    const ms = toMs(r.at);
    return ms === null ? [] : [{ id: r.id, verdict: r.verdict, atMs: ms }];
  });
  const [last] = await deps.db.query<{ at: unknown }>(`select max(created_at) as at from internal.owner_feedback where subject_kind = 'post' and created_at <= $1`, [new Date(now)]);
  const reading = junkReading(junkCounts(posts, calls, toMs(last?.at), now), now);
  const { next, event } = stepJunk(mem.state, reading, now);
  if (event === null) {
    mem.state = next;
    return 0;
  }
  deps.log('info', event.state === 'down' ? 'not a meme alarm: up' : 'not a meme alarm: back', { subject: event.subject, ...event.facts });
  for (const userId of owners) await queue(deps.db, { userId, kind: 'outage', subject: event.subject, rung: 0, facts: event.facts, href: '/#/alerts' });
  /* Kept only now: a queue that threw above leaves the state as it was, to try again next pass. */
  mem.state = next;
  return owners.length;
}
