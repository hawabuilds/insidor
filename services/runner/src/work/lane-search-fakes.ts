/**
 * Test doubles for the lane searches (work/lane-search.ts and its two callers): a source that pages
 * through a fixed number of posts and records each query, an always-open meter, and a post.
 *
 * Its own file, not a test file, so the three tests share one fake without importing each other
 * (an imported test file runs its tests again). Never imported by the runner itself.
 *
 * What breaks if changed carelessly: the fake bills one post at least per page, as the text source
 * does; billing an empty page at zero would hide the per-request floor the caps are sized by.
 */

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';

export const NOW = 1_800_000_000_000 as Millis;
export const USD_PER_POST = 0.00015;
const PAGE = 20;

export function fakeItem(i: number, at: Millis = NOW): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: at, firstSeenAt: NOW, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

/** A source that pages through `posts(query)` posts, 20 a page, billing a post returned (one at least). */
export function pagingSource(seen: DiscoveryQuery[], posts: (q: DiscoveryQuery) => number, caps: Partial<Capabilities> = {}): PlatformAdapter {
  return {
    id: sourceId('x'),
    capabilities: {
      source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
      discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
      narrowedSearch: { filter: true, reproductionsOf: true }, ...caps,
    },
    discover: async (q: DiscoveryQuery) => {
      seen.push(q);
      const total = posts(q);
      const start = q.cursor === null ? 0 : Number(q.cursor);
      const n = Math.max(0, Math.min(PAGE, total - start));
      const more = start + n < total;
      const items = Array.from({ length: n }, (_v, k) => fakeItem(start + k));
      return { value: { items, authors: [], cursor: more ? String(start + n) : null, hasMore: more }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: Math.max(1, n), usd: Math.max(1, n) * USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
    },
    observe: async () => {
      throw new Error('not used');
    },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => fakeItem(0),
    baselineKey: () => 'x',
  };
}

export const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

