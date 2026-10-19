/**
 * Each language its own floor and its own share of the newest-posts money (`feed.langSplit`). The
 * claims: a fresh band asks each language at that language's floor; a language with a small share is
 * asked only once its window spans its spacing, and then for the whole of it; each language's floor
 * moves on what that language returned against its own target, so a busy language never raises
 * another's; a language with no floor of its own starts at the shared one; off, the shared floor
 * moves as before.
 *
 * The source is a fake at the adapter's edge answering each language with a scripted count.
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
import { discoverPass, memoryFreshClock, type FreshClock } from './discover.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const USD_PER_POST = 0.00015;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/* English and Korean, Korean at a hundredth of the money: 213 posts a day, so asked every 27 minutes a band. */
const P: Policy = {
  ...DEFAULT_POLICY,
  feed: {
    ...DEFAULT_POLICY.feed,
    langs: ['en', 'ko'],
    fresh: { ...DEFAULT_POLICY.feed.fresh, enabled: true, bandAgesMin: [6, 50], maxWindowMin: 15, late: { ...DEFAULT_POLICY.feed.fresh.late, on: false } },
    langSplit: { on: true, shares: { en: 0.99, ko: 0.01 }, bandsDailyUsd: 3.2, minPostsPerAsk: 2, maxEveryMs: 3_600_000 },
    searchDay: { ...DEFAULT_POLICY.feed.searchDay, on: false },
  },
};

function item(lang: string, i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `${lang}${i}`), source: sourceId('x'), sourceItemId: `${lang}${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - 10 * MIN, firstSeenAt: NOW, lang, text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

function source(asked: DiscoveryQuery[], count: (lang: string) => number): PlatformAdapter {
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
      const lang = q.filter?.langs?.[0] ?? '-';
      const items = Array.from({ length: count(lang) }, () => item(lang, (n += 1)));
      return { value: { items, authors: [], cursor: null, hasMore: false }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: Math.max(1, items.length), usd: Math.max(1, items.length) * USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
    },
    observe: async () => { throw new Error('not used'); },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => item('en', 0),
    baselineKey: () => 'x',
  };
}

const registry = (adapter: PlatformAdapter) => ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;
const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 100, spentUsd: 0, stopAtUsd: 100, remainingUsd: 100, unrecordedUsd: 0 }) } as unknown as Meter;

async function pass(at: Millis, policy: Policy, clock: FreshClock, held: Record<string, number>, count: (lang: string) => number) {
  const asked: DiscoveryQuery[] = [];
  const setLang: Record<string, number> = {};
  const setLane: Record<string, number> = {};
  await discoverPass({
    platforms: registry(source(asked, count)),
    store: async (items) => items.length,
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter: openMeter, mode: 'live', log: quiet, now: () => at, signal: new AbortController().signal,
    floors: {
      floors: async () => ({ all: 510 }),
      set: async (lane, floor) => void (setLane[lane] = floor),
      langFloors: async () => held,
      setLang: async (lang, floor) => void (setLang[lang] = floor),
    },
    dailyCapUsd: 17,
    lanes: ['all', 'media'],
    fresh: clock,
  });
  return { asked, setLang, setLane };
}

const byLang = (asked: readonly DiscoveryQuery[], lang: string) => asked.filter((q) => q.filter?.langs?.[0] === lang);

test('★ each language is asked at its own floor, scaled to the band', async () => {
  const { asked } = await pass(NOW, P, memoryFreshClock(), { en: 300, ko: 5_000 }, () => 1);
  assert.deepEqual(byLang(asked, 'en').map((q) => q.filter?.minApproval), [30, 250]);
  assert.deepEqual(byLang(asked, 'ko').map((q) => q.filter?.minApproval), [500, 4_167]);
});

test('★ a small share is asked only once its window spans its spacing, and then for all of it', async () => {
  const clock = memoryFreshClock();
  await pass(NOW, P, clock, { en: 300, ko: 5_000 }, () => 1);
  const four = await pass((NOW + 4 * MIN) as Millis, P, clock, { en: 300, ko: 5_000 }, () => 1);
  assert.equal(byLang(four.asked, 'en').length, 2, 'English every pass');
  assert.equal(byLang(four.asked, 'ko').length, 0, 'Korean waits: four minutes of posting time buy it under two posts');
  const later = await pass((NOW + 28 * MIN) as Millis, P, clock, { en: 300, ko: 5_000 }, () => 1);
  const ko = byLang(later.asked, 'ko');
  assert.equal(ko.length, 2);
  for (const q of ko) assert.equal((q.untilMs! - q.sinceMs!) / MIN, 28, 'from where its last ask ended: nothing skipped');
});

test('★ each language moves its own floor on its own result; a busy language never raises another', async () => {
  /* English's target for two 15-minute windows: 21,120 posts a day × 30 / 2,880 = 220. */
  const busyKo = await pass(NOW, P, memoryFreshClock(), { en: 300, ko: 5_000 }, (lang) => (lang === 'ko' ? 500 : 100));
  assert.equal(busyKo.setLang['ko'], 6_000, 'Korean far over its target: raised');
  assert.equal(busyKo.setLang['en'], undefined, 'English, 200 against its 220, is held and nothing is written, whatever Korean did');
  const quietKo = await pass(NOW, P, memoryFreshClock(), { en: 300, ko: 5_000 }, (lang) => (lang === 'ko' ? 0 : 200));
  assert.equal(quietKo.setLang['ko'], 3_000, 'empty: lowered at once');
  assert.equal(busyKo.setLane['all'], undefined, 'the shared floor is not moved by the bands');
});

test('a language with no floor of its own starts at the shared one, and keeps the one it reaches', async () => {
  const { asked, setLang } = await pass(NOW, P, memoryFreshClock(), {}, () => 1);
  assert.deepEqual(byLang(asked, 'ko').map((q) => q.filter?.minApproval), [51, 425]);
  assert.ok(setLang['ko'] !== undefined && setLang['en'] !== undefined, 'written even when held, so a restart starts there');
});

test('off, the languages share the floor and the bands move it, as before', async () => {
  const off: Policy = { ...P, feed: { ...P.feed, langSplit: { ...P.feed.langSplit, on: false } } };
  const { asked, setLang, setLane } = await pass(NOW, off, memoryFreshClock(), { en: 300, ko: 5_000 }, () => 100);
  assert.deepEqual(byLang(asked, 'ko').map((q) => q.filter?.minApproval), [51, 425]);
  assert.deepEqual(setLang, {});
  assert.ok(setLane['all'] !== undefined);
});
