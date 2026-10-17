/**
 * For You, live: the merge rule (live-feed.ts). Each test is one promise the owner was made —
 * new posts go in at the top, nothing a person is looking at moves or disappears, and the switch
 * is off unless the build turns it on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RisingPost } from '../../shared/api/index.ts';
import { STAGGER_MAX, STAGGER_MS, liveFeedOn, merge, reconcile, staggerDelay } from './live-feed.ts';
import { newestPosted } from './feed-order.ts';

const post = (id: string, views = 1): RisingPost => ({ id, views }) as unknown as RisingPost;
const ids = (rows: readonly RisingPost[]) => rows.map((p) => p.id);

test('the switch is off unless the build says exactly on', () => {
  assert.equal(liveFeedOn({}), false);
  assert.equal(liveFeedOn({ VITE_LIVE_FEED: '' }), false);
  assert.equal(liveFeedOn({ VITE_LIVE_FEED: 'true' }), false);
  assert.equal(liveFeedOn({ VITE_LIVE_FEED: 'on' }), true);
});

test('★ new posts go in at the top, in the server order among themselves', () => {
  const m = merge([post('a'), post('b')], [post('n1'), post('n2'), post('a'), post('b')]);
  assert.deepEqual(ids(m.rows), ['n1', 'n2', 'a', 'b']);
  assert.deepEqual(m.arrived, ['n1', 'n2']);
});

test('★ a newer read never reorders or removes what is showing', () => {
  const m = merge([post('a'), post('b'), post('c')], [post('c'), post('a')]);
  assert.deepEqual(ids(m.rows), ['a', 'b', 'c'], 'c did not jump up and b did not vanish');
  assert.deepEqual(m.arrived, []);
});

test('a post that passed the bar late still goes in at the top, where it is seen', () => {
  const m = merge([post('a'), post('b')], [post('a'), post('late'), post('b')]);
  assert.deepEqual(ids(m.rows), ['late', 'a', 'b']);
});

test('a post already showing takes its newer facts in place', () => {
  const m = merge([post('a', 1)], [post('a', 900)]);
  assert.equal((m.rows[0] as unknown as { views: number }).views, 900);
  assert.deepEqual(m.arrived, []);
});

test('a rebuild takes the server list whole, with nothing sliding in', () => {
  const r = reconcile([post('c'), post('a')]);
  assert.deepEqual(ids(r.rows), ['c', 'a']);
  assert.deepEqual(r.arrived, []);
});

test('several arrivals slide in one after another, and a flood does not take forever', () => {
  assert.equal(staggerDelay(0), 0);
  assert.equal(staggerDelay(2), 2 * STAGGER_MS);
  assert.equal(staggerDelay(50), STAGGER_MAX * STAGGER_MS);
});

/* For You's order (feed-order.ts): newest posted first. */
const at = (id: string, ms: number | null, views = 1): RisingPost =>
  ({ id, views, postedAt: ms === null ? { known: false, pending: 'not_reported' } : { known: true, at: ms } }) as unknown as RisingPost;

test('★ For You: a new post goes in at its posted time — the top when newest, lower when it passed late', () => {
  const shown = [at('a', 900), at('b', 500), at('c', 100)];
  const m = merge(shown, [at('new', 1000), at('late', 300), ...shown], new Set(), newestPosted);
  assert.deepEqual(ids(m.rows), ['new', 'a', 'b', 'late', 'c']);
  assert.deepEqual(m.arrived, ['new', 'late']);
});

test('For You: a shown post keeps its place and takes its newer facts; a hidden one never arrives', () => {
  const m = merge([at('a', 900, 1), at('b', 500)], [at('a', 900, 7), at('h', 700)], new Set(['h']), newestPosted);
  assert.deepEqual(ids(m.rows), ['a', 'b']);
  assert.equal((m.rows[0] as unknown as { views: number }).views, 7);
  assert.deepEqual(m.arrived, []);
});

test('For You: a new post whose posted time we do not hold goes in at the top, as before', () => {
  const m = merge([at('a', 900)], [at('dash', null)], new Set(), newestPosted);
  assert.deepEqual(ids(m.rows), ['dash', 'a']);
});
