/**
 * Paging past short pages (`feed.paging`, `feed.middle.fullPaging`), against a source that answers
 * the way the posts supplier has since 2026-10-16 23:15 UTC: pages of 6, 12, 3, 5 and 1 posts, each
 * saying there is more, then a last page saying there is not (the paid probe of 2026-10-18).
 *
 * The claims: the middle lane, in the discover pass and in its own loop, follows those pages to the
 * source's end; it stops at `maxPages`, its deadline, its cap and `maxEmptyRun` empty pages in a
 * row; a search left on the old rule still stops at its first short page (every search but the
 * middle lane, as shipped); and a search switched to `full` follows the pages inside its own day,
 * kept in the ledger as `search:<name>`, and keeps the old rule when it has no readable day.
 *
 * The source is a fake at the adapter's edge: the same pages for every ask, recorded per ask.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis, Policy } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { Budget, CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter, PlannedCall } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY, type SearchPagingPolicy } from '@insidor/contracts/policy.ts';
import { pacedDailyUsd } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { middleLoop } from '../loops/middle.ts';
import { discoverPass, pagingKey } from './discover.ts';
import { memoryLaneLedger, type LaneLedger } from './lane-ledger.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const USD_PER_POST = 0.00015;
/* The probe's middle pages, every one with more to come. */
const PROBE = [6, 12, 3, 5, 1];
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

