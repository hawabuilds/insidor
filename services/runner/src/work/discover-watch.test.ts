/**
 * The watch: a source that cannot be asked for "everything" (no catch-all) is asked by word
 * from the owner's list in policy, one page at a time, and — when each ask costs money — only
 * as often as its share of the supplier's line allows.
 *
 * Why its own file: the catch-all pass (discover-feed.test.ts) and the term/outcome rules
 * (discover.test.ts) are about other sources. What this file guards is the spacing, and a
 * spacing nobody tests is a paid scraper run every two minutes the first time somebody
 * refactors the pass.
 *
 * The source is a fake that records every query and is priced per run, like the short-video
 * source; nothing here talks to a vendor.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import type { CostEstimate, Meter, Metered } from '@insidor/contracts/ports/meter.ts';
import type { Capabilities, Discovered, DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';

import type { Logger } from '../log.ts';
import { discoverPass, memoryWatchClock, watchAskDue, watchEveryMs, watchTermFor, watchTermsFor, type WatchClock } from './discover.ts';

const NOW = 1_800_000_000_000 as Millis;
const CADENCE_MS = 120_000;
const MS_PER_DAY = 86_400_000;
const USD_PER_RUN = 0.081;
const LINE_USD = 3;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function item(i: number): Item {
  return {
    itemId: itemId(sourceId('tiktok'), `v${i}`),
    source: sourceId('tiktok'),
    sourceItemId: `v${i}`,
    origin: 'observed',
    authorKey: authorKey(sourceId('tiktok'), `a${i}`),
    postedAt: NOW - 60_000,
    firstSeenAt: NOW,
    lang: 'en',
    text: `video ${i}`,
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `t/${i}`,
  };
}

/** A source with keyword search and no catch-all, billed per run, answering every ask with `returns` posts. */
function watchedSource(seen: DiscoveryQuery[], usdPerRun = USD_PER_RUN, returns = 3): PlatformAdapter {
  const caps: Capabilities = {
    source: sourceId('tiktok'),
    counters: ['reach'],
    absent: [],
    fidelity: { reach: { kind: 'exact' } },
    discovery: ['keyword', 'hashtag', 'feed', 'account'],
    observeBatchSize: 50,
    lineage: true,
    billing: 'per-run',
  };
  return {
    id: sourceId('tiktok'),
    capabilities: caps,
    discover: async (q: DiscoveryQuery) => {
      seen.push(q);
      return {
        value: { items: Array.from({ length: returns }, (_v, i) => item(i)), authors: [], cursor: null, hasMore: false },
        spend: [],
      } as unknown as Metered<Discovered>;
    },
    observe: async () => {
      throw new Error('not used');
    },
    estimate: (): CostEstimate => ({ vendor: 'apify', endpoint: 'discover', unit: 'per-run', estUnits: 1, usd: usdPerRun }),
    toItem: () => item(0),
    baselineKey: () => 'tiktok',
  };
}

const registry = (adapter: PlatformAdapter): PlatformRegistry =>
  ({ get: () => adapter, all: () => [adapter], has: () => true, absent: () => [] }) as unknown as PlatformRegistry;

const meterWith = (mayspend: boolean): Meter =>
  ({
    record: () => undefined,
    spentUsd: () => 0,
    mayspend: () => mayspend,
    line: () => ({ capUsd: LINE_USD, spentUsd: 0, stopAtUsd: LINE_USD, remainingUsd: mayspend ? LINE_USD : 0, unrecordedUsd: 0 }),
  }) as unknown as Meter;

function pass(adapter: PlatformAdapter, at: number, watch: WatchClock, opts: { terms?: readonly string[]; mode?: 'live' | 'dry'; mayspend?: boolean } = {}) {
  return discoverPass({
    platforms: registry(adapter),
    store: async (items) => items.length,
    plan: { terms: opts.terms ?? [], cadenceMs: CADENCE_MS },
    policy: DEFAULT_POLICY,
    meter: meterWith(opts.mayspend ?? true),
    mode: opts.mode ?? 'live',
    log: quiet,
    now: () => at as Millis,
    signal: new AbortController().signal,
    floors: { floors: async () => ({}), set: async () => undefined },
    dailyCapUsd: 21,
    watch,
  });
}

