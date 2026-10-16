/** The owner's Not-a-meme alarm: Wednesday to Friday replayed from the database, up once and back once; quiet hours and an absent owner never fire or clear; a restart repeats nothing. */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { Db } from './deliver.ts';
import { checkJunk, JUNK_LOOP_MS, junkCounts, junkMemory, junkReading, stepJunk, type JunkCounts, type JunkState, type PostCall, type ShownPost } from './junk.ts';
import { alertText } from './text.ts';

const MIN = 60_000;
const fixture = JSON.parse(readFileSync(new URL('./junk.fixture.json', import.meta.url), 'utf8')) as { from: string; until: string; posts: [number, number][]; calls: [number, number, number][] };
const FROM = Date.parse(fixture.from);
const UNTIL = Date.parse(fixture.until);
const POSTS: ShownPost[] = fixture.posts.map(([id, s]) => ({ id: String(id), shownMs: FROM + s * 1000 }));
const CALLS: PostCall[] = fixture.calls.map(([id, v, s]) => ({ id: String(id), verdict: v === 0 ? 'not' : 'meme', atMs: FROM + s * 1000 }));
const lastCallAt = (now: number): number | null => CALLS.reduce<number | null>((m, c) => (c.atMs <= now && (m === null || c.atMs > m) ? c.atMs : m), null);
const countsAt = (now: number): JunkCounts => junkCounts(POSTS, CALLS, lastCallAt(now), now);
const hhmm = (ms: number): string => new Date(ms).toISOString().slice(5, 16);

test('★ Wednesday to Friday replayed every five minutes: up once on Wednesday night, back once after midnight, nothing else', () => {
  let state: JunkState = null;
  const events: string[] = [];
  let fridayPeak = 0;
  for (let now = Date.parse('2026-10-14T00:00:00Z'); now <= UNTIL; now += JUNK_LOOP_MS) {
    const r = junkReading(countsAt(now), now);
    if (now >= Date.parse('2026-10-16T16:00:00Z') && r !== null) fridayPeak = Math.max(fridayPeak, Number(r.facts['per100']));
    const s = stepJunk(state, r, now);
    state = s.next;
    if (s.event !== null) events.push(`${s.event.state} ${hhmm(now)} ${s.event.facts['taps']}/${s.event.facts['shown']} ${s.event.facts['per100']} vs ${s.event.facts['baselinePer100']}`);
  }
  assert.deepEqual(events, ['down 10-14T22:40 17/25 68 vs 44', 'back 10-15T00:55 16/32 50 vs 45']);
  assert.ok(fridayPeak < 68, `Friday evening's session (peak ${fridayPeak} per 100) stays under 1.5x`);
});

test("today's numbers: the rolling baseline at the end of the data, and today's levels both ways", () => {
  const c = countsAt(UNTIL);
  assert.equal(Math.round((100 * c.baseline.taps) / c.baseline.shown), 45);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = POSTS.filter((p) => day(p.shownMs) === '2026-10-16');
  const firstNot = new Map<string, number>();
  for (const k of CALLS) if (k.verdict === 'not' && !firstNot.has(k.id)) firstNot.set(k.id, k.atMs);
  const sameDay = today.filter((p) => firstNot.has(p.id) && day(firstNot.get(p.id)!) === '2026-10-16').length;
  assert.equal(today.length, 376);
  assert.equal(sameDay, 134, 'same-day posts tapped the same day: 36 per 100');
});

const counts = (w: [number, number], b: [number, number], lastCallMs: number | null): JunkCounts => ({ window: { taps: w[0], shown: w[1] }, baseline: { taps: b[0], shown: b[1] }, lastCallMs });
const T = Date.parse('2026-10-16T18:00:00Z');

test('★ no claim either way: owner not tapping, too few shown, no taps, no baseline', () => {
  const base: [number, number] = [450, 1000];
  assert.equal(junkReading(counts([30, 40], base, T - 31 * MIN), T), null, 'last call over 30 minutes ago');
  assert.equal(junkReading(counts([30, 40], base, null), T), null, 'never tapped');
  assert.equal(junkReading(counts([15, 19], base, T), T), null, 'under 20 shown');
  assert.equal(junkReading(counts([0, 60], base, T), T), null, 'no Not a meme tap in the window');
  assert.equal(junkReading(counts([30, 40], [20, 99], T), T), null, 'a baseline under 100 posts');
  /* So an up stays up through a night with nobody tapping: no "back" for a feed nobody looked at. */
  assert.deepEqual(stepJunk('2026-10-16T17:00:00.000Z', null, T), { next: '2026-10-16T17:00:00.000Z', event: null });
});

