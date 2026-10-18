import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeRisingSorted } from '../../shared/api/decode.ts';
import { fixtureRising } from '../../test-fixtures/fixtures.ts';
import { DEFAULT_CHOICE, NO_RISERS, gainedLine, parseChoice, speedLine, windowOf } from './feed-sort.ts';
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

test("★ Trending's line: views a minute over the last 15 minutes, and how many times the hour before's, to one decimal", () => {
  assert.deepEqual(speedLine({ now: 394, before: 188 }), { text: '394 views a minute, up 2.1x in the last hour', up: true });
  assert.deepEqual(speedLine({ now: 46_900, before: 30_000 }), { text: '47K views a minute, up 1.6x in the last hour', up: true }, 'a short video in its real views');
  assert.deepEqual(speedLine({ now: 450, before: 0 }), { text: '450 views a minute, up from none in the hour before', up: true });
  /* A post filled in from the 1h rule says its own flat or slowing speed. */
  assert.deepEqual(speedLine({ now: 394, before: 380 }), { text: '394 views a minute, steady over the last hour', up: false });
  assert.deepEqual(speedLine({ now: 394, before: 440 }), { text: '394 views a minute, down to 0.9x in the last hour', up: false });
  for (const s of [{ now: 394, before: 188 }, { now: 450, before: 0 }, { now: 394, before: 440 }]) assert.doesNotMatch(speedLine(s).text, /·|Infinity|NaN/);
  assert.equal(NO_RISERS, 'Nothing is speeding up right now.');
});

test("★ a Trending page keeps the server's order and drops a post with no speeds entry; an empty list decodes empty", () => {
  const feed = fixtureRising('fyp') as { posts: { id: string }[] };
  const [a, b, c] = feed.posts;
  assert.ok(a !== undefined && b !== undefined && c !== undefined);
  const list = decodeRisingSorted({ tick: 1, by: 'trending', window: 'now', posts: [b, a, c], speeds: { [b.id]: { now: 480, before: 290 }, [c.id]: { now: 900, before: 100 } }, next: null });
  assert.deepEqual(list.posts.map((p) => p.id), [b.id, c.id]);
  assert.deepEqual(list.speeds.get(b.id), { now: 480, before: 290 });
  assert.equal(list.next, null);
  assert.deepEqual(decodeRisingSorted({ tick: 1, by: 'trending', window: 'now', posts: [], speeds: {}, next: null }).posts, []);
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
  assert.throws(() => decodeRisingSorted({ ...ok, speeds: { x: null } }), 'every listed riser has its speeds');
  assert.throws(() => decodeRisingSorted({ ...ok, next: undefined }), 'no next');
  const mv = { tick: 1, by: 'most_viewed', window: 'today', posts: [], views: {}, gained: {}, undated: 0, next: '20' };
  assert.equal(decodeRisingSorted(mv).next, '20');
  assert.throws(() => decodeRisingSorted({ ...mv, window: 'now' }));
  assert.throws(() => decodeRisingSorted({ ...mv, views: { x: 'lots' } }));
  assert.throws(() => decodeRisingSorted({ ...mv, gained: undefined }), 'Today without its gains');
  assert.throws(() => decodeRisingSorted({ ...mv, gained: { x: -5 } }), 'a negative gain');
  assert.equal(decodeRisingSorted({ ...mv, window: 'all', gained: undefined }).window, 'all', 'All time has no gains');
});

test("★ Most viewed: each post its total and what it gained; a post without its gain is dropped; pages join with each post once, at its first place", () => {
  const feed = fixtureRising('fyp') as { posts: { id: string }[] };
  const [a, b, c, d] = feed.posts;
  assert.ok(a !== undefined && b !== undefined && c !== undefined && d !== undefined);
  const one = decodeRisingSorted({ tick: 1, by: 'most_viewed', window: 'week', posts: [a, b, d], views: { [a.id]: 94_900_000, [b.id]: 800_000, [d.id]: 5 }, gained: { [a.id]: 3_200_000, [b.id]: 90_000 }, undated: 0, next: '2' });
  assert.deepEqual(one.posts.map((p) => p.id), [a.id, b.id], 'no gain, not shown at zero');
  const two = decodeRisingSorted({ tick: 2, by: 'most_viewed', window: 'week', posts: [b, c], views: { [b.id]: 810_000, [c.id]: 500_000 }, gained: { [b.id]: 91_000, [c.id]: 70_000 }, undated: 0, next: null });
  const all = joinPages(one, [two]);
  assert.deepEqual(all.posts.map((p) => p.id), [a.id, b.id, c.id]);
  assert.equal(all.gained.get(b.id), 90_000, 'the first page, where it is shown, says its number');
  assert.equal(all.gained.get(c.id), 70_000);
  assert.equal(all.next, null);
});

test("★ Most viewed's line: +3.2M this week, +48K today, and nothing on All time", () => {
  assert.deepEqual(gainedLine(3_200_000, 'week'), { text: '+3.2M this week', up: true });
  assert.deepEqual(gainedLine(48_000, 'today'), { text: '+48K today', up: true });
  assert.equal(gainedLine(48_000, 'all'), null);
  assert.deepEqual(parseChoice(JSON.stringify({ sort: 'most_viewed', span: 'all' })), { sort: 'most_viewed', span: 'all' });
  assert.equal(windowOf({ sort: 'most_viewed', span: 'all' }), 'all');
});
