/**
 * A band whose day runs short, shared fairly among its languages (the owner's "did we
 * catch these?" of 2026-10-25). The claims: when a search's day has room for one page, the language
 * that has waited longest is asked, not the first in `feed.langs` every pass; a language cut short by
 * a day raises its floor rather than reading its truncated count, and one stopped by its window or a
 * page limit moves as before; the slow slices tile posting time by a clock, so a pass that comes
 * late leaves no gap at a slice's age; and both newest-post bands spread their day over the day.
 *
 * Why these exist: from the 6-minute band's pacing (2026-10-24 12:12 UTC) its day closed inside the
 * first round of every ask, English's page was always first, and Japanese, French, Spanish, Korean,
 * Chinese and Turkish were left out of nearly every ask for a day — the Japanese cat of 25 Oct 05:43
 * (526k views by its first reading) fell in a 27-minute stretch of posting time that no Japanese
 * newest-post search ever asked.
 *
 * The source is a fake at the adapter's edge: one post a page, always with more to come.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, FeedLane, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { discoverPass, memoryFreshClock, sliceKey, type FreshClock } from './discover.ts';
import { memoryLaneLedger } from './lane-ledger.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const USD_PER_POST = 0.00015;
const PAGE_USD = DEFAULT_POLICY.feed.pageLimit * USD_PER_POST;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/* English and Japanese, both asked every pass, on one 6-minute band whose day is `dailyUsd`. */
const withBandDay = (dailyUsd: number): Policy => ({
  ...DEFAULT_POLICY,
  feed: {
    ...DEFAULT_POLICY.feed,
    langs: ['en', 'ja'],
    fresh: { ...DEFAULT_POLICY.feed.fresh, enabled: true, bandAgesMin: [6], maxWindowMin: 15, late: { ...DEFAULT_POLICY.feed.fresh.late, on: false } },
    langSplit: { on: true, shares: { en: 0.5, ja: 0.5 }, bandsDailyUsd: 100, minPostsPerAsk: 2, maxEveryMs: 3_600_000 },
    searchDay: { ...DEFAULT_POLICY.feed.searchDay, on: false },
    paging: { ...DEFAULT_POLICY.feed.paging, searches: { band_6: { full: true, maxPages: 5, passDeadlineMs: 60_000, dailyUsd } } },
  },
});
/* Room for exactly one page: the first is asked at 0 + a page's quote, the second would pass it. */
const ONE_PAGE = withBandDay(PAGE_USD);
const OPEN = withBandDay(100);

let n = 0;
function item(lang: string): Item {
  n += 1;
  return {
    itemId: itemId(sourceId('x'), `${lang}${n}`), source: sourceId('x'), sourceItemId: `${lang}${n}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${n}`), postedAt: NOW - 10 * MIN, firstSeenAt: NOW, lang, text: `post ${n}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${n}`,
  };
}

function source(asked: DiscoveryQuery[]): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
    narrowedSearch: { filter: true, reproductionsOf: true },
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      asked.push(q);
      const page = q.cursor === null ? 0 : Number(q.cursor);
      const items = [item(q.filter?.langs?.[0] ?? '-')];
      return { value: { items, authors: [], cursor: String(page + 1), hasMore: true }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: 1, usd: USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
    },
    observe: async () => { throw new Error('not used'); },
    estimate: (call: PlannedCall): CostEstimate => {
      const units = call.kind === 'discover' ? call.query.limit : call.sourceItemIds.length;
      return { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', estUnits: units, usd: units * USD_PER_POST };
    },
    toItem: () => item('en'),
    baselineKey: () => 'x',
  };
}

const registry = (adapter: PlatformAdapter) => ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;
const openMeter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 100, spentUsd: 0, stopAtUsd: 100, remainingUsd: 100, unrecordedUsd: 0 }) } as unknown as Meter;

