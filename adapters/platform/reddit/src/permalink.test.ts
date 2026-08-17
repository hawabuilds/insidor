/**
 * The URL is asserted CHARACTER FOR CHARACTER, and that is the whole point of
 * the test. Everything else in this package can be checked by reading it; a
 * link cannot — a stray prefix still typechecks, still renders, still looks
 * like a citation, and only fails in a browser belonging to the one user who
 * bothered to check our work. So the expected string is written out in full
 * rather than rebuilt from the template the implementation uses, which would
 * assert nothing.
 *
 * The three ids below are the three that have been citing nothing since the
 * seed was written.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { postUrl, postUrlFromPath } from './permalink.ts';

test('★ the fullname prefix is stripped, because the stored id is not the id in the URL', () => {
  // `https://www.reddit.com/comments/t3_1a2b3c` is not the post. Nothing
  // upstream catches this: the projector's gate is /^[A-Za-z0-9._~-]+$/, which
  // admits the underscore, so the wrong URL would be built and shipped without
  // a single complaint.
  assert.equal(postUrl('dancing_gran', 't3_1a2b3c'), 'https://www.reddit.com/comments/1a2b3c');
  assert.equal(postUrl('videoclips_daily', 't3_1a2b3d'), 'https://www.reddit.com/comments/1a2b3d');
  assert.equal(postUrl('family_archive', 't3_1a2b3e'), 'https://www.reddit.com/comments/1a2b3e');
});

test('an id that is already bare is left alone', () => {
  assert.equal(postUrl('dancing_gran', '1a2b3c'), 'https://www.reddit.com/comments/1a2b3c');
});

test('the author is not in the path on this source, so the handle changes nothing', () => {
  // It is part of the shared builder signature and genuinely unused here. The
  // canonical path is qualified by the COMMUNITY, which the seam does not carry.
  assert.equal(postUrl('someone', 't3_abc'), postUrl('someone_else', 't3_abc'));
});

test('the canonical host is the destination, not the redirect', () => {
  // Verified live: https://redd.it/<id> answers 301 with
  // location: https://www.reddit.com/comments/<id>. Citing the redirect would
  // make every link we have published depend on a hop somebody else can
  // withdraw, and a redirect that quietly stops redirecting kills every
  // citation at once.
  const url = postUrl('dancing_gran', 't3_1a2b3c');
  assert.equal(url.startsWith('https://www.reddit.com/'), true);
  assert.equal(url.includes('redd.it'), false);
  assert.equal(url.includes('old.reddit.com'), false);
});

test('★ the path the API returns is preferred when a payload is in hand, and validated when it is', () => {
  assert.equal(
    postUrlFromPath('/r/aww/comments/1a2b3c/my_nana_learns_the_dance/'),
    'https://www.reddit.com/r/aww/comments/1a2b3c/my_nana_learns_the_dance/',
  );
  assert.equal(postUrlFromPath('/r/aww/comments/1a2b3c'), 'https://www.reddit.com/r/aww/comments/1a2b3c');
});

test('a vendor-controlled path that would leave the host is an absence, not a prefixed string', () => {
  // Concatenating a fixed origin with a string somebody else chose is how an
  // on-host link stops being on-host. A citation that goes somewhere wrong is
  // the worst thing an evidence list can do.
  for (const path of [
    '//evil.example.invalid/r/aww/comments/1a2b3c/',
    '/\\evil.example.invalid/',
    'https://evil.example.invalid/r/aww/comments/1a2b3c/',
    '/r/aww/comments/1a2b3c/../../../admin',
    '/u/dancing_gran',
    '',
  ]) {
    assert.equal(postUrlFromPath(path), null, `'${path}' must not become a citation`);
  }
});

test('a path long enough to be a payload rather than a slug is refused too', () => {
  // The shape check admits an unbounded slug, and a shape check with no length
  // on it is half a check on a string somebody else chose. This vendor's own
  // slugs are short; five thousand characters is not a title.
  assert.equal(postUrlFromPath(`/r/aww/comments/1a2b3c/${'a'.repeat(5_000)}`), null);
  assert.ok(postUrlFromPath(`/r/aww/comments/1a2b3c/${'a'.repeat(100)}`) !== null, 'a real slug still passes');
});