/* One language: these tests are about lanes and paging. Asking each language as its own search is work/discover-languages.test.ts. */
/* One language everywhere, the late band's (`fresh.late.langs`, `slow.langs`) too, so a page count is one search's. */
const withFeed = (feed: Partial<Policy['feed']>): Policy => ({
  ...DEFAULT_POLICY,
  feed: {
    ...DEFAULT_POLICY.feed,
    langs: ['en'],
    slow: { ...DEFAULT_POLICY.feed.slow, langs: ['en'] },
    /* One late band, the 5-hour one these cases count pages for; the 8-hour band (v196) pages the same way. */
    fresh: { ...DEFAULT_POLICY.feed.fresh, late: { ...DEFAULT_POLICY.feed.fresh.late, langs: ['en'], bands: [DEFAULT_POLICY.feed.fresh.late.bands[0]!] } },
    ...feed,
  },
});
const ON = withFeed({ middle: { ...DEFAULT_POLICY.feed.middle, on: true } });
const OLD_MIDDLE = withFeed({ middle: { ...DEFAULT_POLICY.feed.middle, on: true, fullPaging: false } });
/* Every listed search on the old rule, as before the re-split of 2026-10-19, so one can be switched on alone. */
const OLD_SEARCHES = Object.fromEntries(Object.entries(DEFAULT_POLICY.feed.paging.searches).map(([name, s]) => [name, { ...s, full: false }]));
const searchOn = (name: string, over: Partial<SearchPagingPolicy> = {}): Policy => {
  const listed = DEFAULT_POLICY.feed.paging.searches[name];
  assert.ok(listed !== undefined, `${name} is listed`);
  return withFeed({ middle: { ...DEFAULT_POLICY.feed.middle, on: false }, paging: { ...DEFAULT_POLICY.feed.paging, searches: { ...OLD_SEARCHES, [name]: { ...listed, full: true, ...over } } } });
};

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('x'), `p${i}`), source: sourceId('x'), sourceItemId: `p${i}`, origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${i}`), postedAt: NOW - 60 * MIN, firstSeenAt: NOW, lang: 'en', text: `post ${i}`,
    media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `t/${i}`,
  };
}

const isMiddle = (q: DiscoveryQuery): boolean => q.filter?.minApproval === DEFAULT_POLICY.feed.middle.minApproval && q.sinceMs !== null && q.untilMs !== null && q.untilMs - q.sinceMs === (DEFAULT_POLICY.feed.middle.maxAgeMin - DEFAULT_POLICY.feed.middle.minAgeMin) * MIN;

/**
 * Every ask is answered page by page from `pages` (posts per page); the last one says there is no
 * more unless `endless`. `onPage` runs before each answer (a clock). Asks are told apart by their
 * window, so each gets its own run through the pages.
 */
function source(seen: DiscoveryQuery[], pages: readonly number[], opts: { endless?: boolean; onPage?: () => void } = {}): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('x'), counters: ['reach'], absent: [], fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'catchall'], observeBatchSize: 100, lineage: true, billing: 'per-item-returned',
  };
  return {
    id: sourceId('x'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery, _b: Budget) => {
      seen.push(q);
      opts.onPage?.();
      const page = q.cursor === null ? 0 : Number(q.cursor);
      const n = page < pages.length ? pages[page]! : 0;
      const more = opts.endless === true || page + 1 < pages.length;
      const base = 1_000 * page + 100_000 * (q.filter?.minApproval ?? 0) + (q.sinceMs ?? 0) % 100_000;
      const items = Array.from({ length: n }, (_v, k) => item(base + k));
      return { value: { items, authors: [], cursor: more ? String(page + 1) : null, hasMore: more }, spend: { vendor: 'x', endpoint: 'search', unit: 'per-item-returned', units: Math.max(1, n), usd: Math.max(1, n) * USD_PER_POST, at: NOW } } as unknown as Metered<Discovered>;
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

function pass(adapter: PlatformAdapter, policy: Policy, opts: { middle?: LaneLedger; ledger?: LaneLedger; now?: () => Millis; only?: 'middle' } = {}) {
  const stored: { lane: unknown; n: number }[] = [];
  const result = discoverPass({
    platforms: registry(adapter),
    store: async (items, _a, lane) => {
      stored.push({ lane, n: items.length });
      return items.length;
    },
    plan: { terms: [], cadenceMs: 120_000 },
    policy, meter, mode: 'live', log: quiet, now: opts.now ?? (() => NOW), signal: new AbortController().signal,
    floors, dailyCapUsd: 1,
    ...(opts.middle === undefined ? {} : { middle: { ledger: opts.middle, uncredited: async () => 0 } }),
    ...(opts.ledger === undefined ? {} : { ledger: opts.ledger }),
    ...(opts.only === undefined ? {} : { only: opts.only }),
  });
  return { result, stored };
}

/* The late band's asks: its window ends at its age (the fresh bands are minutes old, the middle lane is told apart by its width). */
const LATE_AGE_MIN = DEFAULT_POLICY.feed.fresh.late.bands[0]!.ageMin;
const lateAsks = (seen: readonly DiscoveryQuery[]) => seen.filter((q) => !isMiddle(q) && q.untilMs !== null && NOW - q.untilMs >= (LATE_AGE_MIN - 1) * MIN);

test('★ as shipped: the middle lane and every other catch-all search read past short pages, each in its own day', () => {
  assert.equal(DEFAULT_POLICY.feed.middle.fullPaging, true);
  assert.equal(DEFAULT_POLICY.feed.middle.maxPages, 40);
  assert.equal(DEFAULT_POLICY.feed.middle.passDeadlineMs, 180_000);
  assert.equal(DEFAULT_POLICY.feed.middle.cap.dailyUsd, 3);
  assert.deepEqual(Object.keys(DEFAULT_POLICY.feed.paging.searches).sort(), ['band_50', 'band_6', 'late_300', 'late_480', 'slow']);
  for (const [name, s] of Object.entries(DEFAULT_POLICY.feed.paging.searches)) {
    assert.equal(s.full, true, `${name} reads to the source's end (the re-split of 2026-10-19)`);
    assert.ok(s.dailyUsd > 0 && s.maxPages >= 1 && s.passDeadlineMs > 0, `${name} has its own day`);
  }
  assert.equal(pagingKey({ lane: 'all', slice: false, band: 6, late: false, middle: false }), 'band_6');
  assert.equal(pagingKey({ lane: 'slow', slice: false, band: 300, late: true, middle: false }), 'late_300');
  assert.equal(pagingKey({ lane: 'slow', slice: false, band: 480, late: true, middle: false }), 'late_480');
  assert.equal(pagingKey({ lane: 'slow', slice: true, band: null, late: false, middle: false }), 'slow');
  assert.equal(pagingKey({ lane: null, slice: false, band: null, late: false, middle: true }), null);
});

