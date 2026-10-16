/**
 * The recommendation feed finder: switched off it asks nothing; on, it asks once a slot, stores only
 * the videos young enough to credit (a video with no time is not young) under the 'trending' lane,
 * and a dry run prices the ask without sending it.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { inMemoryMeter } from '@insidor/meter';

import type { Logger } from '../log.ts';
import { trendingFeedClock, trendingFeedPass, youngOnly } from './trending-feed.ts';

const NOW = 1_800_000_000_000 as Millis;
const HOUR = 3_600_000;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const on: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, trending: { ...DEFAULT_POLICY.finders.trending, on: true } } };
const off: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, trending: { ...DEFAULT_POLICY.finders.trending, on: false } } };

const item = (id: string, ageMs: number | null) => ({ itemId: `vid:${id}`, sourceItemId: id, authorKey: `vid:a${id}`, postedAt: ageMs === null ? null : NOW - ageMs }) as unknown as Item;

function source(items: readonly Item[], calls: { n: number }): PlatformAdapter {
  return {
    id: 'vid',
    estimateTrendingFeed: () => ({ vendor: 'feedco', endpoint: 'feed', unit: 'per-call', units: 1, usd: 0.002 }),
    trendingFeed: async () => {
      calls.n += 1;
      return { value: { items, authors: items.map((i) => ({ authorKey: i.authorKey })), cursor: null, hasMore: false }, spend: { vendor: 'feedco', endpoint: 'feed', unit: 'per-call', units: 1, usd: 0.002, at: NOW } };
    },
  } as unknown as PlatformAdapter;
}

const deps = (policy: Policy, src: PlatformAdapter, stored: { lane: unknown; ids: string[] }[], mode: 'dry' | 'live' = 'live') => ({
  sources: () => [src],
  store: async (items: readonly Item[], _a: unknown, lane?: unknown) => {
    stored.push({ lane, ids: items.map((i) => i.sourceItemId) });
    return items.length;
  },
  meter: inMemoryMeter({ dailyCapUsd: 10, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
  mode,
  policy,
  log: quiet,
  now: () => NOW,
});

test('young only: under the age, and a video with no time is not young', () => {
  assert.deepEqual(youngOnly([item('1', HOUR), item('2', 30 * HOUR), item('3', null)], NOW, 6 * HOUR).map((i) => i.sourceItemId), ['1']);
});

test('★ switched off: asks nothing', async () => {
  const calls = { n: 0 };
  const r = await trendingFeedPass(deps(off, source([item('1', HOUR)], calls), []), trendingFeedClock());
  assert.equal(calls.n, 0);
  assert.equal(r.usd, 0);
});

test('on: once a slot, the young ones stored under the trending lane', async () => {
  const calls = { n: 0 };
  const stored: { lane: unknown; ids: string[] }[] = [];
  const clock = trendingFeedClock();
  const d = deps(on, source([item('1', HOUR), item('2', 300 * HOUR)], calls), stored);
  const r = await trendingFeedPass(d, clock);
  await trendingFeedPass(d, clock);
  assert.equal(calls.n, 1);
  assert.deepEqual(stored, [{ lane: 'trending', ids: ['1'] }]);
  assert.deepEqual([r.seen, r.young, r.stored], [2, 1, 1]);
});

test('a dry run prices the ask and sends nothing', async () => {
  const calls = { n: 0 };
  await trendingFeedPass(deps(on, source([item('1', HOUR)], calls), [], 'dry'), trendingFeedClock());
  assert.equal(calls.n, 0);
});
