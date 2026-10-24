/**
 * For You's view readings: which posts each pass owes a reading (by age, by source, by an opened
 * sheet), that a source's posts go out in one call and come back as stored readings with the
 * source's time, and every way a pass asks nothing — off, its ledger unreadable or at its cap, the
 * live book near its end, a source priced by the run, a dry run, its deadline.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { CounterSet, Millis, Observation } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { ReadingCandidate } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';
import { cadenceDue, dueReadings, openDue, readingsMemory, readingsPass, stepFor, type ReadingsDeps } from './readings.ts';

const NOW = 1_800_000_000_000;
const S = 1_000;
const MIN = 60 * S;
const H = 60 * MIN;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/* The step logic is tested on the owner's first cadence (one minute under 2 hours); the shipped one is checked below. */
const ON: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, readings: { ...DEFAULT_POLICY.feed.readings, on: true, cadence: { steps: [{ underMs: 7_200_000, everyMs: 60_000 }, { underMs: 21_600_000, everyMs: 300_000 }], thenEveryMs: 900_000 } } } };

test('shipped since 2026-10-20: text posts every 4, 10 and 30 minutes; short video every 10, 30 and 60', () => {
  const r = DEFAULT_POLICY.feed.readings;
  assert.deepEqual(r.cadence.steps.map((x) => x.everyMs), [240_000, 600_000]);
  assert.equal(r.cadence.thenEveryMs, 1_800_000);
  assert.deepEqual(r.shortVideoCadence.steps.map((x) => x.everyMs), [600_000, 1_800_000]);
  assert.equal(r.shortVideoCadence.thenEveryMs, 3_600_000);
});

const post = (id: string, over: Partial<ReadingCandidate> = {}): ReadingCandidate => ({
  itemId: `x:${id}`,
  source: 'x',
  sourceItemId: id,
  handle: 'someone',
  postedAt: NOW - 30 * MIN,
  lastReadAt: NOW - 2 * MIN,
  onForYou: true,
  openedAt: null,
  ...over,
});

const video = (id: string, over: Partial<ReadingCandidate> = {}): ReadingCandidate => post(id, { itemId: `tiktok:${id}`, source: 'tiktok', ...over });

test('the owner\'s steps: every minute under 2 hours, 5 minutes to 6, then 15; an unknown age is the slowest', () => {
  const c = ON.feed.readings.cadence;
  assert.equal(stepFor(30 * MIN, c), MIN);
  assert.equal(stepFor(2 * H - 1, c), MIN);
  assert.equal(stepFor(2 * H, c), 5 * MIN);
  assert.equal(stepFor(6 * H, c), 15 * MIN);
  assert.equal(stepFor(null, c), 15 * MIN);
});

test('★ due by age, to within the slack: a one-minute step is read at a minute, not at ninety seconds', () => {
  assert.equal(cadenceDue(post('1', { lastReadAt: NOW - 30 * S }), NOW, ON), false);
  assert.equal(cadenceDue(post('1', { lastReadAt: NOW - 50 * S }), NOW, ON), true, 'a 30-second loop must not slip a one-minute step to ninety');
  assert.equal(cadenceDue(post('2', { postedAt: NOW - 3 * H, lastReadAt: NOW - 4 * MIN }), NOW, ON), false);
  assert.equal(cadenceDue(post('2', { postedAt: NOW - 3 * H, lastReadAt: NOW - 5 * MIN }), NOW, ON), true);
  assert.equal(cadenceDue(post('3', { postedAt: NOW - 10 * H, lastReadAt: NOW - 10 * MIN }), NOW, ON), false);
  assert.equal(cadenceDue(post('3', { postedAt: NOW - 10 * H, lastReadAt: NOW - 15 * MIN }), NOW, ON), true);
  assert.equal(cadenceDue(post('4', { lastReadAt: null }), NOW, ON), true, 'never read is the stalest there is');
  assert.equal(cadenceDue(post('5', { onForYou: false, lastReadAt: null }), NOW, ON), false, 'off For You, only an open asks');
});

test('the short-video source keeps its own, slower cadence', () => {
  assert.equal(cadenceDue(video('1', { lastReadAt: NOW - 2 * MIN }), NOW, ON), false);
  assert.equal(cadenceDue(video('1', { lastReadAt: NOW - ON.feed.readings.shortVideoCadence.steps[0]!.everyMs }), NOW, ON), true);
});

