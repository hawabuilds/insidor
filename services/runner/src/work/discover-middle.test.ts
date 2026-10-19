/**
 * The middle lane (`feed.middle`): asked only when its loop (loops/middle.ts) passes its deps, over posts 15
 * minutes to 3 hours old at its fixed floor, paged to the end of its window, stored as the 'middle'
 * lane, charged its search and its new posts' judging in its ledger, and never asked past its cap.
 * The slow lane drops the slices that lie inside its window when its floor is no higher.
 *
 * The source is a fake that serves pages of 20 from a fixed set and records each query.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { laneJudgeUsd, middleLaneDue } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { discoverPass, middleQuery, slowSliceQueries } from './discover.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const PAGE = 20;
const USD_PER_POST = 0.00015;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
/* The middle lane on, the fresh bands as live; the numbers asserted are read from the policy. */
/* One language: these tests are about lanes and paging. Asking each language as its own search is work/discover-languages.test.ts. */
const ON: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, langs: ['en'], middle: { ...DEFAULT_POLICY.feed.middle, on: true } } };
const OFF: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, langs: ['en'], middle: { ...DEFAULT_POLICY.feed.middle, on: false } } };
const CAP = ON.feed.middle.cap;

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - 60 * MIN, firstSeenAt: NOW, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

/** Answers every ask with nothing, except the middle lane's (its floor), which pages through `middlePosts` posts. */
function source(seen: DiscoveryQuery[], middlePosts: number): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      seen.push(q);
      const isMiddle = q.filter?.minApproval === ON.feed.middle.minApproval && q.untilMs === NOW - ON.feed.middle.minAgeMin * MIN;
      const start = q.cursor === null ? 0 : Number(q.cursor);
      const n = isMiddle ? Math.max(0, Math.min(PAGE, middlePosts - start)) : 0;
      const more = isMiddle && start + n < middlePosts;
      const items = Array.from({ length: n }, (_v, k) => item(start + k));
      return { value: { items, authors: [], cursor: more ? String(start + n) : null, hasMore: more }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: n, usd: n * USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
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

const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

function run(adapter: PlatformAdapter, policy: Policy, middle: { ledger: LaneLedger; uncredited: (ids: readonly string[]) => Promise<number> } | undefined, stored: { lane: unknown; n: number }[] = []) {
  return discoverPass({
    platforms: { get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] } as unknown as PlatformRegistry,
    store: async (items, _a, lane) => {
      stored.push({ lane, n: items.length });
      return items.length;
    },
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter, mode: 'live', log: quiet, now: () => NOW, signal: new AbortController().signal,
    floors: { floors: async () => ({}), set: async () => undefined },
    dailyCapUsd: 1,
    ...(middle === undefined ? {} : { middle }),
  });
}

const middleAsks = (seen: readonly DiscoveryQuery[]) => seen.filter((q) => q.untilMs === NOW - ON.feed.middle.minAgeMin * MIN && q.filter?.minApproval === ON.feed.middle.minApproval);

test('★ due: one ask over 15 minutes to 3 hours at the fixed floor, paged to the end, stored as the middle lane', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: { lane: unknown; n: number }[] = [];
  const ledger = memoryLaneLedger();
  await run(source(seen, 55), ON, { ledger, uncredited: async () => 10 }, stored);
  const asks = middleAsks(seen);
  assert.equal(asks.length, 3, 'pages of 20, 20 and 15: the short page ends it');
  assert.equal(asks[0]!.sinceMs, NOW - ON.feed.middle.maxAgeMin * MIN);
  assert.equal(asks[0]!.filter?.mediaOnly, false);
  assert.deepEqual(stored.filter((s) => s.lane === 'middle').map((s) => s.n), [55]);
  const spent = (await ledger.spent('middle', NOW)) ?? 0;
  assert.ok(Math.abs(spent - (55 * USD_PER_POST + laneJudgeUsd(10, CAP))) < 1e-12, 'its search bill plus the judging of the 10 posts no lane held');
});

test('not due (no middle deps from the loop), or switched off: not asked', async () => {
  const seen: DiscoveryQuery[] = [];
  await run(source(seen, 55), ON, undefined);
  assert.equal(middleAsks(seen).length, 0);
  await run(source(seen, 55), OFF, { ledger: memoryLaneLedger(), uncredited: async () => 0 });
  assert.equal(middleAsks(seen).length, 0);
});

