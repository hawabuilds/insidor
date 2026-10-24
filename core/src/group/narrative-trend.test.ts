/**
 * Trending narratives (narrative-trend.ts): a story taking off beats a bigger one slowing down, one
 * account posting ten times is one new post, an unchecked coin never moves the order, and a story
 * with no reading in the window goes after every story that has one.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { gainedSeries, reachGained, type MemberReach } from './narrative.ts';
import { trendFacts, trendOrder, trendStanding, type TrendInput, type TrendPost } from './narrative-trend.ts';

const P = DEFAULT_POLICY;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = 100 * HOUR;

/** Readings every 5 minutes from `from` to now, gaining `perMin` a minute up to `turn`, then `after`. */
const reach = (from: number, perMin: number, after = perMin, turn = NOW): MemberReach => {
  const points = [];
  let v = 0;
  for (let t = from; t <= NOW; t += 5 * MIN) {
    points.push({ atMs: t, reach: Math.round(v) });
    v += (t < turn ? perMin : after) * 5;
  }
  return { postedAtMs: from, points };
};
const post = (author: string, foundAtMs: number, r: MemberReach, source = 'x'): TrendPost => ({ authorKey: author, sourceKey: source, foundAtMs, reach: r });
const story = (posts: readonly TrendPost[], coin: TrendInput['coin'] = null): TrendInput => ({ posts, foundAtMs: Math.min(...posts.map((p) => p.foundAtMs ?? Infinity)), coin });
const rank = (stories: Record<string, TrendInput>, windowMs = HOUR) =>
  trendOrder(Object.entries(stories).map(([id, s]) => ({ id, facts: trendFacts(s, NOW, windowMs), foundAtMs: s.foundAtMs })), P);

test('★ the window gain is the chart\'s: each post spread between its own readings, then added up', () => {
  const a = reach(NOW - 3 * HOUR, 100);
  const b = reach(NOW - 30 * MIN, 10);
  assert.equal(reachGained([a, b], NOW - HOUR, NOW).value, 60 * 100 + 30 * 10);
  assert.equal(reachGained([b], NOW - 3 * HOUR, NOW - 2 * HOUR).value, null, 'no post being read then: not a zero');
});

test('★ a huge story slowing down falls below a smaller one taking off', () => {
  const big = story([post('a', NOW - 30 * HOUR, reach(NOW - 30 * HOUR, 20_000, 1_500, NOW - 2 * HOUR)), post('b', NOW - 29 * HOUR, reach(NOW - 29 * HOUR, 5_000, 200, NOW - 2 * HOUR))]);
  const rising = story([post('c', NOW - 50 * MIN, reach(NOW - 50 * MIN, 1_500)), post('d', NOW - 40 * MIN, reach(NOW - 40 * MIN, 800)), post('e', NOW - 20 * MIN, reach(NOW - 20 * MIN, 600))]);
  assert.deepEqual(rank({ big, rising }), ['rising', 'big']);
});

test('★ a big old story that keeps picking up stays above a small new one', () => {
  const steady = story([post('a', NOW - 20 * HOUR, reach(NOW - 20 * HOUR, 2_000, 30_000, NOW - HOUR)), post('b', NOW - 19 * HOUR, reach(NOW - 19 * HOUR, 1_000))]);
  const small = story([post('c', NOW - 30 * MIN, reach(NOW - 30 * MIN, 50)), post('d', NOW - 20 * MIN, reach(NOW - 20 * MIN, 30))]);
  assert.deepEqual(rank({ small, steady }), ['steady', 'small']);
});

test('★ one account posting ten times is one new post; ten accounts beat it', () => {
  const r = () => reach(NOW - 50 * MIN, 200);
  const spam = story(Array.from({ length: 10 }, () => post('same', NOW - 40 * MIN, r())));
  const many = story(Array.from({ length: 10 }, (_, i) => post(`acct${i}`, NOW - 40 * MIN, r())));
  const f = trendFacts(spam, NOW, HOUR);
  assert.equal(f.newPosts, 10);
  assert.equal(f.accounts, 1);
  assert.deepEqual(rank({ spam, many }), ['many', 'spam']);
});