/* One pass, with a fresh day in the ledger each time so every pass has the same room. */
async function pass(at: Millis, policy: Policy, clock: FreshClock, lanes: readonly FeedLane[] = ['all', 'media']) {
  const asked: DiscoveryQuery[] = [];
  const setLang: Record<string, number> = {};
  await discoverPass({
    platforms: registry(source(asked)),
    store: async (items) => items.length,
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter: openMeter, mode: 'live', log: quiet, now: () => at, signal: new AbortController().signal,
    floors: {
      floors: async () => ({ all: 510, slow: 9_000 }),
      set: async () => undefined,
      langFloors: async () => ({ en: 1_000, ja: 1_000 }),
      setLang: async (lang, floor) => void (setLang[lang] = floor),
    },
    dailyCapUsd: 17,
    lanes,
    fresh: clock,
    ledger: memoryLaneLedger(),
  });
  return { asked, setLang };
}

const langOf = (q: DiscoveryQuery): string | undefined => q.filter?.langs?.[0];

test('★ a day with room for one page asks the language that has waited longest, not the first listed every pass', async () => {
  const clock = memoryFreshClock();
  const first = await pass(NOW, ONE_PAGE, clock);
  assert.deepEqual(first.asked.map(langOf), ['en'], 'windows equal: the list order, and the day closes after one page');
  const second = await pass((NOW + 2 * MIN) as Millis, ONE_PAGE, clock);
  assert.deepEqual(second.asked.map(langOf), ['ja'], 'Japanese was left out and its window is still open: it goes first');
  const ja = second.asked[0]!;
  /* A first ask reaches back the cap plus the language's own spacing (core langBandWindow): Japanese's is under a second here. */
  assert.ok(ja.untilMs! - ja.sinceMs! >= 15 * MIN && ja.untilMs! - ja.sinceMs! < 16 * MIN, 'its whole window, from where it stood');
  const third = await pass((NOW + 4 * MIN) as Millis, ONE_PAGE, clock);
  assert.deepEqual(third.asked.map(langOf), ['en'], 'and back: English has now waited longest');
});

test('★ a language cut short by the day raises its floor; one stopped by a page limit moves on its count as before', async () => {
  const cut = await pass(NOW, ONE_PAGE, memoryFreshClock());
  assert.equal(cut.setLang['en'], Math.ceil(1_000 * DEFAULT_POLICY.feed.raiseFactor), 'one post against a target in the hundreds, but the day stopped it: raised');
  assert.equal(cut.setLang['ja'], undefined, 'never asked: nothing it returned to move on');
  const paged = await pass(NOW, OPEN, memoryFreshClock());
  assert.equal(paged.setLang['en'], Math.floor(1_000 * DEFAULT_POLICY.feed.lowerFactor), 'five pages and its page limit, far under target: lowered');
});

test('★ the slow slices tile posting time: a pass 17 minutes after the last asks 17 minutes at each age, from where it stopped', async () => {
  const policy: Policy = { ...OPEN, feed: { ...OPEN.feed, slow: { ...OPEN.feed.slow, langs: ['en'] } } };
  const isSlice = (q: DiscoveryQuery): boolean => q.untilMs !== null && NOW - q.untilMs >= 100 * MIN;
  const clock = memoryFreshClock();
  const one = (await pass(NOW, policy, clock, ['all', 'media', 'slow'])).asked.filter(isSlice);
  assert.ok(one.length > 0);
  for (const q of one) assert.equal(q.untilMs! - q.sinceMs!, 15 * MIN, 'a start: each slice its own width');
  assert.equal(clock.lastUntil(sliceKey('x', 360)), NOW - 345 * MIN, 'the six-hour slice\'s window is kept');
  const later = (NOW + 17 * MIN) as Millis;
  const two = (await pass(later, policy, clock, ['all', 'media', 'slow'])).asked.filter((q) => q.untilMs !== null && later - q.untilMs >= 100 * MIN);
  const six = two.find((q) => q.untilMs === later - 345 * MIN);
  assert.ok(six !== undefined);
  assert.equal(six.sinceMs, NOW - 345 * MIN, 'from where the last six-hour ask ended: the two minutes a fixed slice would skip are asked');
});

test('as shipped (policy.v181): both newest-post bands spread their day, so neither goes dark for the evening', () => {
  const searches = DEFAULT_POLICY.feed.paging.searches;
  assert.equal(searches['band_6']?.paced, true);
  assert.equal(searches['band_50']?.paced, true, 'unpaced it spent its day by 19:22 UTC on 24 Oct and asked nothing after');
  assert.equal(searches['band_50']?.dailyUsd, 1.2, 'the same day, spread');
});
