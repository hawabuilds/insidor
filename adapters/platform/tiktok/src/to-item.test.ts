/**
 * The first test in this file is the regression test for the defect that
 * motivated the rebuild. It should be the last one anybody ever deletes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEGRADED, STITCH, WITH_SOUND } from './__fixtures__/posts.ts';
import { CAPABILITIES } from './capabilities.ts';
import { toAuthor, toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

test('no item from this source carries a reproduction counter, in any form', () => {
  for (const raw of [WITH_SOUND, STITCH, DEGRADED]) {
    const item = toItem(raw, AT);
    assert.equal(
      'reproduction' in item.counters,
      false,
      'the key must be absent — not null, not zero, not a counter with a null value',
    );
  }
  assert.deepEqual(CAPABILITIES.absent, ['reproduction']);
  assert.equal(CAPABILITIES.counters.includes('reproduction'), false);
});

test('a share is a rebroadcast and never fills the reproduction gap', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.equal(item.counters.rebroadcast?.value, 9_021);
  assert.equal(item.counters.retention?.value, 41_882);
});

test('a stitch is a reproduction pointer, and rebroadcastOf stays null', () => {
  const item = toItem(STITCH, AT);
  assert.equal(item.reproductionOf, 'tiktok:7391234567890123456');
  assert.equal(item.rebroadcastOf, null);
});

test('play and approval are quantized; comment, share and save are exact', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.deepEqual(item.counters.reach?.fidelity, { kind: 'quantized', significantDigits: 4 });
  assert.deepEqual(item.counters.approval?.fidelity, { kind: 'quantized', significantDigits: 4 });
  assert.deepEqual(item.counters.conversation?.fidelity, { kind: 'exact' });
});

test('a shared sound becomes a prefixed format id and a free carrier', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.deepEqual(item.formatIds, ['tiktok:sound:7380000000000000001', 'tiktok:effect:1234567']);
  const carriers = item.fingerprints.filter((f) => f.kind === 'formatId').map((f) => f.key);
  assert.deepEqual(carriers, ['tiktok:sound:7380000000000000001', 'tiktok:effect:1234567']);
});

test('the read instant is injected and translation is deterministic', () => {
  assert.equal(toItem(WITH_SOUND, AT).firstSeenAt, AT);
  assert.equal(toItem(WITH_SOUND, AT + 1).firstSeenAt, AT + 1);
  assert.deepEqual(toItem(WITH_SOUND, AT), toItem(WITH_SOUND, AT));
});

test('a payload with no stats object yields null counters, not zeros', () => {
  const item = toItem(DEGRADED, AT);
  assert.equal(item.counters.reach?.value, null);
  assert.equal(item.postedAt, null);
  assert.equal(item.authorKey, 'tiktok:unknown');
});

test('★ the handle is uniqueId, the @name in the post URL, never the free-text nickname', () => {
  const author = toAuthor(WITH_SOUND, AT);
  assert.ok(author);
  assert.equal(author.handle, 'someone');
  assert.equal(author.authorKey, toItem(WITH_SOUND, AT).authorKey);
});

test('a payload with no usable author object has no author row', () => {
  assert.equal(toAuthor(DEGRADED, AT), null);
});

test("★ the configured scraper's flattened post becomes the same Item: text, account, cover, counts", async () => {
  const { SCRAPER_POST } = await import('./__fixtures__/posts.ts');
  const item = toItem(SCRAPER_POST, 1_800_000_000_000 as never);
  assert.equal(item.text, 'the hippo is back #moodeng');
  assert.equal(item.media[0]?.uri, 'https://p16-sign.tiktokcdn.com/obj/cover.jpeg');
  assert.equal(item.media[0]?.durationMs, 15_000, 'a cover with a duration: the feed draws it as a video');
  assert.equal(item.counters.reach?.value, 310_000);
  assert.equal(item.counters.approval?.value, 8_100);
  assert.equal(item.postedAt, 1_791_430_248_000);
  assert.ok(item.fingerprints.some((f) => f.kind === 'entitySpan'));
  assert.ok(item.formatIds.includes('tiktok:sound:7400000000000000002'));
  assert.equal(toAuthor(SCRAPER_POST, 0 as never)?.handle, 'zookeeperdiary');
});

test("the account's follower count, name and picture are kept from the scraper's spelling", () => {
  const a = toAuthor({ id: '1', authorMeta: { id: '6900', name: 'zoo', nickName: 'Zoo Keeper', fans: 52_000, avatar: 'https://p16-sign.tiktokcdn.com/a.jpeg' } }, 5 as never);
  assert.deepEqual(a?.audience, { value: 52_000, fidelity: { kind: 'exact' }, observedAt: 5 });
  assert.equal(a?.displayName, 'Zoo Keeper');
  assert.equal(a?.pictureUri, 'https://p16-sign.tiktokcdn.com/a.jpeg');
  assert.equal(toAuthor({ id: '1', authorMeta: { id: '6900', name: 'zoo' } }, 5 as never)?.audience, null, 'no count is no counter');
});

test('the profile text is the signature with the bio link after it; a blank one is read, a missing one is not', () => {
  const ca = 'AMQ8BusAhpwbt3ufSCTi4k3BEQ7AecX9u12Jnk6Spump';
  const withBio = { id: '1', authorMeta: { id: '9', name: 'a', signature: `${ca}\n\nX: someone`, bioLink: { link: 'https://example.com/x' } } };
  assert.equal(toAuthor(withBio, AT)?.bio, `${ca}\n\nX: someone\nhttps://example.com/x`);
  assert.equal(toAuthor({ id: '1', authorMeta: { id: '9', name: 'a', signature: '' } }, AT)?.bio, '', 'read and blank');
  assert.equal(toAuthor({ id: '1', authorMeta: { id: '9', name: 'a' } }, AT)?.bio, null, 'not read: the search actor sends none');
});