/* ── the spacing ──────────────────────────────────────────────────────────── */

/* The spacing derived from the line, as it is with no spacing set. */
const DERIVED = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, watchAskEveryMs: null } };

test('★ a paid ask is spaced so a day of them costs the discovery share of the line', () => {
  const every = watchEveryMs(USD_PER_RUN, LINE_USD, CADENCE_MS, DERIVED);
  const asksPerDay = MS_PER_DAY / every;
  assert.ok(Math.abs(asksPerDay * USD_PER_RUN - LINE_USD * DEFAULT_POLICY.feed.budgetShare) < 1e-6);
});

test('★ a spacing the owner set wins over the derived one, never faster than the pass, and a free ask is not spaced', () => {
  const set = DEFAULT_POLICY.feed.watchAskEveryMs;
  assert.ok(set !== null);
  assert.equal(watchEveryMs(USD_PER_RUN, LINE_USD, CADENCE_MS, DEFAULT_POLICY), Math.max(CADENCE_MS, set));
  assert.equal(watchEveryMs(USD_PER_RUN, LINE_USD, set * 2, DEFAULT_POLICY), set * 2);
  assert.equal(watchEveryMs(0, LINE_USD, CADENCE_MS, DEFAULT_POLICY), CADENCE_MS);
});

test('a free ask, or a line with no money on it, is not spaced: the pass cadence and the meter decide', () => {
  assert.equal(watchEveryMs(0, LINE_USD, CADENCE_MS, DEFAULT_POLICY), CADENCE_MS);
  assert.equal(watchEveryMs(USD_PER_RUN, 0, CADENCE_MS, DEFAULT_POLICY), CADENCE_MS);
  // Never more often than the pass itself runs, however rich the line.
  assert.equal(watchEveryMs(0.000001, 1_000_000, CADENCE_MS, DERIVED), CADENCE_MS);
});

test('the watch word rotates through the list as the clock steps, and skips blanks', () => {
  const every = 3_600_000;
  const words = [0, 1, 2, 3].map((k) => watchTermFor(['a', ' ', 'b', 'c'], every, (k * every) as Millis));
  assert.deepEqual(words, ['a', 'b', 'c', 'a']);
  assert.equal(watchTermFor([], every, NOW), null);
});

test('★ several watch words an ask: each ask takes the next ones, the list comes round, never a word twice', () => {
  const every = 3_600_000;
  const list = ['a', 'b', ' ', 'c', 'd', 'e', 'b'];
  const asks = [0, 1, 2].map((k) => watchTermsFor(list, 2, every, (k * every) as Millis));
  assert.deepEqual(asks, [['a', 'b'], ['c', 'd'], ['e', 'a']]);
  assert.deepEqual(watchTermsFor(['a', 'b'], 6, every, NOW), ['a', 'b'], 'never more words than the list holds');
  assert.deepEqual(watchTermsFor([], 4, every, NOW), []);
});

/* ── the pass ─────────────────────────────────────────────────────────────── */

test('★ with no term configured, a source with no catch-all is asked a word from the watch list, by keyword', async () => {
  const seen: DiscoveryQuery[] = [];
  const result = await pass(watchedSource(seen), NOW, memoryWatchClock());
  assert.equal(seen.length, 1);
  const q = seen[0]!;
  assert.equal(q.mode, 'keyword');
  assert.ok(DEFAULT_POLICY.feed.hashtags.includes(q.term), `asked "${q.term}", which is not on the watch list`);
  assert.equal(q.limit, DEFAULT_POLICY.feed.hashtagResults, 'the policy\'s posts per hashtag ask');
  // The adapter refuses a cutoff on this source; the live watch never sends one.
  assert.equal(q.untilMs, null);
  assert.equal(q.filter, undefined, 'no filter of any kind, by account or otherwise');
  assert.equal(result.answered, 1);
  assert.equal(result.unasked, 0);
});

