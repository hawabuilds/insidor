/** The narrative page's posts (posts-order.ts): the post posted first is pinned, the two moments, the rest newest first. */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeStory } from '../../shared/api/decode.ts';
import type { Evidence, Story } from '../../shared/api/index.ts';
import { fixtureStory, sampleNarrativeIds } from '../../test-fixtures/fixtures.ts';
import { allBucketMs } from '../post-sheet/gain-chart.ts';
import { firstPosted, moments, mostViewedFirst, newestFirst, startedByHandle } from './posts-order.ts';

const base = decodeStory(fixtureStory(sampleNarrativeIds()[0] ?? '')) as Story;
const template = base.evidence[0] as Evidence;
const post = (id: string, postedAt: number | null): Evidence => ({ ...template, evidenceId: id, postedAt: postedAt === null ? { known: false, pending: 'not_reported' } : { known: true, at: postedAt } } as Evidence);
const story = (posts: readonly Evidence[], found: Record<string, number | null>): Story => ({
  ...base,
  evidence: posts,
  postViews: new Map(Object.entries(found).map(([id, f]) => [id, { views: null, gainedLastHour: null, foundAt: f }] as const)),
});

test('★ pinned is the post that went up first, even when we found it later; "We found it" is the story\'s earliest find', () => {
  const s = { ...story([post('early-posted', 100), post('found-first', 500), post('late', 900)], { 'early-posted': 2_000, 'found-first': 600, late: 1_000 }), foundAt: { known: true as const, at: 600 } };
  assert.equal(firstPosted(s)?.post.evidenceId, 'early-posted');
  assert.deepEqual(moments(s), { firstPost: { known: true, at: 100 }, found: { known: true, at: 600 } });
  assert.deepEqual(newestFirst(s, 'early-posted').map((e) => e.evidenceId), ['late', 'found-first']);
});

test('★ remove the pinned post and the next earliest posted takes its place', () => {
  const s = story([post('b', 500), post('c', 900)], { a: 1, b: 700, c: 650 });
  assert.equal(firstPosted(s)?.post.evidenceId, 'b', 'a post no longer listed is never pinned');
});

test('no posted time and no found time: nothing pinned, each moment a dash with its reason, every post listed', () => {
  const s: Story = { ...story([post('a', null), post('b', null)], {}), foundAt: null };
  assert.equal(firstPosted(s), null);
  assert.deepEqual(moments(s), { firstPost: { known: false, why: 'the sites gave no post times' }, found: { known: false, why: 'not recorded for this narrative' } });
  assert.deepEqual(newestFirst(s, null).map((e) => e.evidenceId), ['a', 'b']);
});

test('"All" keeps a two-day story to at most 48 points, never finer than the series', () => {
  const H = 3_600_000;
  assert.equal(allBucketMs(10 * H, 30 * 60_000), 30 * 60_000);
  assert.equal(allBucketMs(47 * H, 30 * 60_000), H);
  assert.equal(allBucketMs(60 * H, 30 * 60_000), 2 * H);
  assert.equal(allBucketMs(3 * H, 5 * 60_000), 30 * 60_000);
});

test('★ "Started by @handle" only with the server\'s proof, and only for the pinned post\'s own account', () => {
  const first = { ...post('first', 100), authorLabel: '@BarkinResmii' };
  const s = story([first, post('later', 900)], {});
  const proven: Story = { ...s, earliestPost: { known: true, at: 100, authorLabel: '@BarkinResmii', permalink: null, startedBy: 'quoted' } };
  assert.equal(startedByHandle(proven, first), '@BarkinResmii');
  assert.equal(startedByHandle({ ...s, earliestPost: { known: true, at: 100, authorLabel: '@BarkinResmii', permalink: null, startedBy: null } }, first), null, 'the earliest post found is not proof it started the story');
  assert.equal(startedByHandle({ ...s, earliestPost: { known: true, at: 100, authorLabel: '@someoneElse', permalink: null, startedBy: 'quoted' } }, first), null, 'never another account than the post pinned under it');
  assert.equal(startedByHandle({ ...s, earliestPost: { known: false, pending: 'not_read_yet' } }, first), null);
  assert.equal(startedByHandle(proven, null), null);
});

test('most viewed first: by each post\'s newest views, a post never read after every read one, ties in the page\'s order', () => {
  const s: Story = { ...base, evidence: [post('a', 1), post('b', 2), post('c', 3), post('d', 4)], postViews: new Map([['a', { views: 10, gainedLastHour: null, foundAt: null }], ['b', { views: null, gainedLastHour: null, foundAt: null }], ['c', { views: 900, gainedLastHour: null, foundAt: null }], ['d', { views: 10, gainedLastHour: null, foundAt: null }]]) };
  assert.deepEqual(mostViewedFirst(s).map((e) => e.evidenceId), ['c', 'a', 'd', 'b']);
});
