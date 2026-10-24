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
  assert.equal(a?.pictureUri, 'https://pbs.twimg.com/profile_images/1/a_400x400.jpg');
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
  assert.equal(item.media[0]?.loops, undefined, 'a real video is not a loop');
});

test('a GIF keeps its mp4 and is marked to loop', () => {
  const item = toItem({
    id: '10', author: { id: '1' },
    extendedEntities: { media: [{ type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', video_info: { variants: [
      { content_type: 'video/mp4', bitrate: 0, url: 'https://video.twimg.com/tweet_video/g.mp4' },
    ] } }] },
  }, AT);
  assert.equal(item.media[0]?.kind, 'video');
  assert.equal(item.media[0]?.playUri, 'https://video.twimg.com/tweet_video/g.mp4');
  assert.equal(item.media[0]?.loops, true);
});

test('the profile text is profile_bio.description with its links written out; none read is null', () => {
  const raw = {
    id: '1',
    author: { id: '9', userName: 'a', description: '', profile_bio: { description: 'my coin https://t.co/x', entities: { description: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com/coin/7Zf6B51t4ixKyS5L2cRWDjTi862Z5FQoeXgGsmLCpump' }] } } } },
  };
  assert.equal(toAuthor(raw, AT)?.bio, 'my coin https://t.co/x\nhttps://example.com/coin/7Zf6B51t4ixKyS5L2cRWDjTi862Z5FQoeXgGsmLCpump');
  assert.equal(toAuthor({ id: '1', author: { id: '9', userName: 'a' } }, AT)?.bio, null);
  assert.equal(toAuthor({ id: '1', author: { id: '9', userName: 'a', description: '' } }, AT)?.bio, '');
});

test("the posts a post's own links name are read from the expanded links; none said is absent, not empty", () => {
  const item = toItem(
    {
      id: '2112602660662878351',
      text: 'I FOUND THE NEW BRAINROT CHARACTER https://t.co/a https://t.co/b',
      author: { id: '1' },
      entities: {
        urls: [
          { url: 'https://t.co/a', expanded_url: 'https://tiktok.com/@someone/video/1' },
          { url: 'https://t.co/b', expanded_url: 'https://x.com/literallymecats/status/2111886889406148793' },
          { url: 'https://t.co/c', expanded_url: 'https://twitter.com/literallymecats/status/2111886889406148793?s=20' },
          { url: 'https://t.co/d', expanded_url: 'https://x.com/me/status/2112602660662878351/video/1' },
        ],
      },
    },
    AT,
  );
  assert.deepEqual(item.refersTo, ['x:2111886889406148793']);
  assert.deepEqual(toItem(PLAIN, AT).refersTo, []);
  assert.equal(toItem(DEGRADED, AT).refersTo, undefined);
});

/* The vendor nests the quoted post whole inside a quote post. Shaped on the owner's example
   (2026-10-24): a quote with no picture of its own, whose quoted post carries the meme. */
const QUOTE_WITH_POST: unknown = {
  id: '2113365660697084315',
  text: 'Turned him into a exotic bengal cat',
  createdAt: 'Thu Oct 22 20:23:32 +0000 2026',
  lang: 'en',
  author: { id: '615938424', userName: 'ApplaudAhhJones' },
  entities: {},
  quoted_tweet: {
    id: '2113297675160613289',
    text: 'my cat after the groomer https://t.co/abc123',
    createdAt: 'Thu Oct 22 15:53:21 +0000 2026',
    lang: 'en',
    viewCount: 5_000_000,
    author: { id: '777', userName: '@catowner', name: 'Cat Owner', profilePicture: 'https://pbs.twimg.com/profile_images/1/me_normal.jpg' },
    extendedEntities: { media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/cat.jpg', sizes: { large: { w: 900, h: 1200 } } }] },
    quoted_tweet: { id: '1', text: 'a third level', author: { id: '2' } },
  },
};

test('★ the quoted post the payload carries is kept with the quote, at no extra read', () => {
  const q = toItem(QUOTE_WITH_POST, AT);
  assert.equal(q.reproductionOf, 'x:2113297675160613289');
  const r = q.reproducedPost;
  assert.ok(r !== undefined, 'the inline post is read');
  assert.equal(r.itemId, 'x:2113297675160613289', 'keyed as a search would key it, so the two meet');
  assert.equal(r.authorKey, 'x:777');
  assert.equal(r.authorHandle, 'catowner', 'the sigil is stripped once, as for any account');
  assert.equal(r.authorName, 'Cat Owner');
  assert.equal(r.authorPictureUri, 'https://pbs.twimg.com/profile_images/1/me_400x400.jpg');
  assert.equal(r.text, 'my cat after the groomer https://t.co/abc123');
  assert.deepEqual(r.media.map((m) => m.uri), ['https://pbs.twimg.com/media/cat.jpg']);
  assert.equal(r.postedAt, Date.parse('2026-10-22T15:53:21Z'));
  assert.equal(r.readAt, AT);
  assert.equal('reproducedPost' in r, false, "one level only: the quoted post's own quote is dropped");
});

test('a quote whose payload names only the id, an empty post or no account carries no quoted post', () => {
  assert.equal(toItem(QUOTE, AT).reproducedPost, undefined);
  const base = QUOTE_WITH_POST as Record<string, unknown>;
  assert.equal(toItem({ ...base, quoted_tweet: { id: '9', text: '', author: { id: '8' } } }, AT).reproducedPost, undefined);
  assert.equal(toItem({ ...base, quoted_tweet: { id: '9', text: 'words' } }, AT).reproducedPost, undefined);
});
