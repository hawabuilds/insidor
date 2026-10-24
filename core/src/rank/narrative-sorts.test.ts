/**
 * The Narratives tab's Trending: a narrative's speeds are its measured posts' For You speeds added
 * up, and the list is For You's riser rule over them, filled when there are few.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { narrativeSpeeds, narrativeTrending, narrativeTrendingIds, type NarrativeSpeeds } from './narrative-sorts.ts';

const MIN = 60_000;
const NOW = 1_000 * 60 * MIN;

/** A post read every 10 minutes for 100 minutes, gaining `before` a minute until 30 minutes ago and `now` a minute since. */
function post(before: number, now: number, source = 'text') {
  const readings = [];
  let v = 0;
  for (let t = NOW - 100 * MIN; t <= NOW; t += 10 * MIN) {
    readings.push({ atMs: t, value: v });
    v += 10 * (t < NOW - 30 * MIN ? before : now);
  }
  return { readings, source };
}

test('speeds add up over the measured posts only', () => {
  const unread = { readings: [{ atMs: NOW - 5 * MIN, value: 100 }], source: 'text' };
  const s = narrativeSpeeds([post(100, 200), post(50, 50, 'video'), unread], NOW, DEFAULT_POLICY);
  assert.ok(s !== null);
  assert.equal(s.posts, 2);
  assert.equal(Math.round(s.now), 250);
  assert.equal(Math.round(s.before), 150);
  assert.equal(Math.round(s.nowBySource['video'] ?? 0), 50);
});

test('no measured post, no speeds', () => {
  assert.equal(narrativeSpeeds([{ readings: [{ atMs: NOW, value: 5 }], source: 'text' }], NOW, DEFAULT_POLICY), null);
});

const row = (id: string, now: number, before: number, fresh = true, source = 'text') => ({ id, fresh, speeds: { now, before, posts: 1, nowBySource: { [source]: now } } satisfies NarrativeSpeeds });
const one = (): number => 1;

test('risers by ratio; under the floor, slower than 1.15x or stale are not risers', () => {
  const rows = [row('a', 1000, 500), row('b', 900, 300), row('c', 100, 10), row('d', 1000, 950), row('e', 2000, 100, false), row('f', 600, 300), row('g', 800, 400), row('h', 700, 350)];
  const list = narrativeTrending(rows, one, DEFAULT_POLICY).map((x) => x.id);
  assert.deepEqual(list, ['b', 'a', 'g', 'h', 'f']);
});

test('fewer than 5 risers: filled with the others over the floor, by ratio', () => {
  const rows = [row('a', 1000, 500), row('d', 1000, 950), row('s', 400, 800), row('c', 100, 10)];
  assert.deepEqual(narrativeTrending(rows, one, DEFAULT_POLICY).map((x) => x.id), ['a', 'd', 's']);
});

test('a short video meets the floor in scaled views', () => {
  const rows = [row('t', 2000, 100, true, 'video')];
  assert.deepEqual(narrativeTrending(rows, (s) => (s === 'video' ? 12.5 : 1), DEFAULT_POLICY), []);
  assert.equal(narrativeTrending(rows, one, DEFAULT_POLICY).length, 1);
});

test('★ still short after the floor fill: the fresh narratives with a measured last-hour gain, the most first (2026-10-21: 2 of 638 had speeds, the list was empty)', () => {
  const rows = [row('a', 1000, 500), row('c', 100, 10)];
  const gains = [
    { id: 'g1', gained: 586_867, fresh: true },
    { id: 'g2', gained: 210_220, fresh: true },
    { id: 'a', gained: 9_999_999, fresh: true },
    { id: 'stale', gained: 900_000, fresh: false },
    { id: 'unread', gained: null, fresh: true },
    { id: 'zero', gained: 0, fresh: true },
  ];
  assert.deepEqual(narrativeTrendingIds(rows, one, DEFAULT_POLICY, gains), ['a', 'g1', 'g2'], 'a riser keeps its place, once; stale, unmeasured and zero gains stay off');
  assert.deepEqual(narrativeTrendingIds([], one, DEFAULT_POLICY, gains), ['a', 'g1', 'g2'], 'no speeds at all: the gains alone');
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, gained: 1_000 + i, fresh: true }));
  assert.equal(narrativeTrendingIds([], one, DEFAULT_POLICY, many).length, DEFAULT_POLICY.rising.forYouSorts.risers.fillTo, 'filled to 10, no further');
});

test('★ after the risers, the narratives that keep having viral posts, most accounts first; one viral account, a stale page or an unknown count does not', () => {
  const rows = [row('a', 1000, 500)];
  const gains = [{ id: 'g1', gained: 9_000, fresh: true }, { id: 'war', gained: 71_282, fresh: true }];
  const steady = [
    { id: 'war', viralAccounts: 9, fresh: true },
    { id: 'baby', viralAccounts: 5, fresh: true },
    { id: 'one', viralAccounts: 1, fresh: true },
    { id: 'old', viralAccounts: 7, fresh: false },
    { id: 'unknown', viralAccounts: null, fresh: true },
  ];
  assert.deepEqual(narrativeTrendingIds(rows, one, DEFAULT_POLICY, gains, steady), ['a', 'war', 'baby', 'g1']);
  const five = [row('a', 1000, 500), row('b', 900, 300), row('f', 600, 300), row('g', 800, 400), row('h', 700, 350)];
  assert.deepEqual(narrativeTrendingIds(five, one, DEFAULT_POLICY, gains, steady), ['b', 'a', 'g', 'h', 'f', 'war', 'baby'], 'with five risers too');
});

test('five risers or more: the list is the risers alone, no gain fill', () => {
  const rows = [row('a', 1000, 500), row('b', 900, 300), row('f', 600, 300), row('g', 800, 400), row('h', 700, 350)];
  assert.deepEqual(narrativeTrendingIds(rows, one, DEFAULT_POLICY, [{ id: 'x', gained: 5_000_000, fresh: true }]), ['b', 'a', 'g', 'h', 'f']);
});
