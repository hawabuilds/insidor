/**
 * The catch-all pass: two lanes per source that can be asked for them, no keyword, priced
 * for a whole day before anything is spent, and each lane's floor moved after a live pass
 * from that lane's own result.
 *
 * The source here is a fake that records every query it is handed — this file tests the
 * pass, not a vendor. The vendor's half (rendering `min_faves:` and parsing a recorded
 * page) is tested against recorded responses in adapters/platform/x/src/discover-feed.test.ts.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryMode, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { discoverPass, type DiscoveryPlan } from './discover.ts';

const NOW = 1_800_000_000_000 as Millis;
const CADENCE_MS = 300_000;
const USD_PER_POST = 0.00015;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function item(source: string, i: number): Item {
  return {
    itemId: itemId(sourceId(source), `p${i}`),
    source: sourceId(source),
    sourceItemId: `p${i}`,
    origin: 'observed',
    authorKey: authorKey(sourceId(source), `a${i}`),
    postedAt: NOW - 60_000,
    firstSeenAt: NOW,
    lang: 'en',
    text: `post ${i}`,
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `t/${i}`,
  };
}

/** A source billed per post returned, answering each lane with a chosen number of posts. */
function feedSource(returns: { all: number; media: number; term?: number }, seen: DiscoveryQuery[], discovery: readonly DiscoveryMode[] = ['keyword', 'catchall']): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'),
    counters: ['reach'],
    absent: [],
    fidelity: { reach: { kind: 'exact' } },
    discovery,
    observeBatchSize: 100,
    lineage: true,
    billing: 'per-item-returned',
  };
  const count = (q: DiscoveryQuery): number =>
    q.mode !== 'catchall' ? (returns.term ?? 0) : q.filter?.mediaOnly === true ? returns.media : returns.all;
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      seen.push(q);
      return {
        value: { items: Array.from({ length: count(q) }, (_v, i) => item('x', i)), authors: [], cursor: null, hasMore: false },
        spend: [],
      } as unknown as Metered<Discovered>;
    },
    observe: async () => {
      throw new Error('not used');
    },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => item('x', 0),
    baselineKey: () => 'x',
  };
}

const registry = (adapter: PlatformAdapter): PlatformRegistry =>
  ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;

const meter: Meter = {
  record: () => undefined,
  spentUsd: () => 0,
  mayspend: () => true,
  line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
} as unknown as Meter;

function floorsStore(initial: Record<string, number> = {}) {
  const held: Record<string, number> = { ...initial };
  return { held, floors: async () => ({ ...held }), set: async (lane: string, floor: number) => void (held[lane] = floor) };
}

function run(adapter: PlatformAdapter, mode: 'live' | 'dry', floors = floorsStore(), terms: readonly string[] = []) {
  const plan: DiscoveryPlan = { terms, cadenceMs: CADENCE_MS };
  return discoverPass({
    platforms: registry(adapter),
    store: async (items) => items.length,
    plan,
    policy: DEFAULT_POLICY,
    meter,
    mode,
    log: quiet,
    now: () => NOW,
    signal: new AbortController().signal,
    floors,
    dailyCapUsd: 1,
  });
}

test('★ with no terms, a source with a catch-all search is asked both lanes, with no keyword', async () => {
  const seen: DiscoveryQuery[] = [];
  await run(feedSource({ all: 10, media: 3 }, seen), 'live');
  assert.equal(seen.length, 2);
  for (const q of seen) {
    assert.equal(q.mode, 'catchall');
    assert.equal(q.term, '');
    assert.equal(q.untilMs, NOW, 'the window ends now');
    assert.equal(q.sinceMs, NOW - DEFAULT_POLICY.feed.windowMin * 60_000);
    assert.equal(q.filter?.lang, DEFAULT_POLICY.feed.lang);
    assert.equal(q.filter?.originalsOnly, true);
  }
  assert.deepEqual(seen.map((q) => q.filter?.mediaOnly), [false, true]);
  assert.equal(seen[0]?.filter?.minApproval, 50, 'the start floor of 100, halved for a 30-minute window');
});

test('★ a dry run prices a whole day and asks nobody', async () => {
  const seen: DiscoveryQuery[] = [];
  const result = await run(feedSource({ all: 10, media: 3 }, seen), 'dry');
  assert.equal(seen.length, 0, 'no call left the process');
  const day = result.feedDays[0];
  assert.ok(day);
  const passes = 86_400_000 / CADENCE_MS;
  assert.ok(Math.abs(day.targetUsd - 1 * DEFAULT_POLICY.feed.budgetShare) < 1e-9, `at target: ${day.targetUsd}`);
  assert.ok(Math.abs(day.worstUsd - 2 * DEFAULT_POLICY.feed.pageLimit * USD_PER_POST * passes) < 1e-9, `worst: ${day.worstUsd}`);
  assert.equal(result.planned, 2);
});

test('★ after a live pass each lane moves toward its own target, and the move is kept', async () => {
  const floors = floorsStore();
  // At $1/day the targets are about 10.4 posts (all) and 3.5 (media) per pass.
  await run(feedSource({ all: 20, media: 1 }, []), 'live', floors);
  assert.equal(floors.held['all'], 120, 'twenty against ten: raised 20%');
  assert.equal(floors.held['media'], undefined, 'one against three and a half: lowered, but already at the minimum, so nothing to write');
});

test('★ a lane that returned nothing drops 40% and the other lane is held, not raised', async () => {
  const floors = floorsStore({ all: 1_000, media: 1_000 });
  await run(feedSource({ all: 20, media: 0 }, []), 'live', floors);
  assert.equal(floors.held['media'], 600);
  assert.equal(floors.held['all'], 1_000, 'never raise while the other lane is starving');
});

test('a dry run leaves the floors where they were', async () => {
  const floors = floorsStore({ all: 1_000, media: 1_000 });
  await run(feedSource({ all: 20, media: 0 }, []), 'dry', floors);
  assert.deepEqual(floors.held, { all: 1_000, media: 1_000 });
});

test('a stored floor is the one sent on the next pass', async () => {
  const seen: DiscoveryQuery[] = [];
  await run(feedSource({ all: 10, media: 3 }, seen), 'live', floorsStore({ all: 2_000, media: 400 }));
  assert.deepEqual(seen.map((q) => q.filter?.minApproval), [1_000, 200]);
});

test('DISCOVER_TERMS are extra searches on top of the catch-all, not instead of it', async () => {
  const seen: DiscoveryQuery[] = [];
  await run(feedSource({ all: 10, media: 3, term: 4 }, seen), 'live', floorsStore(), ['ceasefire']);
  assert.deepEqual(seen.map((q) => q.mode), ['catchall', 'catchall', 'keyword']);
  assert.equal(seen[2]?.term, 'ceasefire');
});

test('a source with no catch-all search and no term is unasked, by name', async () => {
  const result = await run(feedSource({ all: 0, media: 0 }, [], ['keyword']), 'live');
  assert.equal(result.unasked, 1);
});

test('★ a source whose `feed` needs a community name is never sent the catch-all lanes', async () => {
  const seen: DiscoveryQuery[] = [];
  const result = await run(feedSource({ all: 0, media: 0 }, seen, ['feed', 'keyword']), 'live');
  assert.equal(seen.length, 0);
  assert.equal(result.failed, 0, 'and so it is never counted as a failure');
  assert.equal(result.unasked, 1);
});
