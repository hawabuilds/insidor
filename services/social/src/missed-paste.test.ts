/**
 * The missed-posts paste read: each coin address goes with its nearest post link, whichever side
 * the owner wrote it on; an address with no link is left over, never dropped; a link that is not a
 * post is refused with what to paste instead. No network, no database.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readPaste } from './missed-paste.ts';

const PUMP = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';
const PLAIN = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const THIRD = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const X1 = 'https://x.com/obie/status/2110053432371376380?s=20';
const X2 = 'https://x.com/nikkei/status/2110249450690031716';
const TT = 'https://www.tiktok.com/@buddytrashpanda/video/7695970441126579470';
const pairs = (text: string) => readPaste(text).posts.map((p) => [p.url, p.address]);

test('"<link> <address>" on each line: each address with its own line\'s link, pump-suffixed or not', () => {
  assert.deepEqual(pairs(`${X1} ${PUMP}\n${X2} ${PLAIN}\n${TT}`), [[X1, PUMP], [X2, PLAIN], [TT, null]]);
  assert.deepEqual(readPaste(`${X1} ${PUMP}`).loose, []);
});

test('the address first, or on the next line, goes with the nearest link in the paste\'s own order', () => {
  assert.deepEqual(pairs(`${PUMP} ${X1}\n${PLAIN} ${X2}`), [[X1, PUMP], [X2, PLAIN]]);
  assert.deepEqual(pairs(`${X1}\n${PUMP}\n${X2}\n${PLAIN}\n${TT}`), [[X1, PUMP], [X2, PLAIN], [TT, null]]);
  assert.deepEqual(pairs(`${PUMP}\n${X1}\n${PLAIN}\n${X2}`), [[X1, PUMP], [X2, PLAIN]]);
  assert.deepEqual(pairs(`${X1}\n\n${PUMP}\n\n${X2}\n\n${PLAIN}`), [[X1, PUMP], [X2, PLAIN]]);
});

test('the whole paste on one line, with labels and punctuation, still pairs', () => {
  assert.deepEqual(pairs(`${X1} CA:${PUMP}, ${X2} (${PLAIN}) solana:${THIRD} ${TT}`).slice(0, 2), [[X1, PUMP], [X2, PLAIN]]);
});

test('addresses with no link, or a second one for a link, are left over and not dropped', () => {
  const alone = readPaste(`${PUMP}\n${PLAIN}`);
  assert.deepEqual(alone.posts, []);
  assert.deepEqual(alone.loose, [PUMP, PLAIN]);
  const extra = readPaste(`${X1} ${PUMP}\n${THIRD}\n${X2} ${PLAIN}`);
  assert.deepEqual(extra.posts.map((p) => p.address), [PUMP, PLAIN]);
  assert.deepEqual(extra.loose, [THIRD]);
});

test('a coin site link counts as its address', () => {
  assert.deepEqual(pairs(`${X1} https://pump.fun/coin/${PUMP}`), [[X1, PUMP]]);
});

test('a profile, share or other link is refused with what to paste; a post link is not', () => {
  const r = readPaste(`https://www.tiktok.com/@givefromtheheart2?_r=1&_t=ZS-9AY4oPVgwL8 ${PUMP}\nhttps://x.com/obie\nhttps://vm.tiktok.com/ZMabc/\nhttps://example.com/a\n${TT}\nhttps://www.tiktok.com/@a/photo/7695970441126579470`);
  assert.deepEqual(r.posts.map((p) => p.refused), [
    "This is a profile link, not a post. Paste the video's link.",
    "This is a profile link, not a post. Paste the post's link.",
    "This is a share link. Open it and paste the video's full link.",
    'This is not an X or TikTok post link.',
    null,
    null,
  ]);
  assert.equal(r.posts[0]?.address, PUMP, 'the address stays beside the refused link, in sight');
  assert.equal(r.posts[4]?.itemId, 'tiktok:7695970441126579470');
});

test('a link pasted twice is one post; words that are neither are ignored', () => {
  assert.deepEqual(pairs(`${X1}\n${X1} ${PUMP}\nthis one went to 2m`), [[X1, PUMP]]);
  assert.deepEqual(readPaste(42), { posts: [], loose: [] });
});