test('★ an open asks for a reading only when nothing was read within a minute before it, or since', () => {
  assert.equal(openDue(post('1', { openedAt: NOW - 10 * S, lastReadAt: NOW - 2 * MIN }), ON), true);
  assert.equal(openDue(post('1', { openedAt: NOW - 10 * S, lastReadAt: NOW - 40 * S }), ON), false, 'read 30 seconds before the open');
  assert.equal(openDue(post('1', { openedAt: NOW - 10 * S, lastReadAt: NOW - 5 * S }), ON), false, 'read since the open');
  assert.equal(openDue(post('1', { openedAt: NOW - 10 * S, lastReadAt: null }), ON), true);
  assert.equal(openDue(post('1'), ON), false);
});

test('opens first, newest first and capped; then For You stalest first; the pass capped in all', () => {
  const p: Policy = { ...ON, feed: { ...ON.feed, readings: { ...ON.feed.readings, openMaxPerPass: 2, maxPostsPerPass: 4 } } };
  const out = dueReadings(
    [
      post('a', { lastReadAt: NOW - 3 * MIN }),
      post('b', { lastReadAt: NOW - 9 * MIN }),
      post('c', { lastReadAt: null }),
      post('o1', { onForYou: false, openedAt: NOW - 30 * S, lastReadAt: NOW - 3 * H }),
      post('o2', { onForYou: false, openedAt: NOW - 5 * S, lastReadAt: NOW - 3 * H }),
      post('o3', { onForYou: false, openedAt: NOW - 50 * S, lastReadAt: NOW - 3 * H }),
    ],
    NOW,
    p,
  );
  assert.deepEqual(out.posts.map((c) => c.sourceItemId), ['o2', 'o1', 'c', 'b']);
  assert.equal(out.opened, 2);
});

function setup(opts: { policy?: Policy; candidates?: ReadingCandidate[]; ledger?: LaneLedger; remainingUsd?: number; videoUsdPerRead?: number; mode?: 'dry' | 'live'; slowMs?: number } = {}) {
  let clock = NOW;
  const calls: { source: string; ids: string[] }[] = [];
  const appended: Observation[] = [];
  const answered: string[][] = [];
  const counters = (n: number): CounterSet => ({ reach: { value: n, fidelity: { kind: 'exact' }, observedAt: (clock - S) as Millis } });
  const adapter = (source: string, usdPerRead: number) =>
    ({
      id: source,
      capabilities: source === 'x' ? { leftOutIsGone: true } : {},
      estimate: (call: { sourceItemIds: readonly string[] }) => ({ vendor: `v-${source}`, endpoint: 'lookup', unit: 'per-item-returned', estUnits: call.sourceItemIds.length, usd: usdPerRead * call.sourceItemIds.length }),
      observe: async (ids: readonly string[]) => {
        calls.push({ source, ids: [...ids] });
        clock += opts.slowMs ?? 0;
        return {
          value: new Map(ids.filter((id) => id !== 'gone').map((id) => [id, counters(1_000)])),
          spend: { vendor: `v-${source}`, endpoint: 'lookup', unit: 'per-item-returned', units: ids.length, usd: usdPerRead * ids.length, at: clock },
        };
      },
    }) as unknown as PlatformAdapter;
  const adapters = new Map([
    ['x', adapter('x', 0.00015)],
    ['tiktok', adapter('tiktok', opts.videoUsdPerRead ?? 0.00188)],
  ]);
  const ledger = opts.ledger ?? memoryLaneLedger();
  const meter = {
    mayspend: () => true,
    record: () => undefined,
    spentUsd: () => 0,
    line: () => ({ capUsd: 40, spentUsd: 0, stopAtUsd: 40, remainingUsd: opts.remainingUsd ?? 20, unrecordedUsd: 0 }),
  } as unknown as Meter;
  const deps: ReadingsDeps = {
    platforms: { has: (s) => adapters.has(String(s)), get: (s) => adapters.get(String(s))! } as ReadingsDeps['platforms'],
    readings: {
      candidates: async () => opts.candidates ?? [post('1', { lastReadAt: NOW - 2 * MIN }), post('2', { lastReadAt: null, openedAt: NOW - 5 * S }), post('gone'), video('v1', { lastReadAt: NOW - H })],
      answered: async (ids) => (answered.push([...ids]), ids.length),
      expire: async () => 0,
    },
    observations: { latestForItems: async () => new Map(), append: async (o) => (appended.push(...o), o.length) },
    ledger,
    meter,
    mode: opts.mode ?? 'live',
    policy: opts.policy ?? ON,
    log: quiet,
    now: () => clock as Millis,
  };
  return { deps, calls, appended, answered, ledger };
}

