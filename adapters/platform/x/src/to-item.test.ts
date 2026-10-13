/**
 * These assert the two things a reviewer cannot check by reading: that reach
 * carries its quantized fidelity, and that a rebroadcast is not filed as a
 * reproduction. The second is the product's central signal, inverted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEGRADED, PLAIN, QUOTE, REBROADCAST } from './__fixtures__/posts.ts';
import { toAuthor, toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

test('reach is declared quantized, so a sub-step change can be censored downstream', () => {
  const item = toItem(PLAIN, AT);
  assert.deepEqual(item.counters.reach?.fidelity, { kind: 'quantized', significantDigits: 3 });
  assert.equal(item.counters.reach?.value, 1_240_000);
  assert.deepEqual(item.counters.conversation?.fidelity, { kind: 'exact' });
});

test('a quote is a reproduction and a retweet is a rebroadcast — never the reverse', () => {
  const q = toItem(QUOTE, AT);
  assert.equal(q.reproductionOf, 'x:1823456789012345678');
  assert.equal(q.rebroadcastOf, null);

  const r = toItem(REBROADCAST, AT);
  assert.equal(r.rebroadcastOf, 'x:1823456789012345678');
  assert.equal(r.reproductionOf, null);
});

test('the read instant is injected, never read from a clock', () => {
  const a = toItem(PLAIN, AT);
  const b = toItem(PLAIN, AT + 60_000);
  assert.equal(a.firstSeenAt, AT);
  assert.equal(b.firstSeenAt, AT + 60_000);
  assert.equal(a.counters.approval?.observedAt, AT);
  assert.deepEqual(toItem(PLAIN, AT), a, 'translation is deterministic');
});

test('an unreadable counter is null, not zero', () => {
  const item = toItem(DEGRADED, AT);
  assert.equal(item.counters.reach?.value, null);
  assert.equal(item.counters.approval?.value, null);
  assert.equal(item.postedAt, null, 'an unparseable date is null, never a guess');
});

test('entity spans are unprefixed so they can join across sources', () => {
  const item = toItem(PLAIN, AT);
  const spans = item.fingerprints.filter((f) => f.kind === 'entitySpan').map((f) => f.key);
  assert.deepEqual(spans, ['cashtag:CHILL', 'hashtag:chillguy']);
});

test('this source has no reusable format object, and says so with an empty list', () => {
  assert.deepEqual(toItem(PLAIN, AT).formatIds, []);
});

test('the raw payload is referenced, never inlined', () => {
  const item = toItem(PLAIN, AT);
  assert.equal(item.rawRef, 'x/1823456789012345678.json');
});

test('★ the author carries the handle in the post URL, keyed exactly as the post is', () => {
  const author = toAuthor(PLAIN, AT);
  assert.ok(author);
  assert.equal(author.handle, 'someone');
  assert.equal(author.authorKey, toItem(PLAIN, AT).authorKey, 'the author row and the post must meet');
});

test('an account with no handle in the payload has a null handle, and one with no id has no row', () => {
  assert.equal(toAuthor(QUOTE, AT)?.handle, null);
  assert.equal(toAuthor(DEGRADED, AT), null);
});

test('a leading @ is stripped once, here, so it never reaches a link', () => {
  assert.equal(toAuthor({ author: { id: '1', userName: '@someone' } }, AT)?.handle, 'someone');
});

test("the author's follower count, name and picture are kept, with the read's instant", () => {
  const a = toAuthor({ author: { id: '1', userName: 'raw', name: 'Raw Alerts', followers: 1_900_000, profilePicture: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' } }, AT);
  assert.deepEqual(a?.audience, { value: 1_900_000, fidelity: { kind: 'exact' }, observedAt: AT });
  assert.equal(a?.displayName, 'Raw Alerts');
  assert.equal(a?.pictureUri, 'https://pbs.twimg.com/profile_images/1/a_200x200.jpg');
  const bare = toAuthor({ author: { id: '2' } }, AT);
  assert.equal(bare?.audience, null, 'no count is no counter, never zero');
  assert.equal(bare?.pictureUri, null);
});

test("a video keeps its own mp4 to play in the app: the best rendition a phone plays smoothly, never a playlist", () => {
  const item = toItem({
    id: '9', author: { id: '1' },
    extendedEntities: { media: [{ type: 'video', media_url_https: 'https://pbs.twimg.com/v.jpg', video_info: { duration_millis: 14_000, variants: [
      { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/v.m3u8' },
      { content_type: 'video/mp4', bitrate: 256_000, url: 'https://video.twimg.com/low.mp4' },
      { content_type: 'video/mp4', bitrate: 2_176_000, url: 'https://video.twimg.com/mid.mp4' },
      { content_type: 'video/mp4', bitrate: 10_368_000, url: 'https://video.twimg.com/high.mp4' },
    ] } }] },
  }, AT);
  assert.equal(item.media[0]?.playUri, 'https://video.twimg.com/mid.mp4');
  assert.equal(item.media[0]?.uri, 'https://pbs.twimg.com/v.jpg', 'the still stays the picture');
  assert.equal(toItem(PLAIN, AT).media[0]?.playUri, undefined, 'a photo has nothing to play');
});
