import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeRisingSorted } from '../../shared/api/decode.ts';
import { fixtureRising } from '../../test-fixtures/fixtures.ts';
import { DEFAULT_CHOICE, parseChoice, speedLine, windowOf } from './feed-sort.ts';
import { joinPages } from './useSortedPages.ts';

test('New is the default; Trending is right now; Most viewed starts on Today', () => {
  assert.equal(DEFAULT_CHOICE.sort, 'new');
  assert.equal(windowOf(DEFAULT_CHOICE), null);
  assert.equal(windowOf({ ...DEFAULT_CHOICE, sort: 'trending' }), 'now');
  assert.equal(windowOf({ ...DEFAULT_CHOICE, sort: 'trending', span: 'week' }), 'now', 'Trending has no window of its own');
  assert.equal(windowOf({ ...DEFAULT_CHOICE, sort: 'most_viewed' }), 'today');
  assert.equal(windowOf({ sort: 'most_viewed', span: 'week' }), 'week');
});

test('a remembered choice reads back', () => {
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'most_viewed', span: 'week' })), { sort: 'most_viewed', span: 'week' });
});

test('★ a choice stored before the redesign keeps its sort and falls back to Today, cleanly', () => {
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'most_viewed', windows: { trending: '6h', most_viewed: '1h' } })), { sort: 'most_viewed', span: 'today' });
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'trending', windows: { trending: '6h', most_viewed: '24h' } })), { sort: 'trending', span: 'today' });
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'most_viewed', span: '6h' })), { sort: 'most_viewed', span: 'today' });
});

test('anything stored that is not ours falls back, part by part', () => {
  assert.deepEqual(parseChoice(null), DEFAULT_CHOICE);
  assert.deepEqual(parseChoice('{not json'), DEFAULT_CHOICE);
  assert.deepEqual(parseChoice('null'), DEFAULT_CHOICE);
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'score', span: '2d' })), DEFAULT_CHOICE);
});

test("★ Trending's line is the post's views a minute now and before, as read, and says so when it cannot tell", () => {
  assert.deepEqual(speedLine({ now: 480, before: 290 }), { text: '480 views a minute, up from 290', up: true });
  assert.deepEqual(speedLine({ now: 12_400, before: 15_000 }), { text: '12K views a minute, down from 15K', up: false });
  assert.deepEqual(speedLine({ now: 4.5, before: 0 }), { text: '4.5 views a minute, up from 0', up: true });
  assert.deepEqual(speedLine({ now: 1, before: 1 }), { text: '1 view a minute, the same as the half hour before', up: false });
  assert.equal(speedLine(null).up, false);
  assert.doesNotMatch(speedLine(null).text, /\d/, 'no speed is never a zero');
  for (const s of [{ now: 480, before: 290 }, null]) assert.doesNotMatch(speedLine(s).text, /·/);
});

test("★ a Trending page keeps the server's order and drops a post with no speeds entry; null is kept as 'cannot tell'", () => {
  const feed = fixtureRising('fyp') as { posts: { id: string }[] };
  const [a, b, c] = feed.posts;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const list = decodeRisingSorted({ tick: 1, by: 'trending', window: 'now', posts: [b, a, c], speeds: { [b.id]: { now: 480, before: 290 }, [c.id]: null }, next: null });
  assert.deepEqual(list.posts.map((p) => p.id), [b.id, c.id]);
  assert.deepEqual(list.speeds.get(b.id), { now: 480, before: 290 });
  assert.equal(list.speeds.get(c.id), null);
  assert.equal(list.next, null);
});

test('★ the sorted decoder is strict', () => {
  const ok = { tick: 1, by: 'trending', window: 'now', posts: [], speeds: {}, next: null };
  decodeRisingSorted(ok);
  assert.throws(() => decodeRisingSorted({ ...ok, score: 3 }), 'internal words');
  assert.throws(() => decodeRisingSorted({ ...ok, window: '1h' }), 'an old window');
  assert.throws(() => decodeRisingSorted({ ...ok, window: 'week' }), 'a span is Most viewed only');
  assert.throws(() => decodeRisingSorted({ ...ok, speeds: undefined }), 'Trending without speeds');
  assert.throws(() => decodeRisingSorted({ ...ok, speeds: { x: { now: -1, before: 2 } } }), 'a negative speed');
  assert.throws(() => decodeRisingSorted({ ...ok, speeds: { x: { now: 1 } } }), 'a speed missing its before');
  assert.throws(() => decodeRisingSorted({ ...ok, next: undefined }), 'no next');
  const mv = { tick: 1, by: 'most_viewed', window: 'today', posts: [], views: {}, undated: 0, next: '20' };
  assert.equal(decodeRisingSorted(mv).next, '20');
  assert.throws(() => decodeRisingSorted({ ...mv, window: 'now' }));
  assert.throws(() => decodeRisingSorted({ ...mv, views: { x: 'lots' } }));
  assert.throws(() => decodeRisingSorted({ ...mv, undated: undefined }));
});

test("★ Most viewed: each post its total, the card's own number; pages join with each post once, at its first place", () => {
  const feed = fixtureRising('fyp') as { posts: { id: string }[] };
  const [a, b, c] = feed.posts;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const one = decodeRisingSorted({ tick: 1, by: 'most_viewed', window: 'week', posts: [a, b], views: { [a.id]: 9_000_000, [b.id]: 800_000 }, undated: 1, next: '2' });
  const two = decodeRisingSorted({ tick: 2, by: 'most_viewed', window: 'week', posts: [b, c], views: { [b.id]: 810_000, [c.id]: 500_000 }, undated: 1, next: null });
  const all = joinPages(one, [two]);
  assert.deepEqual(all.posts.map((p) => p.id), [a.id, b.id, c.id]);
  assert.equal(all.views.get(b.id), 800_000, 'the first page, where it is shown, says its number');
  assert.equal(all.views.get(c.id), 500_000);
  assert.equal(all.next, null);
  assert.equal(all.undated, 1);
});