test("★ the sorts' top: a post that would top a list and has gone 25 minutes unread is due, off the frame or not, each source to its own cap a pass", () => {
  const top = new Set(['x:old', 'x:fresh', 'tiktok:v', 'x:never']);
  const everyMs = ON.feed.readings.sortTop.everyMs;
  const off = { onForYou: false, postedAt: NOW - 30 * H };
  const cs = [
    post('old', { ...off, lastReadAt: NOW - everyMs }),
    post('fresh', { ...off, lastReadAt: NOW - everyMs / 2 }),
    post('never', { ...off, lastReadAt: null }),
    post('outside', { ...off, lastReadAt: NOW - 10 * H }),
    video('v', { ...off, lastReadAt: NOW - 10 * H }),
  ];
  const { posts, sorts } = dueReadings(cs, NOW, ON, top);
  assert.deepEqual(posts.map((c) => c.itemId), ['x:never', 'tiktok:v', 'x:old']);
  assert.equal(sorts, 3);
  /* Off, nothing is read for the sorts. */
  const quietPolicy = { ...ON, feed: { ...ON.feed, readings: { ...ON.feed.readings, sortTop: { ...ON.feed.readings.sortTop, on: false } } } };
  assert.equal(dueReadings(cs, NOW, quietPolicy, top).posts.length, 0);
  /* Bounded a pass. */
  const many = Array.from({ length: 50 }, (_, i) => post(`m${i}`, { ...off, lastReadAt: null }));
  const videos = Array.from({ length: 50 }, (_, i) => video(`v${i}`, { ...off, lastReadAt: null }));
  const capped = dueReadings([...many, ...videos], NOW, ON, new Set([...many, ...videos].map((c) => c.itemId)));
  assert.equal(capped.sorts, ON.feed.readings.sortTop.maxPerPass + ON.feed.readings.sortTop.shortVideoMaxPerPass);
  assert.equal(capped.posts.filter((c) => c.source === 'tiktok').length, ON.feed.readings.sortTop.shortVideoMaxPerPass);
});

test("★ the pass asks the store for the sorts' top posts too, and reads them", async () => {
  const off = { onForYou: false, postedAt: NOW - 30 * H, lastReadAt: NOW - H };
  const { deps, calls } = setup({ candidates: [post('top', off)] });
  let extra: readonly string[] = [];
  const out = await readingsPass({
    ...deps,
    readings: { ...deps.readings, candidates: async (_since, _only, ids = []) => ((extra = ids), [post('top', off)]) },
    sortTop: async () => new Set(['x:top']),
  });
  assert.deepEqual(extra, ['x:top']);
  assert.deepEqual(calls, [{ source: 'x', ids: ['top'] }]);
  assert.equal(out.sorts, 1);
});

test('★ off: nothing is listed, nothing asked', async () => {
  const off = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, readings: { ...DEFAULT_POLICY.feed.readings, on: false } } };
  const { deps, calls } = setup({ policy: off });
  assert.equal(DEFAULT_POLICY.feed.readings.on, true, 'on since 2026-10-16, the owner\'s option 1');
  const out = await readingsPass(deps);
  assert.equal(calls.length, 0);
  assert.deepEqual(out.held, ['off']);
});

test('★ one call per source with every due post; each reading stored with the source\'s time; opens answered; the lane charged', async () => {
  const { deps, calls, appended, answered, ledger } = setup();
  const out = await readingsPass(deps);
  assert.deepEqual(calls, [
    { source: 'x', ids: ['2', '1', 'gone'] },
    { source: 'tiktok', ids: ['v1'] },
  ]);
  assert.equal(out.asked, 4);
  assert.equal(out.answered, 3, 'a post the source did not return has no reading, not a reading of zero');
  assert.deepEqual(appended.map((o) => [o.itemId, o.kind, o.capturedAt]), [
    ['x:2', 'reach', NOW - S],
    ['x:1', 'reach', NOW - S],
    ['tiktok:v1', 'reach', NOW - S],
  ]);
  assert.deepEqual(answered, [['x:2']]);
  const spent = (await ledger.spent('readings', NOW as Millis)) ?? 0;
  assert.ok(Math.abs(spent - (3 * 0.00015 + 0.00188)) < 1e-9);
});

