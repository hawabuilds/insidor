/** For You's narrative tag: the board's own answer, the legacy test before 0093, and a feed still served without either table. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STORY_TAGS_LEGACY_SQL, STORY_TAGS_SQL, withStoryTags } from './story-tags.ts';

const missing = () => Object.assign(new Error('missing'), { code: '42P01' });

test('a post in a narrative on the board carries it beside the card; others are untouched', async () => {
  const db = { query: async () => [{ item_id: 'x:1', story_id: 'n-x:1', title: 'GTA 6', posts: 12 }] };
  const out = await withStoryTags(db, [{ id: 'x:1' }, { id: 'x:2' }]);
  assert.deepEqual(out, [{ id: 'x:1', inStory: { storyId: 'n-x:1', title: 'GTA 6', posts: 12 } }, { id: 'x:2' }]);
});

test('★ the board\'s own answer (story_post); before 0093 only promoted, unmerged, observed narratives with a page', () => {
  assert.ok(STORY_TAGS_SQL.includes('public.story_post'));
  for (const part of ["s.state = 'promoted'", 's.merged_into is null', "s.origin = 'observed'", 'join public.story_view']) assert.ok(STORY_TAGS_LEGACY_SQL.includes(part), part);
});

test('before 0093 the legacy statement answers', async () => {
  const db = { query: async (sql: string) => {
    if (sql === STORY_TAGS_SQL) throw missing();
    return [{ item_id: 'x:1', story_id: 'st_1', title: 'Old', posts: 2 }];
  } };
  assert.deepEqual(await withStoryTags(db, [{ id: 'x:1' }]), [{ id: 'x:1', inStory: { storyId: 'st_1', title: 'Old', posts: 2 } }]);
});

test('a database without the narrative tables serves the feed as before', async () => {
  const db = { query: async () => { throw missing(); } };
  assert.deepEqual(await withStoryTags(db, [{ id: 'x:1' }]), [{ id: 'x:1' }]);
});