test('★ its day spent: paused with its own cap, nothing asked', async () => {
  const seen: DiscoveryQuery[] = [];
  const result = await run(source(seen, 55), ON, { ledger: memoryLaneLedger({ middle: CAP.dailyUsd - 0.001 }), uncredited: async () => 0 });
  assert.equal(middleAsks(seen).length, 0);
  const paused = result.outcomes.find((o) => o.kind === 'paused');
  assert.ok(paused !== undefined && paused.kind === 'paused' && paused.lane === 'middle' && paused.capUsd === CAP.dailyUsd);
});

test('★ the cap stops the paging: no page is asked that would take the day past it', async () => {
  const seen: DiscoveryQuery[] = [];
  const pageUsd = PAGE * USD_PER_POST;
  /* Room for two pages and a bit: the first is checked at the gate, the second inside the loop, the third refused. */
  const ledger = memoryLaneLedger({ middle: CAP.dailyUsd - 2.5 * pageUsd });
  await run(source(seen, 200), ON, { ledger, uncredited: async () => 0 });
  assert.equal(middleAsks(seen).length, 2);
  assert.ok(((await ledger.spent('middle', NOW)) ?? 0) <= CAP.dailyUsd);
});

test('★ an unreadable ledger asks nothing', async () => {
  const seen: DiscoveryQuery[] = [];
  const result = await run(source(seen, 55), ON, { ledger: { spent: async () => null, add: async () => undefined }, uncredited: async () => 0 });
  assert.equal(middleAsks(seen).length, 0);
  assert.ok(result.outcomes.some((o) => o.kind === 'unasked'));
});

test('a failed count of new posts charges the lane for every post it returned', async () => {
  const ledger = memoryLaneLedger();
  await run(source([], 30), ON, { ledger, uncredited: async () => { throw new Error('db away'); } });
  const spent = (await ledger.spent('middle', NOW)) ?? 0;
  assert.ok(Math.abs(spent - (30 * USD_PER_POST + laneJudgeUsd(30, CAP))) < 1e-12);
});

test('★ the slow lane drops the slices wholly inside the window when its floor is no lower than the middle floor', () => {
  /* The window as it was (15 minutes to 3 hours), which held whole slices; the shipped hour holds only one the bands cover. */
  const wide = (p: Policy): Policy => ({ ...p, feed: { ...p.feed, middle: { ...p.feed.middle, maxAgeMin: 180 } } });
  const ages = (p: Policy, slowFloor: number) =>
    slowSliceQueries({ all: 100, media: 100, slow: slowFloor }, NOW, wide(p)).map((q) => (NOW - (q.untilMs ?? NOW)) / MIN);
  const high = ages(ON, ON.feed.middle.minApproval * 3);
  const inside = (age: number) => age >= ON.feed.middle.minAgeMin && age + ON.feed.slow.everyMs / MIN <= 180;
  assert.ok(high.every((age) => !inside(age)), 'no slice inside the middle window is asked');
  assert.ok(ages(OFF, ON.feed.middle.minApproval * 3).some(inside), 'switched off, those slices are asked as before');
  /* A slow floor under the middle one would lose the posts between the two floors: kept. */
  assert.ok(ages(ON, ON.feed.middle.minApproval / 2).some(inside));
});

test('the ask itself: the window and floor from policy, never the adapted floors', () => {
  const q = middleQuery({ all: 50_000, media: 50_000, slow: 50_000 }, NOW, ON);
  assert.equal(q.filter?.minApproval, ON.feed.middle.minApproval);
  assert.equal(q.untilMs, NOW - ON.feed.middle.minAgeMin * MIN);
  assert.deepEqual(q.filter?.langs, ON.feed.langs);
});

test('due on the clock: at once after a start, then every quarter-hour; never while off', () => {
  assert.equal(middleLaneDue(NOW, null, ON), true);
  assert.equal(middleLaneDue(NOW + ON.feed.middle.everyMs - 1, NOW, ON), false);
  assert.equal(middleLaneDue(NOW + ON.feed.middle.everyMs, NOW, ON), true);
  assert.equal(middleLaneDue(NOW, null, OFF), false);
});