test('both sources is a small boost; a checked coin\'s climb counts, no coin is not a penalty', () => {
  const posts = (src2: string) => [post('a', NOW - 50 * MIN, reach(NOW - 50 * MIN, 300)), post('b', NOW - 50 * MIN, reach(NOW - 50 * MIN, 300), src2)];
  assert.deepEqual(rank({ one: story(posts('x')), both: story(posts('short')) }), ['both', 'one']);
  const coined = story(posts('x'), { capAtStart: 100_000, capNow: 300_000, buys: 3 });
  const plain = story(posts('x'));
  assert.deepEqual(rank({ plain, coined }), ['coined', 'plain']);
  const flat = trendStanding(trendFacts(story(posts('x'), { capAtStart: null, capNow: null, buys: 0 }), NOW, HOUR), P);
  const none = trendStanding(trendFacts(plain, NOW, HOUR), P);
  assert.deepEqual(flat, none, 'a coin with no readings adds nothing and takes nothing');
});

test('★ an outage is not a slow story: no reading in the window orders after every ranked story', () => {
  const quiet = story([post('a', NOW - 50 * MIN, reach(NOW - 50 * MIN, 1))]);
  const dark: TrendInput = { posts: [post('b', NOW - 10 * HOUR, { postedAtMs: NOW - 10 * HOUR, points: [{ atMs: NOW - 10 * HOUR, reach: 5_000_000 }, { atMs: NOW - 9 * HOUR, reach: 9_000_000 }] })], foundAtMs: NOW - 10 * HOUR, coin: null };
  assert.equal(trendStanding(trendFacts(dark, NOW, HOUR), P).kind, 'unread');
  assert.deepEqual(rank({ dark, quiet }), ['quiet', 'dark']);
});

test('older stories fade: the same gain found a day ago is below one found now', () => {
  const fresh = story([post('a', NOW - 50 * MIN, reach(NOW - 2 * HOUR, 500))]);
  const old: TrendInput = { ...fresh, foundAtMs: NOW - 30 * HOUR };
  assert.deepEqual(rank({ old, fresh }), ['fresh', 'old']);
});

test('the "All" line: half-hour slots from the first reading to now, bounded', () => {
  const s = gainedSeries([reach(NOW - 30 * HOUR, 10)], NOW - 40 * HOUR, NOW, P.narrative.reach.allStepMs, 96);
  assert.equal(s.stepMs, 30 * MIN);
  assert.equal(s.fromMs, NOW - 30 * HOUR);
  assert.equal(s.values.length, 60);
  assert.equal(s.values.at(-1), 300);
  assert.equal(gainedSeries([reach(NOW - 99 * HOUR, 10)], NOW - 99 * HOUR, NOW, 30 * MIN, 96).values.length, 96);
});

test('★ steady viral posts (policy.v157): each account once, every slot it fills; an unread or small post is not viral', () => {
  const W = 6 * HOUR;
  const steady = [0, 1, 2, 3, 4, 5].map((k) => post(`a${k}`, NOW - k * HOUR - 50 * MIN, reach(NOW - k * HOUR - 50 * MIN, 2_000)));
  const small = post('small', NOW - 2 * HOUR, reach(NOW - 2 * HOUR, 10));
  const unread = post('unread', NOW - HOUR, { postedAtMs: NOW - HOUR, points: [] });
  const twice = post('a0', NOW - 40 * MIN, reach(NOW - 40 * MIN, 2_500));
  const all = story([...steady, small, unread, twice]);
  const f = trendFacts(all, NOW, W, P);
  assert.equal(f.viralPosts, 7);
  assert.equal(f.viralAccounts, 6, 'one account twice is once');
  assert.equal(f.viralSlots, 6);
  const without = trendStanding(trendFacts(all, NOW, W), P);
  const withIt = trendStanding(f, P);
  assert.ok(without.kind === 'ranked' && withIt.kind === 'ranked');
  const t = P.narrative.trend;
  assert.ok(Math.abs(withIt.value - without.value - (t.viralWeight * Math.log2(7) + t.steadyWeight)) < 1e-9);
  const oneHit = trendFacts(story([post('big', NOW - 50 * MIN, reach(NOW - 50 * MIN, 20_000))]), NOW, W, P);
  assert.equal(oneHit.viralSlots, 1);
});
