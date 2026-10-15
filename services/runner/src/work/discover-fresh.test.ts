/**
 * The fresh bands (`feed.fresh`): with the switch off a pass asks exactly what it asked before;
 * with it on, the 'all' lane becomes one ask per band age over contiguous posting-time windows,
 * the media lane is not asked, the slow lane drops the slices the bands cover, and the bands'
 * posts together move the 'all' floor.
 *
 * Its own file because discover-feed.test.ts pins today's two-lane behaviour, and these tests are
 * about the switch. The source is a fake that records each query.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, FeedLane, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
import { bandFloor, startFloors } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { bandKey, discoverPass, lateBandKey, memoryFreshClock, slowSliceQueries, type FreshClock } from './discover.ts';

/* The fresh bands and the stale cut as they were before they were switched on, so these tests keep
   pinning the switch-off behaviour whatever the live policy says; a test that wants them on says so. */
const DEFAULT_POLICY = { ...LIVE_POLICY, feed: { ...LIVE_POLICY.feed, fresh: { ...LIVE_POLICY.feed.fresh, enabled: false, cutStale: false } } };

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
/* The fresh bands on and the late bands (`feed.fresh.late`) off, whatever the live switch says: these tests count the fresh bands' asks. */
const ON: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, fresh: { ...DEFAULT_POLICY.feed.fresh, enabled: true, late: { ...DEFAULT_POLICY.feed.fresh.late, on: false } } } };
/* And with one late band at five hours and 6,500 likes on. */
const LATE: Policy = { ...ON, feed: { ...ON.feed, fresh: { ...ON.feed.fresh, late: { on: true, bands: [{ ageMin: 300, minApproval: 6_500 }] } } } };

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - MIN, firstSeenAt: NOW, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

function source(seen: DiscoveryQuery[], perAsk = 3, fail = false): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      seen.push(q);
      if (fail) throw new Error('vendor down');
      return { value: { items: Array.from({ length: perAsk }, (_v, i) => item(i)), authors: [], cursor: null, hasMore: false }, spend: [] } as unknown as Metered<Discovered>;
    },
    observe: async () => { throw new Error('not used'); },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * 0.00015 };
    },
    toItem: () => item(0),
    baselineKey: () => 'x',
  };
}

const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

function run(adapter: PlatformAdapter, policy: Policy, fresh: FreshClock | undefined, now = NOW, lanes?: readonly FeedLane[], held: Record<string, number> = {}) {
  return discoverPass({
    platforms: { get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] } as unknown as PlatformRegistry,
    store: async (items) => items.length,
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter, mode: 'live', log: quiet, now: () => now, signal: new AbortController().signal,
    floors: { floors: async () => ({ ...held }), set: async (lane: string, floor: number) => void (held[lane] = floor) },
    dailyCapUsd: 1,
    ...(lanes === undefined ? {} : { lanes }),
    ...(fresh === undefined ? {} : { fresh }),
  });
}

test('★ switch off: two ten-minute lanes as today, the clock untouched', async () => {
  const seen: DiscoveryQuery[] = [];
  const clock = memoryFreshClock();
  await run(source(seen), DEFAULT_POLICY, clock);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((q) => q.filter?.mediaOnly), [false, true]);
  for (const q of seen) assert.equal(q.sinceMs, NOW - DEFAULT_POLICY.feed.windowMin * MIN);
  for (const age of DEFAULT_POLICY.feed.fresh.bandAgesMin) assert.equal(clock.lastUntil(bandKey('x', age)), null);
});

test('★ switch on: one ask per band at its age and scaled floor, no media lane', async () => {
  const seen: DiscoveryQuery[] = [];
  await run(source(seen), ON, memoryFreshClock());
  const ages = ON.feed.fresh.bandAgesMin;
  assert.equal(seen.length, ages.length);
  assert.ok(seen.every((q) => q.filter?.mediaOnly === false), 'the media lane is not asked');
  ages.forEach((age, k) => {
    assert.equal(seen[k]!.untilMs, NOW - age * MIN);
    assert.equal(seen[k]!.sinceMs, NOW - (age + ON.feed.fresh.maxWindowMin) * MIN, 'first ask reaches back the cap');
    assert.equal(seen[k]!.filter?.minApproval, bandFloor(age, startFloors(ON), ON));
  });
});

