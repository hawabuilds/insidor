/**
 * The poster picture's order: our copy, then the source's link, then the letter; and the copy's
 * path is built only from a real file name.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { posterPicBase, posterPicFile, posterPicSources, sharpXPicture } from './poster-pic.ts';

const FILE = '0123456789abcdef0123456789abcdef';
const LINK = 'https://p16.example/avt/a.jpeg?x-expires=1';

test('★ the copy first, then the link; the letter only when there is neither', () => {
  assert.deepEqual(posterPicSources(FILE, LINK, 'https://s.example/b/author-pics'), [`https://s.example/b/author-pics/${FILE}`, LINK]);
  assert.deepEqual(posterPicSources(null, LINK, 'https://s.example/b/author-pics'), [LINK]);
  assert.deepEqual(posterPicSources(FILE, LINK, ''), [LINK], 'no base set: the link, as before');
  assert.deepEqual(posterPicSources(null, null, 'https://s.example/b/author-pics'), []);
});

test('the base is its own setting, else the coin-logo folder swapped, else none', () => {
  assert.equal(posterPicBase('https://s.example/x/', 'https://s.example/b/coin-logos'), 'https://s.example/x');
  assert.equal(posterPicBase(undefined, 'https://s.example/b/coin-logos/'), 'https://s.example/b/author-pics');
  assert.equal(posterPicBase('', 'https://elsewhere.example/logos'), '');
  assert.equal(posterPicBase(undefined, undefined), '');
});

test('a file name is 32 hex characters and nothing else can become a path', () => {
  assert.equal(posterPicFile(FILE), FILE);
  assert.equal(posterPicFile('../coin-logos/x'), null);
  assert.equal(posterPicFile(42), null);
  assert.deepEqual(posterPicSources('../x', null, 'https://s.example/b/author-pics'), []);
});

test('★ an X profile picture is asked at its 400px size first, its stored small link behind it', () => {
  const small = 'https://pbs.twimg.com/profile_images/2068058848502374400/X61b41S3_normal.jpg';
  assert.deepEqual(posterPicSources(null, small, ''), ['https://pbs.twimg.com/profile_images/2068058848502374400/X61b41S3_400x400.jpg', small]);
  assert.equal(sharpXPicture('https://pbs.twimg.com/profile_images/1/a_bigger.png'), 'https://pbs.twimg.com/profile_images/1/a_400x400.png');
  assert.equal(sharpXPicture('https://pbs.twimg.com/profile_images/1/a_400x400.jpg'), null, 'already large');
  assert.equal(sharpXPicture('https://pbs.twimg.com/media/abc_normal.jpg'), null, 'only profile pictures');
});