test('★ between asks the source is resting — said, with when it will be asked — and nothing is spent', async () => {
  const seen: DiscoveryQuery[] = [];
  const watch = memoryWatchClock();
  const source = watchedSource(seen);
  const every = watchEveryMs(USD_PER_RUN, LINE_USD, CADENCE_MS, DEFAULT_POLICY);

  await pass(source, NOW, watch);
  const between = await pass(source, NOW + CADENCE_MS, watch);
  assert.equal(seen.length, 1, 'asked again before its spacing was up');
  assert.equal(between.resting, 1);
  assert.equal(between.asked, 0);
  assert.equal(between.estimatedUsd, 0);
  const resting = between.outcomes.find((o) => o.kind === 'resting');
  assert.ok(resting?.kind === 'resting' && resting.nextAtMs === NOW + every);

  await pass(source, NOW + every, watch);
  assert.equal(seen.length, 2, 'not asked again once the spacing was up');
});

test('★ a day of passes every two minutes, 45 seconds after the minute, asks exactly once in every slot, and every pair of words in turn', async () => {
  const seen: DiscoveryQuery[] = [];
  const watch = memoryWatchClock();
  const source = watchedSource(seen);
  const every = watchEveryMs(USD_PER_RUN, LINE_USD, CADENCE_MS, DEFAULT_POLICY);
  /* A pass takes a little time and the loop waits its cadence after it: 2 minutes and 13 seconds apart. */
  for (let at = NOW + 45_000; at < NOW + MS_PER_DAY; at += CADENCE_MS + 13_000) await pass(source, at, watch);
  assert.equal(seen.length, MS_PER_DAY / every, 'one ask a slot, so the day has all of them');
  const perAsk = DEFAULT_POLICY.feed.watchWordsPerAsk;
  const counts = new Map<string, number>();
  for (const q of seen) for (const w of q.terms ?? [q.term]) counts.set(w, (counts.get(w) ?? 0) + 1);
  const each = (seen.length * perAsk) / DEFAULT_POLICY.feed.hashtags.length;
  for (const w of DEFAULT_POLICY.feed.hashtags) assert.equal(counts.get(w), each, `${w} asked as often as every other word`);
});

test('the slots: asked once inside one, again at the first pass of the next; a spacing at the cadence counts elapsed time', () => {
  const every = 900_000;
  assert.equal(watchAskDue(null, NOW, every, CADENCE_MS), null);
  assert.equal(watchAskDue(NOW, (NOW + every - 1) as Millis, every, CADENCE_MS), NOW + every);
  assert.equal(watchAskDue((NOW + every - 60_000) as Millis, (NOW + every) as Millis, every, CADENCE_MS), null, 'a new slot asks at once');
  assert.equal(watchAskDue(NOW, (NOW + 60_000) as Millis, CADENCE_MS, CADENCE_MS), NOW + CADENCE_MS);
  assert.equal(watchAskDue(NOW, (NOW + CADENCE_MS) as Millis, CADENCE_MS, CADENCE_MS), null);
});

test('a dry pass and a paused pass do not start the clock: nothing was asked', async () => {
  const seen: DiscoveryQuery[] = [];
  const watch = memoryWatchClock();
  const source = watchedSource(seen);

  const dry = await pass(source, NOW, watch, { mode: 'dry' });
  assert.equal(dry.planned, 1);
  const paused = await pass(source, NOW + 1, watch, { mayspend: false });
  assert.equal(paused.paused, 1);
  assert.equal(watch.lastAskedAt('tiktok'), null);

  await pass(source, NOW + 2, watch);
  assert.equal(seen.length, 1, 'the first real ask waited on a clock that dry and paused passes had started');
});

test('a configured term takes the place of the watch list, and is spaced the same way', async () => {
  const seen: DiscoveryQuery[] = [];
  const watch = memoryWatchClock();
  const source = watchedSource(seen);
  await pass(source, NOW, watch, { terms: ['chillguy'] });
  await pass(source, NOW + CADENCE_MS, watch, { terms: ['chillguy'] });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.term, 'chillguy');
});

test('a free source with no catch-all is asked every pass', async () => {
  const seen: DiscoveryQuery[] = [];
  const watch = memoryWatchClock();
  const source = watchedSource(seen, 0);
  await pass(source, NOW, watch);
  await pass(source, NOW + CADENCE_MS, watch);
  assert.equal(seen.length, 2);
});