test('★ consecutive passes tile posting time: the next window starts where the last ended', async () => {
  const seen: DiscoveryQuery[] = [];
  const clock = memoryFreshClock();
  await run(source(seen), ON, clock);
  const first = seen.splice(0);
  await run(source(seen), ON, clock, (NOW + 2 * MIN) as Millis);
  first.forEach((q, k) => {
    assert.equal(seen[k]!.sinceMs, q.untilMs, 'no gap and no overlap');
    assert.equal(seen[k]!.untilMs, q.untilMs! + 2 * MIN);
  });
});

test('a failed ask leaves its window open: the next pass asks for it again', async () => {
  const seen: DiscoveryQuery[] = [];
  const clock = memoryFreshClock();
  await run(source(seen, 3, true), ON, clock);
  for (const age of ON.feed.fresh.bandAgesMin) assert.equal(clock.lastUntil(bandKey('x', age)), null);
});

test('the bands together move the all floor: three asks of 3 posts count as 9', async () => {
  const held: Record<string, number> = {};
  const seen: DiscoveryQuery[] = [];
  /* A target of ~2 posts a pass at $0.05 a day: 9 is over it, so the floor rises. */
  const policy: Policy = { ...ON, feed: { ...ON.feed, fresh: { ...ON.feed.fresh, targetScale: 0.01 } } };
  await run(source(seen, 3), policy, memoryFreshClock(), NOW, undefined, held);
  assert.equal(held['all'], Math.ceil(ON.feed.startFloor * ON.feed.raiseFactor));
  assert.equal(held['media'], undefined, 'the media lane is not asked, so its floor does not move');
});

test('switch on: the slow lane drops the slices the bands already cover', () => {
  const off = slowSliceQueries(startFloors(DEFAULT_POLICY), NOW, DEFAULT_POLICY);
  const on = slowSliceQueries(startFloors(ON), NOW, ON);
  assert.equal(off.length, DEFAULT_POLICY.feed.slow.slices);
  assert.equal(on.length, DEFAULT_POLICY.feed.slow.slices - 1, 'the 45-60 minute slice is the 50-minute band');
  assert.deepEqual(on, off.slice(1));
});

test('★ late bands on: one more ask at five hours, at its fixed floor, tiled on its own clock', async () => {
  const seen: DiscoveryQuery[] = [];
  const clock = memoryFreshClock();
  /* The slow lane adapted to 7,412: the band sends its own 6,500. */
  await run(source(seen), LATE, clock, NOW, undefined, { all: 1_120, slow: 7_412 });
  const late = seen.at(-1)!;
  assert.equal(seen.length, ON.feed.fresh.bandAgesMin.length + 1);
  assert.equal(late.untilMs, NOW - 300 * MIN);
  assert.equal(late.filter?.minApproval, 6_500);
  assert.equal(clock.lastUntil(lateBandKey('x', 300)), NOW - 300 * MIN);
  seen.length = 0;
  await run(source(seen), LATE, clock, (NOW + 2 * MIN) as Millis, undefined, { all: 1_120, slow: 7_412 });
  assert.equal(seen.at(-1)!.sinceMs, late.untilMs, 'no gap and no overlap');
});

test('★ a late band never moves a floor: its posts are not counted toward any lane\'s target', async () => {
  const held: Record<string, number> = { all: 1_120, slow: 7_412 };
  const seen: DiscoveryQuery[] = [];
  /* A target of ~2 posts a pass: the fresh bands' 6 posts raise the all floor; the late band's 3 must not add to it or touch slow. */
  const policy: Policy = { ...LATE, feed: { ...LATE.feed, fresh: { ...LATE.feed.fresh, targetScale: 0.01 } } };
  await run(source(seen, 3), policy, memoryFreshClock(), NOW, undefined, held);
  assert.equal(held['all'], Math.ceil(1_120 * ON.feed.raiseFactor));
  assert.equal(held['slow'], 7_412, 'the slow lane was not asked this pass and its floor is untouched');
});

test('late bands on: the slow lane drops the slice that holds the band\'s age, and only that one', () => {
  const on = slowSliceQueries(startFloors(ON), NOW, ON);
  const late = slowSliceQueries(startFloors(LATE), NOW, LATE);
  assert.equal(late.length, on.length - 1);
  assert.ok(!late.some((q) => q.untilMs === NOW - 285 * MIN), 'the 285-300 minute slice is the five-hour band');
  assert.ok(late.some((q) => q.untilMs === NOW - 345 * MIN), 'the six-hour slice stays');
});
