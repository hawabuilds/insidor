/**
 * The poster picture's order: our copy, then the source's link, then the letter; and the copy's
 * path is built only from a real file name.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { posterPicBase, posterPicFile, posterPicSources } from './poster-pic.ts';

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
