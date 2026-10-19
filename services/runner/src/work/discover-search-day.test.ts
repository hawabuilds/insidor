/**
 * The X search day (`feed.searchDay`): one hard total for every catch-all search and the middle
 * lane, paced over the UTC day. The claims: a pass reads the day's bill once and keeps it current
 * from its own pages; a page that would take the bill past the pace is not asked, mid-ask as well
 * as before the first page; an unreadable bill asks no catch-all search; a term ask is not held to
 * it; off, nothing changes.
 *
 * The source is a fake at the adapter's edge that answers every page full with more to come, so
 * only our own limits end an ask.
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
import { discoverPass, memoryFreshClock } from './discover.ts';
import { memoryLaneLedger } from './lane-ledger.ts';

/* Noon UTC: half the day gone. */
const NOW = (Date.parse('2027-01-15T12:00:00Z')) as Millis;
const USD_PER_POST = 0.00015;
const PAGE_USD = 20 * USD_PER_POST;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - 600_000, firstSeenAt: NOW, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

function source(asked: DiscoveryQuery[]): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
    narrowedSearch: { filter: true, reproductionsOf: true },
  };
  let n = 0;
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      asked.push(q);
      const items = Array.from({ length: 20 }, () => item((n += 1)));
      return { value: { items, authors: [], cursor: `c${n}`, hasMore: true }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: 20, usd: PAGE_USD, at: NOW } } as unknown as Metered<Discovered>;
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
const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 100, spentUsd: 0, stopAtUsd: 100, remainingUsd: 100, unrecordedUsd: 0 }) } as unknown as Meter;

/* One language, the middle lane alone, paged fully: only a limit of ours ends it. */
const policy = (dailyUsd: number, on = true): Policy => ({
  ...DEFAULT_POLICY,
  feed: {
    ...DEFAULT_POLICY.feed,
    langs: ['en'],
    middle: { ...DEFAULT_POLICY.feed.middle, on: true, fullPaging: true, maxPages: 40, cap: { ...DEFAULT_POLICY.feed.middle.cap, dailyUsd: 100 } },
    searchDay: { on, dailyUsd, aheadMs: 0 },
  },
});

async function middlePass(p: Policy, spent: number | null | 'throw', terms: readonly string[] = []) {
  const asked: DiscoveryQuery[] = [];
  const r = await discoverPass({
    platforms: registry(source(asked)),
    store: async (items) => items.length,
    plan: { terms, cadenceMs: 120_000 },
    policy: p, meter: openMeter, mode: 'live', log: quiet, now: () => NOW, signal: new AbortController().signal,
    floors: { floors: async () => ({}), set: async () => undefined },
    dailyCapUsd: 1,
    middle: { ledger: memoryLaneLedger(), uncredited: async () => 0 },
    only: 'middle',
    fresh: memoryFreshClock(),
    searchDay: { spent: async () => { if (spent === 'throw') throw new Error('database is away'); return spent; } },
  });
  return { r, asked };
}

test('★ an ask pages only while the day\'s bill plus the next page fits the pace', async () => {
  /* $2 a day at noon allows $1; $0.988 already spent leaves room for four pages of $0.003. */
  const { r, asked } = await middlePass(policy(2), 0.988);
  assert.equal(asked.length, 4);
  assert.equal(r.answered, 1);
});

test('a day already at its pace asks nothing and says so as a pause with the numbers', async () => {
  const { r, asked } = await middlePass(policy(2), 0.999);
  assert.equal(asked.length, 0);
  const paused = r.outcomes.find((o) => o.kind === 'paused');
  assert.ok(paused !== undefined && paused.kind === 'paused');
  assert.equal(paused.capUsd, 1, 'the allowance now, not the whole day');
});

test('an unreadable bill asks no catch-all search', async () => {
  for (const spent of [null, 'throw'] as const) {
    const { r, asked } = await middlePass(policy(2), spent);
    assert.equal(asked.length, 0);
    assert.ok(r.outcomes.some((o) => o.kind === 'unasked'));
  }
});

test('off, the day is not read and nothing is held to it', async () => {
  const { asked } = await middlePass(policy(2, false), 1_000);
  assert.equal(asked.length, 40, 'the lane pages to its own limit');
});
