/**
 * The quote search on big accounts (work/quote-search.ts): a held big post is asked at each age in
 * `askAtMin` once, inside its grace, as a search of its quotes at the quote floor, credited to
 * 'quote'; a failed ask is asked again; the lane's cap stops the pass.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis, Policy } from '@insidor/contracts';
import type { DiscoveryQuery } from '@insidor/contracts/ports/platform.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { QuoteTarget } from '@insidor/store';

import type { Logger } from '../log.ts';
import { memoryLaneLedger } from './lane-ledger.ts';
import { NOW, openMeter, pagingSource } from './lane-search-fakes.ts';
import { dueAge, quoteClock, quoteSearchPass, type QuoteSearchDeps } from './quote-search.ts';

const P = DEFAULT_POLICY.feed.reproductions;
const MIN = 60_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

test('a post is due at each asking age within its grace, once, and never before the first', () => {
  const [first, second] = [...P.askAtMin].sort((a, b) => a - b) as [number, number];
  assert.equal(dueAge(NOW - (first - 1) * MIN, NOW, undefined, P), null);
  assert.equal(dueAge(NOW - (first + 1) * MIN, NOW, undefined, P), first);
  assert.equal(dueAge(NOW - (first + 1) * MIN, NOW, new Set([first]), P), null);
  assert.equal(dueAge(NOW - (first + P.askGraceMin + 1) * MIN, NOW, undefined, P), null);
  assert.equal(dueAge(NOW - (second + 1) * MIN, NOW, new Set([first]), P), second);
  assert.equal(dueAge(NOW - (second + P.askGraceMin) * MIN, NOW, undefined, P), null);
});

function target(id: string, ageMin: number, approvals = 9_000, readAgoMin = 1): QuoteTarget {
  return { itemId: `x:${id}`, sourceItemId: id, postedAtMs: NOW - ageMin * MIN, approvals, readAtMs: NOW - readAgoMin * MIN, followers: 20_000_000 };
}

function deps(seen: DiscoveryQuery[], stored: unknown[], targets: readonly QuoteTarget[], over: Partial<QuoteSearchDeps> = {}): QuoteSearchDeps & { asks: unknown[] } {
  const asks: unknown[] = [];
  return {
    asks,
    sources: () => [pagingSource(seen, () => 2)],
    targets: {
      due: async (args) => {
        asks.push(args);
        return targets;
      },
    },
    store: async (items, _a, lane) => {
      stored.push(lane);
      return items.length;
    },
    uncredited: async (ids) => ids.length,
    ledger: memoryLaneLedger(),
    meter: openMeter,
    mode: 'live',
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => NOW,
    ...over,
  };
}

test("a pass asks a due post's quotes at the quote floor, credits the lane, and does not ask it again at that age", async () => {
  const seen: DiscoveryQuery[] = [];
  const stored: unknown[] = [];
  const clock = quoteClock();
  const d = deps(seen, stored, [target('2110222071229989249', 65), target('2110222071229989250', 30)]);
  const r = await quoteSearchPass(d, clock);
  assert.equal(r.asked, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.reproductionsOf, '2110222071229989249');
  assert.equal(seen[0]?.term, '');
  assert.equal(seen[0]?.filter?.minApproval, P.reproductionMinApproval);
  assert.deepEqual(stored, ['quote']);
  assert.deepEqual(d.asks[0], {
    source: 'x', minFollowers: P.minFollowers,
    postedAfterMs: NOW - (Math.max(...P.askAtMin) + P.askGraceMin) * MIN, postedBeforeMs: NOW - Math.min(...P.askAtMin) * MIN,
    limit: P.maxCandidates,
  });
  await quoteSearchPass({ ...d, now: () => (NOW + 5 * MIN) as Millis }, clock);
  assert.equal(seen.length, 1);
});

test('a failed ask is asked again next pass, and a spent lane asks nothing', async () => {
  const seen: DiscoveryQuery[] = [];
  const clock = quoteClock();
  const broken = { ...pagingSource(seen, () => 2), discover: async () => { throw new Error('503'); } };
  await quoteSearchPass(deps(seen, [], [target('2110222071229989249', 65)], { sources: () => [broken] }), clock);
  await quoteSearchPass(deps(seen, [], [target('2110222071229989249', 66)]), clock);
  assert.equal(seen.length, 1);

  const none: DiscoveryQuery[] = [];
  const capped = await quoteSearchPass(deps(none, [], [target('2110222071229989249', 65)], { ledger: memoryLaneLedger({ quote: P.cap.dailyUsd }) }), quoteClock());
  assert.equal(capped.stopped, 'capped');
  assert.equal(none.length, 0);
  const off: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, reproductions: { ...P, on: false } } };
  await quoteSearchPass(deps(none, [], [target('2110222071229989249', 65)], { policy: off }), quoteClock());
  assert.equal(none.length, 0);
});

test('a stale reading under the floor is read again first: past the floor it is asked, under it it is settled for that age', async () => {
  const seen: DiscoveryQuery[] = [];
  const reads: (readonly string[])[] = [];
  const likes: Record<string, number> = { '2110222071229989249': 9_100, '2110222071229989250': 1_200 };
  const src = {
    ...pagingSource(seen, () => 2),
    observe: async (ids: readonly string[]) => {
      reads.push(ids);
      const value = new Map(ids.map((id) => [id, { approval: { value: likes[id] ?? null, fidelity: { kind: 'exact' as const }, observedAt: NOW } }]));
      return { value, spend: { vendor: 'x', endpoint: 'lookup', unit: 'per-item-returned', units: ids.length, usd: ids.length * 0.00015, at: NOW } } as never;
    },
  };
  const targets = [
    target('2110222071229989249', 65, 703, 60), // read once, four minutes in: 703 likes
    target('2110222071229989250', 65, 900, 60),
    target('2110222071229989251', 65, 900, 2), // a fresh reading under the floor waits
  ];
  const clock = quoteClock();
  const ledger = memoryLaneLedger();
  const r = await quoteSearchPass(deps(seen, [], targets, { sources: () => [src], ledger }), clock);
  assert.deepEqual(reads, [['2110222071229989249', '2110222071229989250']]);
  assert.equal(r.reread, 2);
  assert.deepEqual(seen.map((q) => q.reproductionsOf), ['2110222071229989249']);
  assert.ok(((await ledger.spent('quote', NOW)) ?? 0) >= 2 * 0.00015);
  /* The one still under the floor is not read again at this age. */
  await quoteSearchPass(deps(seen, [], targets, { sources: () => [src], ledger, now: () => (NOW + 5 * MIN) as Millis }), clock);
  assert.equal(reads.length, 1);
});
