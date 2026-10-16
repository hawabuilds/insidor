/**
 * The middle lane's own loop (loops/middle.ts), and the discover loop without it.
 *
 * The claim worth a test: the discover pass, whose last steps judge new posts, never waits on the
 * middle lane — here its asks hang forever and the discover loop still finishes and runs its
 * after-pass steps. And the middle loop's pass asks only the middle lane, stops paging at its
 * deadline (`feed.middle.passDeadlineMs`) and at its cap, and stores its posts as the 'middle' lane.
 *
 * The source is a fake that pages a fixed set of middle-lane posts, answers every other ask with
 * nothing, and records each query.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import type { LoopContext } from '../loop.ts';
import { memoryLaneLedger, type LaneLedger } from '../work/lane-ledger.ts';
import { discoverLoop } from './discover.ts';
import { middleLoop } from './middle.ts';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const PAGE = 20;
const USD_PER_POST = 0.00015;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const ON: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, middle: { ...DEFAULT_POLICY.feed.middle, on: true } } };
const OFF: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, middle: { ...DEFAULT_POLICY.feed.middle, on: false } } };
const WIDTH = (ON.feed.middle.maxAgeMin - ON.feed.middle.minAgeMin) * MIN;

const isMiddle = (q: DiscoveryQuery): boolean => q.sinceMs !== null && q.untilMs !== null && q.untilMs - q.sinceMs === WIDTH && q.filter?.minApproval === ON.feed.middle.minApproval;

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: T0 - 60 * MIN, firstSeenAt: T0, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

/** `onMiddle` runs before each middle-lane page is answered: it advances a clock, or never returns. */
function source(seen: DiscoveryQuery[], middlePosts: number, onMiddle: () => Promise<void> = async () => undefined): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      seen.push(q);
      const middle = isMiddle(q);
      if (middle) await onMiddle();
      const start = q.cursor === null ? 0 : Number(q.cursor);
      const n = middle ? Math.max(0, Math.min(PAGE, middlePosts - start)) : 0;
      const more = middle && start + n < middlePosts;
      const items = Array.from({ length: n }, (_v, k) => item(start + k));
      return { value: { items, authors: [], cursor: more ? String(start + n) : null, hasMore: more }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: n, usd: n * USD_PER_POST, at: T0 } } as unknown as Metered<Discovered>;
    },
    observe: async () => { throw new Error('not used'); },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => item(0),
    baselineKey: () => 'x',
  };
}

const registry = (adapter: PlatformAdapter) => ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;
const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;
const floors = { floors: async () => ({}), set: async () => undefined };

function middleWith(adapter: PlatformAdapter, policy: Policy, ledger: LaneLedger, stored: { lane: unknown; n: number }[] = []) {
  return middleLoop({
    platforms: registry(adapter),
    store: async (items, _a, lane) => {
      stored.push({ lane, n: items.length });
      return items.length;
    },
    policy, meter, mode: 'live', log: quiet, floors, dailyCapUsd: 1,
    middle: { ledger, uncredited: async () => 0 },
  });
}

const fixedClock = (): LoopContext => ({ signal: new AbortController().signal, now: () => T0 as Millis });

test('★ the discover pass never waits on the middle lane: with its asks hanging, the pass ends and the judge runs', async () => {
  const seen: DiscoveryQuery[] = [];
  /* A middle ask that never comes back. If the discover pass asked it, this test would never end. */
  const adapter = source(seen, 55, () => new Promise<void>(() => undefined));
  const ran: string[] = [];
  const loop = discoverLoop({
    platforms: registry(adapter),
    store: async (items) => items.length,
    discovery: { kind: 'on', terms: [] },
    policy: ON, meter, mode: 'live', log: quiet,
    watch: { health: { declare: async () => undefined, recordSuccess: async () => undefined, recordFailure: async () => undefined, all: async () => [] }, now: () => T0 as Millis, log: quiet },
    floors, dailyCapUsd: 1,
    afterPass: [['score-posts', async () => ran.push('score-posts')]],
  });
  await loop.run(fixedClock());
  assert.equal(seen.filter(isMiddle).length, 0, 'the middle lane is not asked by the discover pass');
  assert.ok(seen.length > 0, 'the catch-all lanes were asked');
  assert.deepEqual(ran, ['score-posts']);
});

test('★ the middle loop asks only the middle lane, pages it to the end and stores it as the middle lane', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: { lane: unknown; n: number }[] = [];
  const counts = await middleWith(source(seen, 55), ON, memoryLaneLedger(), stored).run(fixedClock());
  assert.equal(seen.length, 3, 'pages of 20, 20 and 15, and nothing else');
  assert.ok(seen.every(isMiddle));
  assert.deepEqual(stored, [{ lane: 'middle', n: 55 }]);
  assert.deepEqual(counts, { in: 55, out: 55, failed: 0, firstError: null });
});

test('★ the middle loop stops paging at its deadline; what it found is still stored and charged', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: { lane: unknown; n: number }[] = [];
  let now = T0;
  /* Each page takes 60% of the deadline: page 2 is asked at 0.6 of it, page 3's check finds 1.2. */
  const step = Math.round(ON.feed.middle.passDeadlineMs * 0.6);
  const ledger = memoryLaneLedger();
  const loop = middleWith(source(seen, 400, async () => { now += step; }), ON, ledger, stored);
  await loop.run({ signal: new AbortController().signal, now: () => now as Millis });
  assert.equal(seen.length, 2, 'the check before the third page finds the deadline passed');
  assert.deepEqual(stored, [{ lane: 'middle', n: 2 * PAGE }]);
  assert.ok(Math.abs(((await ledger.spent('middle', T0 as Millis)) ?? 0) - 2 * PAGE * USD_PER_POST) < 1e-12, 'its two pages are in its ledger');
});

test('★ the middle loop stops at its cap', async () => {
  const seen: DiscoveryQuery[] = [];
  const pageUsd = PAGE * USD_PER_POST;
  const ledger = memoryLaneLedger({ middle: ON.feed.middle.cap.dailyUsd - 2.5 * pageUsd });
  await middleWith(source(seen, 400), ON, ledger).run(fixedClock());
  assert.equal(seen.length, 2);
  assert.ok(((await ledger.spent('middle', T0 as Millis)) ?? 0) <= ON.feed.middle.cap.dailyUsd);
});

test('the middle loop with the lane off asks nothing', async () => {
  const seen: DiscoveryQuery[] = [];
  const counts = await middleWith(source(seen, 55), OFF, memoryLaneLedger()).run(fixedClock());
  assert.equal(seen.length, 0);
  assert.deepEqual(counts, { in: 0, out: 0, failed: 0, firstError: null });
});
