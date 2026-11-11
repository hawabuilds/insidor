/** The Narratives tab's row: the page's most viewed posts with their own views, then each poster's face and playable video; `evidence` untouched. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROW_MAX, ROW_POSTS_SQL, rowPostsOf, withRowFaces } from './narrative-rows.ts';
import { cardOf } from './narrative-sorts.ts';

const MP4 = 'https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4';
const ev = (id: string) => ({ evidenceId: id, sourceLabel: 'X', authorLabel: '@' + id, permalink: 'https://x.com/a/status/' + id, excerpt: 'words ' + id, thumbUrl: null, postedAt: { at: 1 }, relation: 'posted' });

test('the row is the most viewed posts first, a post with no views after every one that has them, at most ROW_MAX', () => {
  const page = { evidence: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(ev), postViews: [{ postId: 'a', views: 10 }, { postId: 'b', views: null }, { postId: 'c', views: 900 }, { postId: 'd', views: 50 }, { postId: 'e', views: 50 }, { postId: 'f', views: 5 }] };
  const row = rowPostsOf(page);
  assert.equal(row.length, ROW_MAX);
  assert.deepEqual(row.map((p) => p['id']), ['c', 'd', 'e', 'a', 'f']);
  assert.equal(row[0]?.['views'], 900);
});

test('a row post\'s words are cut for two lines and read with their escaped characters undone', () => {
  const long = { ...ev('a'), excerpt: 'long press -&gt; copy GIF link &amp; paste ' + 'word '.repeat(60) };
  const [p] = rowPostsOf({ evidence: [long] });
  const t = p?.['excerpt'] as string;
  assert.ok(t.startsWith('long press -> copy GIF link & paste'));
  assert.ok(t.length <= 141 && t.endsWith('…'));
});

test('★ a post whose views were never read says null, never 0', () => {
  const row = rowPostsOf({ evidence: [ev('a')] });
  assert.equal(row[0]?.['views'], null);
});

test('★ the card keeps its one evidence entry exactly as before', () => {
  const page = { evidence: ['a', 'b', 'c'].map(ev), postViews: [{ postId: 'c', views: 9 }] };
  const card = cardOf(page) as { evidence: unknown[] };
  assert.deepEqual(card.evidence, [ev('a')]);
});

test('each row post gets its face and, for a video with a file, the file; others are left as they were', async () => {
  let asked: unknown[] = [];
  const db = { query: async (sql: string, params: readonly unknown[]) => {
    assert.equal(sql, ROW_POSTS_SQL);
    asked = [...params];
    return [
      { item_id: 'a', media: [{ kind: 'video', uri: 'https://pbs.twimg.com/a.jpg', playUri: MP4, durationMs: 9000 }], picture_url: 'https://pbs.twimg.com/profile_images/a.jpg', picture_copy: 'abcdefabcdefabcdefabcdefabcdef01' },
      { item_id: 'b', media: [{ kind: 'image', uri: 'https://pbs.twimg.com/b.jpg' }], picture_url: 'http://insecure', picture_copy: null },
    ];
  } };
  const [card] = await withRowFaces(db, [{ id: 's1', rowPosts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }]) as { rowPosts: Record<string, unknown>[] }[];
  assert.deepEqual(asked, [['a', 'b', 'c']]);
  assert.deepEqual(card?.rowPosts[0], { id: 'a', authorPictureUrl: 'https://pbs.twimg.com/profile_images/a.jpg', authorPictureFile: 'abcdefabcdefabcdefabcdefabcdef01', thumbIsVideo: true, video: { playUrl: MP4, loops: false } });
  assert.deepEqual(card?.rowPosts[1], { id: 'b', authorPictureUrl: null, authorPictureFile: null, thumbIsVideo: false });
  assert.deepEqual(card?.rowPosts[2], { id: 'c' });
});

test('cards with no row ask nothing; a database without the tables serves the cards as they were', async () => {
  let asked = false;
  await withRowFaces({ query: async () => { asked = true; return []; } }, [{ id: 's1' }]);
  assert.equal(asked, false);
  const cards = [{ id: 's1', rowPosts: [{ id: 'a' }] }];
  assert.deepEqual(await withRowFaces({ query: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } }, cards), cards);
});