test('★ the middle loop follows the probe\'s short pages to the source\'s end, and charges every page', async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: { lane: unknown; n: number }[] = [];
  const ledger = memoryLaneLedger();
  const loop = middleLoop({
    platforms: registry(source(seen, [...PROBE, 4])),
    store: async (items, _a, lane) => {
      stored.push({ lane, n: items.length });
      return items.length;
    },
    policy: ON, meter, mode: 'live', log: quiet, floors, dailyCapUsd: 1,
    middle: { ledger, uncredited: async () => 0 },
  });
  await loop.run({ signal: new AbortController().signal, now: () => NOW });
  assert.equal(seen.length, 6, 'six pages: five short ones with more to come, and the last');
  assert.ok(seen.every(isMiddle));
  assert.deepEqual(stored, [{ lane: 'middle', n: 31 }]);
  assert.ok(Math.abs(((await ledger.spent('middle', NOW)) ?? 0) - 31 * USD_PER_POST) < 1e-12);
});

test('★ the middle lane on the old rule stops at the first short page', async () => {
  const seen: DiscoveryQuery[] = [];
  await pass(source(seen, [...PROBE, 4]), OLD_MIDDLE, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.equal(seen.filter(isMiddle).length, 1);
});

test('★ the middle lane stops at maxPages (40) on a window that never ends', async () => {
  const seen: DiscoveryQuery[] = [];
  const long = Array.from({ length: 100 }, (_v, i) => PROBE[i % PROBE.length]!);
  const { result, stored } = pass(source(seen, long), ON, { middle: memoryLaneLedger(), only: 'middle' });
  await result;
  assert.equal(seen.filter(isMiddle).length, DEFAULT_POLICY.feed.middle.maxPages);
  assert.equal(stored.length, 1);
});

test('★ the middle lane stops at its three-minute deadline', async () => {
  const seen: DiscoveryQuery[] = [];
  let now = NOW as number;
  /* Ten seconds a page: page 19 is asked at 180 s, so the check before it ends the pass at 18. */
  const adapter = source(seen, Array.from({ length: 100 }, () => 5), { onPage: () => { now += 10_000; } });
  await pass(adapter, ON, { middle: memoryLaneLedger(), only: 'middle', now: () => now as Millis }).result;
  assert.equal(seen.filter(isMiddle).length, DEFAULT_POLICY.feed.middle.passDeadlineMs / 10_000);
});

test('★ the middle lane stops at its own cap', async () => {
  const seen: DiscoveryQuery[] = [];
  const pageUsd = DEFAULT_POLICY.feed.pageLimit * USD_PER_POST;
  /* Each page is checked at its full reservation; short pages cost less, so room for 2.5 reservations reads a few. */
  const cap = DEFAULT_POLICY.feed.middle.cap.dailyUsd;
  const ledger = memoryLaneLedger({ middle: cap - 2.5 * pageUsd });
  await pass(source(seen, Array.from({ length: 100 }, () => 5), { endless: true }), ON, { middle: ledger, only: 'middle' }).result;
  const asked = seen.filter(isMiddle).length;
  assert.ok(asked > 1 && asked < 100, `stopped by the cap after ${asked} pages`);
  assert.ok(((await ledger.spent('middle', NOW)) ?? 0) <= cap);
});

test('★ three empty pages in a row end the paging though the source says there is more', async () => {
  const seen: DiscoveryQuery[] = [];
  await pass(source(seen, [6, 0, 0, 0, 5, 5], { endless: true }), ON, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.equal(seen.filter(isMiddle).length, 1 + DEFAULT_POLICY.feed.paging.maxEmptyRun);
  const seen2: DiscoveryQuery[] = [];
  /* Two empties and a post resets the run. */
  await pass(source(seen2, [6, 0, 0, 3, 0, 0, 4]), ON, { middle: memoryLaneLedger(), only: 'middle' }).result;
  assert.equal(seen2.filter(isMiddle).length, 7);
});

test('★ the discover pass, as shipped: each band and the late band read the short pages to the source\'s end, each in its own day', async () => {
  const seen: DiscoveryQuery[] = [];
  const ledger = memoryLaneLedger();
  const { result } = pass(source(seen, [...PROBE, 4]), withFeed({ middle: { ...DEFAULT_POLICY.feed.middle, on: false } }), { ledger });
  await result;
  assert.equal(lateAsks(seen).length, 6, 'the late band: all six pages');
  assert.equal(seen.length, 6 * (DEFAULT_POLICY.feed.fresh.bandAgesMin.length + 1), 'six pages for each band and the late band');
  for (const name of [...DEFAULT_POLICY.feed.fresh.bandAgesMin.map((a) => `band_${a}`), `late_${LATE_AGE_MIN}`]) {
    assert.ok(Math.abs(((await ledger.spent(`search:${name}`, NOW)) ?? 0) - 31 * USD_PER_POST) < 1e-12, `${name} charged its own day`);
  }
});

test('the discover pass with every search on the old rule reads one short page each, and touches no ledger', async () => {
  const seen: DiscoveryQuery[] = [];
  const ledger = memoryLaneLedger();
  const { result } = pass(source(seen, [...PROBE, 4]), withFeed({ middle: { ...DEFAULT_POLICY.feed.middle, on: false }, paging: { ...DEFAULT_POLICY.feed.paging, searches: OLD_SEARCHES } }), { ledger });
  await result;
  assert.equal(seen.length, DEFAULT_POLICY.feed.fresh.bandAgesMin.length + 1);
  assert.equal(ledger.totals.size, 0);
});

test('★ a search switched on follows the short pages inside its own day, kept as search:<name>', async () => {
  const seen: DiscoveryQuery[] = [];
  const ledger = memoryLaneLedger();
  const late = DEFAULT_POLICY.feed.fresh.late.bands[0]!;
  await pass(source(seen, [...PROBE, 4]), searchOn(`late_${late.ageMin}`), { ledger }).result;
  assert.equal(lateAsks(seen).length, 6, 'the late band to the source\'s end');
  assert.equal(seen.length - 6, DEFAULT_POLICY.feed.fresh.bandAgesMin.length, 'the bands still one page each');
  assert.ok(Math.abs(((await ledger.spent(`search:late_${late.ageMin}`, NOW)) ?? 0) - 31 * USD_PER_POST) < 1e-12);
});

test('★ a search switched on stops at its day, and is paused once the day is spent', async () => {
  const late = DEFAULT_POLICY.feed.fresh.late.bands[0]!;
  const name = `late_${late.ageMin}`;
  const day = DEFAULT_POLICY.feed.paging.searches[name]!.dailyUsd;
  const pageUsd = DEFAULT_POLICY.feed.pageLimit * USD_PER_POST;
  const seen: DiscoveryQuery[] = [];
  const ledger = memoryLaneLedger({ [`search:${name}`]: day - 2.5 * pageUsd });
  /* Unpaced, so its whole day is open at NOW: this is the hard day, not the pace. */
  await pass(source(seen, Array.from({ length: 100 }, () => 5), { endless: true }), searchOn(name, { maxPages: 100, paced: false }), { ledger }).result;
  const asked = lateAsks(seen).length;
  assert.ok(asked > 1 && asked < 100, `stopped by its day after ${asked} pages`);
  assert.ok(((await ledger.spent(`search:${name}`, NOW)) ?? 0) <= day);

  const seen2: DiscoveryQuery[] = [];
  const { result } = pass(source(seen2, PROBE), searchOn(name, { paced: false }), { ledger: memoryLaneLedger({ [`search:${name}`]: day }) });
  const r = await result;
  assert.equal(lateAsks(seen2).length, 0);
  assert.ok(r.outcomes.some((o) => o.kind === 'paused' && o.capUsd === day));
});

test('★ a paced search that starts inside its pace reads its window to the end (policy.v185 `paceBeforeAskOnly`), held only to its whole day', async () => {
  const late = DEFAULT_POLICY.feed.fresh.late.bands[0]!;
  const name = `late_${late.ageMin}`;
  const pageUsd = DEFAULT_POLICY.feed.pageLimit * USD_PER_POST;
  const paceNow = pacedDailyUsd(DEFAULT_POLICY.feed.paging.searches[name]!.dailyUsd, NOW, DEFAULT_POLICY);
  /* Room under the pace for the first page and a little: twelve pages of five posts follow. */
  const spent = { [`search:${name}`]: paceNow - 1.5 * pageUsd };
  const pages = Array.from({ length: 12 }, () => 5);
  const on = searchOn(name, { maxPages: 100, paced: true });
  const seen: DiscoveryQuery[] = [];
  await pass(source(seen, pages), on, { ledger: memoryLaneLedger(spent) }).result;
  assert.equal(lateAsks(seen).length, 12, 'every page of the window, past the pace');

  /* The rule before v185: the pace is checked before every page, and the window is left part-read. */
  const off: Policy = { ...on, feed: { ...on.feed, paging: { ...on.feed.paging, paceBeforeAskOnly: false } } };
  const seen2: DiscoveryQuery[] = [];
  await pass(source(seen2, pages), off, { ledger: memoryLaneLedger(spent) }).result;
  assert.ok(lateAsks(seen2).length < 12, `stopped by the pace after ${lateAsks(seen2).length} pages`);

  /* Ahead of its pace, it is not asked at all: the next pass waits. */
  const seen3: DiscoveryQuery[] = [];
  await pass(source(seen3, pages), on, { ledger: memoryLaneLedger({ [`search:${name}`]: paceNow }) }).result;
  assert.equal(lateAsks(seen3).length, 0);
});

test('★ a search switched on keeps its deadline and maxPages', async () => {
  const late = DEFAULT_POLICY.feed.fresh.late.bands[0]!;
  const name = `late_${late.ageMin}`;
  const seen: DiscoveryQuery[] = [];
  await pass(source(seen, Array.from({ length: 100 }, () => 5), { endless: true }), searchOn(name, { maxPages: 4 }), { ledger: memoryLaneLedger() }).result;
  assert.equal(lateAsks(seen).length, 4);

  const seen2: DiscoveryQuery[] = [];
  let now = NOW as number;
  await pass(source(seen2, Array.from({ length: 100 }, () => 5), { endless: true, onPage: () => { now += 10_000; } }), searchOn(name, { maxPages: 100, passDeadlineMs: 30_000 }), { ledger: memoryLaneLedger(), now: () => now as Millis }).result;
  assert.equal(lateAsks(seen2).length, 3, 'pages at 10, 20 and 30 s; the check before the fourth finds 30 s gone');
});

test('★ a search switched on with no readable day keeps the old rule', async () => {
  const late = DEFAULT_POLICY.feed.fresh.late.bands[0]!;
  const seen: DiscoveryQuery[] = [];
  await pass(source(seen, [...PROBE, 4]), searchOn(`late_${late.ageMin}`), { ledger: { spent: async () => null, add: async () => undefined } }).result;
  assert.equal(lateAsks(seen).length, 1);
  const seen2: DiscoveryQuery[] = [];
  await pass(source(seen2, [...PROBE, 4]), searchOn(`late_${late.ageMin}`), {}).result;
  assert.equal(lateAsks(seen2).length, 1, 'no ledger wired: the old rule');
});