test('★ fails closed: a ledger that cannot be read, or one at the cap, asks nothing', async () => {
  const unreadable: LaneLedger = { spent: async () => null, add: async () => undefined };
  const a = setup({ ledger: unreadable });
  await readingsPass(a.deps);
  assert.equal(a.calls.length, 0);
  const full = setup({ ledger: memoryLaneLedger({ readings: ON.feed.readings.dailyUsd }) });
  const out = await readingsPass(full.deps);
  assert.equal(full.calls.length, 0);
  assert.ok(out.held.includes('cap'));
  const none = setup();
  const off = await readingsPass({ ...none.deps, ledger: undefined });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(off.held, ['ledger']);
});

test('★ the live book\'s last dollars are not this lane\'s', async () => {
  const { deps, calls } = setup({ remainingUsd: ON.feed.readings.bookReserveUsd - 0.01 });
  const out = await readingsPass(deps);
  assert.equal(calls.length, 0);
  assert.ok(out.held.includes('book'));
});

test('★ a source priced by the run is left to TRACK; the others are still read', async () => {
  const { deps, calls } = setup({ videoUsdPerRead: 0.004 });
  const out = await readingsPass(deps);
  assert.deepEqual(calls.map((c) => c.source), ['x']);
  assert.ok(out.held.includes('price:tiktok'));
});

test('a dry run prices the pass and reads nothing', async () => {
  const { deps, calls } = setup({ mode: 'dry' });
  const out = await readingsPass(deps);
  assert.equal(calls.length, 0);
  assert.ok(out.wouldSpendUsd > 0);
});

test('★ a slow source costs this pass, not the next source\'s deadline: past it, nothing more is asked', async () => {
  const { deps, calls } = setup({ slowMs: ON.feed.readings.passDeadlineMs + S });
  const out = await readingsPass(deps);
  assert.deepEqual(calls.map((c) => c.source), ['x']);
  assert.ok(out.held.includes('deadline'));
});

test('a held reason is said once while it lasts', async () => {
  const lines: string[] = [];
  const log: Logger = { ...quiet, info: (m, f) => void lines.push(`${m}:${String(f?.['why'])}`) };
  const { deps } = setup({ remainingUsd: 0 });
  const memory = readingsMemory();
  await readingsPass({ ...deps, log }, memory);
  await readingsPass({ ...deps, log }, memory);
  assert.equal(lines.filter((l) => l.endsWith(':book')).length, 1);
});

test('★ what an answered read said about each post is handed on (gone-posts.ts): no extra call, and a failed read hands on nothing', async () => {
  const seen = { returned: [] as string[], leftOut: [] as string[] };
  const gone = {
    log: quiet,
    repo: {
      returned: async (ids: readonly string[]) => void seen.returned.push(...ids),
      leftOut: async (ids: readonly string[]) => void seen.leftOut.push(...ids),
      pending: async () => [],
      markDeleted: async () => 0,
    },
  };
  const { deps, calls } = setup();
  await readingsPass({ ...deps, gone });
  assert.equal(calls.filter((c) => c.source === 'x').length, 1, 'one call for the source, as without it');
  assert.deepEqual(seen.leftOut, ['x:gone']);
  assert.ok(seen.returned.includes('x:1'));

  const failing = setup();
  const x = failing.deps.platforms.get('x' as never);
  const broken = { ...x, observe: async () => { throw new Error('rate limited'); } } as unknown as PlatformAdapter;
  const after = { returned: seen.returned.length, leftOut: seen.leftOut.length };
  await readingsPass({ ...failing.deps, gone, platforms: { has: (s) => String(s) === 'x', get: () => broken } as ReadingsDeps['platforms'], readings: { ...failing.deps.readings, candidates: async () => [post('1', { lastReadAt: NOW - 2 * MIN }), post('gone')] } });
  assert.deepEqual({ returned: seen.returned.length, leftOut: seen.leftOut.length }, after);
});
