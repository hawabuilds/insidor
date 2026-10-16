/** For You's narrative tag: only real narratives, beside the card, and a feed still served without the tables. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STORY_TAGS_SQL, withStoryTags } from './story-tags.ts';

test('a post in a real narrative carries it beside the card; others are untouched', async () => {
  const db = { query: async () => [{ item_id: 'x:1', story_id: 'st_1', title: 'GTA 6', posts: 12 }] };
  const out = await withStoryTags(db, [{ id: 'x:1' }, { id: 'x:2' }]);
  assert.deepEqual(out, [{ id: 'x:1', inStory: { storyId: 'st_1', title: 'GTA 6', posts: 12 } }, { id: 'x:2' }]);
});

test('★ only promoted, unmerged, observed narratives with a page', () => {
  for (const part of ["s.state = 'promoted'", 's.merged_into is null', "s.origin = 'observed'", 'join public.story_view']) assert.ok(STORY_TAGS_SQL.includes(part), part);
});

test('a database without the narrative tables serves the feed as before', async () => {
  const db = { query: async () => { throw Object.assign(new Error('missing'), { code: '42P01' }); } };
  assert.deepEqual(await withStoryTags(db, [{ id: 'x:1' }]), [{ id: 'x:1' }]);
});
