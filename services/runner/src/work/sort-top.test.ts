/**
 * The sorts' top posts the readings loop keeps fresh (sort-top.ts): ranked as if all were read now,
 * the top of every list together, text source only, a reading taken as the card holds it, and the
 * set kept between recomputes and through a failed one.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { ItemId, Millis, Observation } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { sortReadingOf, sortTop, sortTopIds, type SortMember } from './sort-top.ts';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const P: Policy = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, readings: { ...DEFAULT_POLICY.feed.readings, sortTop: { ...DEFAULT_POLICY.feed.readings.sortTop, topN: 2 } } } };

/** Readings every 10 minutes for `spanMin`, gaining `perMin` a minute, the last `lastAgoMin` ago. */
const series = (spanMin: number, perMin: number, lastAgoMin: number) =>
  Array.from({ length: spanMin / 10 + 1 }, (_, i) => ({ atMs: NOW - (lastAgoMin + spanMin - i * 10) * MIN, value: 1000 + i * 10 * perMin }));

test("★ the top of each list, ranked as if every post were read now; a short video never kept", () => {
  const members: SortMember[] = [
    { itemId: 'x:stale-big', source: 'x', postedAt: NOW - 30 * 60 * MIN },
    { itemId: 'x:fresh-small', source: 'x', postedAt: NOW - 30 * 60 * MIN },
    { itemId: 'tiktok:huge', source: 'tiktok', postedAt: NOW - 30 * 60 * MIN },
  ];
  const readings = new Map([
    /* Gains the most of the text posts but was last read 50 minutes ago: the read service lists it low, so it must be read. */
    ['x:stale-big', series(600, 5000, 50)],
    ['x:fresh-small', series(600, 100, 1)],
    ['tiktok:huge', series(600, 500_000, 1)],
  ]);
  const top = sortTopIds(members, readings, NOW, P);
  assert.ok(top.has('x:stale-big'));
  assert.ok(!top.has('tiktok:huge'), 'tops Most viewed, but its credits are not this lane\'s');
});

test('a reading as the card holds it: a measured level, a first count, nothing else', () => {
  const base = { itemId: 'x:1' as ItemId, capturedAt: NOW as Millis, kind: 'reach' as const, counter: { value: 500, fidelity: { kind: 'exact' as const }, observedAt: NOW as Millis } };
  assert.deepEqual(sortReadingOf({ ...base, rate: { kind: 'measured', perMin: 1, overMs: MIN, level: 510 } } as Observation), { atMs: NOW, value: 510 });
  assert.deepEqual(sortReadingOf({ ...base, rate: { kind: 'censored', reason: 'no_prior', lastLevel: 500 } } as Observation), { atMs: NOW, value: 500 });
  assert.deepEqual(sortReadingOf({ ...base, rate: { kind: 'censored', reason: 'below_step', lastLevel: 500 } } as Observation), { atMs: NOW, value: null });
});

test('ranked once a recompute and kept through a failed one', async () => {
  let clock = NOW;
  let asks = 0;
  let fail = false;
  const get = sortTop({
    members: async () => {
      asks += 1;
      if (fail) throw new Error('down');
      return [{ itemId: 'x:a', source: 'x', postedAt: NOW - 60 * MIN }];
    },
    series: async () => new Map([['x:a' as ItemId, series(60, 100, 1).map((r) => ({ itemId: 'x:a' as ItemId, capturedAt: r.atMs as Millis, kind: 'reach' as const, counter: { value: r.value, fidelity: { kind: 'exact' as const }, observedAt: r.atMs as Millis }, rate: { kind: 'measured' as const, perMin: 100, overMs: 10 * MIN, level: r.value } }))]]),
    policy: P,
    log: quiet,
    now: () => clock as Millis,
  });
  assert.deepEqual([...(await get())], ['x:a']);
  await get();
  assert.equal(asks, 1, 'inside recomputeMs: kept');
  clock += P.feed.readings.sortTop.recomputeMs;
  fail = true;
  assert.deepEqual([...(await get())], ['x:a'], 'a failed recompute keeps the last set');
  assert.equal(asks, 2);
});