test('up needs 10 taps and 1.5x; back needs under 1.2x; between holds', () => {
  const base: [number, number] = [450, 1000]; // 45 per 100
  assert.equal(junkReading(counts([9, 20], base, T), T)?.level, 'normal', '9 of 20 is 45: the usual level');
  assert.equal(junkReading(counts([9, 20], [100, 1000], T), T)?.level, 'between', 'a high rate on 9 taps is not up');
  assert.equal(junkReading(counts([14, 20], base, T), T)?.level, 'up', '70 per 100 against 45');
  assert.equal(junkReading(counts([12, 20], base, T), T)?.level, 'between', '60 per 100: under 1.5x, over 1.2x');
  assert.equal(junkReading(counts([10, 20], base, T), T)?.level, 'normal', '50 per 100: under 1.2x');
  let s: JunkState = null;
  const pass = (w: [number, number]) => {
    const r = stepJunk(s, junkReading(counts(w, base, T), T), T);
    s = r.next;
    return r.event?.subject ?? null;
  };
  assert.equal(pass([14, 20]), 'junk|2026-10-16T18:00:00.000Z');
  assert.equal(pass([14, 20]), null, 'no repeat while up');
  assert.equal(pass([12, 20]), null, 'between: still up, silent');
  assert.equal(pass([10, 20]), 'junk|back|2026-10-16T18:00:00.000Z');
  assert.equal(pass([10, 20]), null);
});

test("the pushes read in the owner's words", () => {
  const f = { what: 'junk', taps: 17, shown: 25, per100: 68, baselinePer100: 45, windowHours: 3, baselineDays: 3 };
  assert.deepEqual(alertText('outage', { ...f, state: 'down' }), {
    title: 'Not a meme taps are up: 68 per 100 shown',
    body: 'You called 17 of the 25 For You posts shown in the last 3 hours not a meme, against 45 per 100 over the 3 days before. More of what reaches For You is not a meme.',
  });
  assert.deepEqual(alertText('outage', { ...f, taps: 16, shown: 32, per100: 50, state: 'back' }), {
    title: 'Not a meme taps are back near your usual level',
    body: 'You called 16 of the 32 For You posts shown in the last 3 hours not a meme (50 per 100), against 45 per 100 over the 3 days before.',
  });
  assert.deepEqual(alertText('push_test', { test: 'alarm' }), { title: 'Test alert from Insidor — alarms are working', body: 'This is a test. Nothing has stopped and nothing needs doing.' });
});

/* ── the pass around it ── */

function fakeDb(claims: string[]): { db: Db; queued: string[] } {
  const queued: string[] = [];
  const db: Db = {
    async query<R>(sql: string, params?: readonly unknown[]): Promise<R[]> {
      if (sql.includes('people.profile')) return [{ userId: 'owner-1' }] as R[];
      if (sql.includes('people.alert_claim')) return (claims.length === 0 ? [] : [{ subject: claims[claims.length - 1] }]) as R[];
      if (sql.includes('public.feed_post')) {
        const [from, to] = params as [Date, Date];
        return POSTS.filter((p) => p.shownMs >= from.getTime() && p.shownMs <= to.getTime()).map((p) => ({ id: p.id, at: new Date(p.shownMs) })) as R[];
      }
      if (sql.includes('max(created_at)')) {
        const at = lastCallAt((params?.[0] as Date).getTime());
        return [{ at: at === null ? null : new Date(at) }] as R[];
      }
      if (sql.includes('internal.owner_feedback')) {
        const ids = new Set(params?.[0] as string[]);
        const to = (params?.[1] as Date).getTime();
        return CALLS.filter((c) => ids.has(c.id) && c.atMs <= to).map((c) => ({ id: c.id, verdict: c.verdict, at: new Date(c.atMs) })) as R[];
      }
      if (sql.includes('people.alert_queue')) {
        queued.push(String(params?.[2]));
        claims.push(String(params?.[2]));
        return [];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
  return { db, queued };
}

test('★ through the database pass: the same two pushes; a restart while up repeats nothing and still says back', async () => {
  const claims: string[] = [];
  const f = fakeDb(claims);
  let now = Date.parse('2026-10-14T21:00:00Z');
  let mem = junkMemory();
  const deps = { db: f.db, now: () => now, ownerWallets: ['OwnerWa11et'], log: () => undefined };
  for (; now <= Date.parse('2026-10-14T23:30:00Z'); now += JUNK_LOOP_MS) await checkJunk(deps, mem);
  assert.deepEqual(f.queued, ['junk|2026-10-14T22:40:00.000Z']);
  mem = junkMemory(); // the service restarts while up
  for (; now <= Date.parse('2026-10-15T02:00:00Z'); now += JUNK_LOOP_MS) await checkJunk(deps, mem);
  assert.deepEqual(f.queued, ['junk|2026-10-14T22:40:00.000Z', 'junk|back|2026-10-14T22:40:00.000Z']);
});

test('no owner wallet, or no profile for it: nothing is read or queued', async () => {
  const f = fakeDb([]);
  assert.equal(await checkJunk({ db: f.db, now: () => T, ownerWallets: [], log: () => undefined }, junkMemory()), 0);
  const none: Db = { query: async <R>(sql: string) => (sql.includes('people.profile') ? [] : (() => { throw new Error('read past the owner check'); })()) as R[] };
  assert.equal(await checkJunk({ db: none, now: () => T, ownerWallets: ['w'], log: () => undefined }, junkMemory()), 0);
});
