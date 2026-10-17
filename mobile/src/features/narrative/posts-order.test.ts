/** The narrative page's posts (posts-order.ts): the post we found first is pinned, the rest newest first. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Evidence, Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { allBucketMs } from '../post-sheet/gain-chart.ts';
import { firstCaught, newestFirst } from './posts-order.ts';

const base = decodeStory(fixtureStory(sampleNarrativeIds()[0] ?? '')) as Story;
const template = base.evidence[0] as Evidence;
const post = (id: string, postedAt: number | null): Evidence => ({ ...template, evidenceId: id, postedAt: postedAt === null ? { known: false, pending: 'not_reported' } : { known: true, at: postedAt } } as Evidence);
const story = (posts: readonly Evidence[], found: Record<string, number | null>): Story => ({
  ...base,
  evidence: posts,
  postViews: new Map(Object.entries(found).map(([id, f]) => [id, { views: null, gainedLastHour: null, foundAt: f }] as const)),
});

test('★ pinned is the post we FOUND first, not the one posted first', () => {
  const s = story([post('early-posted', 100), post('found-first', 500), post('late', 900)], { 'early-posted': 2_000, 'found-first': 600, late: 1_000 });
  assert.equal(firstCaught(s)?.post.evidenceId, 'found-first');
  assert.equal(firstCaught(s)?.foundAt, 600);
  assert.deepEqual(newestFirst(s, 'found-first').map((e) => e.evidenceId), ['late', 'early-posted']);
});

test('★ remove the pinned post and the next earliest found takes its place', () => {
  const s = story([post('b', 500), post('c', 900)], { a: 1, b: 700, c: 650 });
  assert.equal(firstCaught(s)?.post.evidenceId, 'c', 'a post no longer listed is never pinned');
});

test('no found time from the server: nothing pinned, every post listed', () => {
  const s = story([post('a', 1), post('b', null), post('c', 3)], { a: null });
  assert.equal(firstCaught(s), null);
  assert.deepEqual(newestFirst(s, null).map((e) => e.evidenceId), ['c', 'a', 'b']);
});

test('"All" keeps a two-day story to at most 48 points, never finer than the series', () => {
  const H = 3_600_000;
  assert.equal(allBucketMs(10 * H, 30 * 60_000), 30 * 60_000);
  assert.equal(allBucketMs(47 * H, 30 * 60_000), H);
  assert.equal(allBucketMs(60 * H, 30 * 60_000), 2 * H);
  assert.equal(allBucketMs(3 * H, 5 * 60_000), 30 * 60_000);
});
