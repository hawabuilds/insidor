/** The feed card's playable video: the post sheet's own rule, only for a card that shows a video, and a feed served as before without it. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_VIDEO_SQL, withCardVideos } from './card-video.ts';

const missing = () => Object.assign(new Error('missing'), { code: '42P01' });
const MP4 = 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4?tag=12';
const STILL = 'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/a.jpg';

test('a video card with a playable file carries it; other cards are untouched', async () => {
  const db = { query: async () => [{ item_id: 'x:1', media: [{ kind: 'video', uri: STILL, playUri: MP4, durationMs: 7000 }] }] };
  const out = await withCardVideos(db, [{ id: 'x:1', thumbIsVideo: true }, { id: 'x:2', thumbIsVideo: false }]);
  assert.deepEqual(out, [{ id: 'x:1', thumbIsVideo: true, video: { playUrl: MP4, loops: false } }, { id: 'x:2', thumbIsVideo: false }]);
});

test('a GIF loops, as in the post sheet', async () => {
  const db = { query: async () => [{ item_id: 'x:1', media: [{ kind: 'video', uri: STILL, playUri: MP4, loops: true }] }] };
  const [card] = await withCardVideos<Record<string, unknown>>(db, [{ id: 'x:1', thumbIsVideo: true }]);
  assert.deepEqual(card?.['video'], { playUrl: MP4, loops: true });
});

test('★ no playable file is no field: a TikTok video, a non-mp4 link, a post with no media', async () => {
  const db = { query: async () => [
    { item_id: 'tt:1', media: [{ kind: 'video', uri: STILL }] },
    { item_id: 'x:2', media: [{ kind: 'video', uri: STILL, playUri: 'https://video.twimg.com/a.m3u8' }] },
    { item_id: 'x:3', media: [] },
  ] };
  const cards = [{ id: 'tt:1', thumbIsVideo: true }, { id: 'x:2', thumbIsVideo: true }, { id: 'x:3', thumbIsVideo: true }];
  assert.deepEqual(await withCardVideos(db, cards), cards);
});

test('a feed with no video cards asks nothing', async () => {
  let asked = false;
  const db = { query: async () => { asked = true; return []; } };
  await withCardVideos(db, [{ id: 'x:1', thumbIsVideo: false }]);
  assert.equal(asked, false);
});

test('only the posts\' own rows are read, by id', async () => {
  let seen: unknown[] = [];
  const db = { query: async (sql: string, params: readonly unknown[]) => { assert.equal(sql, CARD_VIDEO_SQL); seen = [...params]; return []; } };
  await withCardVideos(db, [{ id: 'x:1', thumbIsVideo: true }]);
  assert.deepEqual(seen, [['x:1']]);
});

test('a database without the table serves the feed as before', async () => {
  const db = { query: async () => { throw missing(); } };
  assert.deepEqual(await withCardVideos(db, [{ id: 'x:1', thumbIsVideo: true }]), [{ id: 'x:1', thumbIsVideo: true }]);
});
