/**
 * The post picture's order: our copy at the box's size, then the source's links in the caller's
 * order, then the placeholder; and the copy's path is built only from a real file name.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { postPicBase, postPicFile, postPicSources } from './post-pic.ts';

const FILE = '0123456789abcdef0123456789abcdef';
const BASE = 'https://s.example/b/post-pics';
const LINK = 'https://p16.example/obj/c~cover.jpeg?x-expires=1';
const SIZED = 'https://pbs.example/media/a?format=jpg&name=360x360';

test('★ our copy first, then the links as the caller ordered them; the placeholder only when there is nothing', () => {
  assert.deepEqual(postPicSources(FILE, [SIZED, LINK], BASE, 'card'), [`${BASE}/${FILE}`, SIZED, LINK]);
  assert.deepEqual(postPicSources(FILE, [LINK], BASE, 'sheet'), [`${BASE}/sheet/${FILE}`, LINK]);
  assert.deepEqual(postPicSources(null, [LINK], BASE, 'card'), [LINK], 'not copied yet: the link, as before');
  assert.deepEqual(postPicSources(FILE, [LINK], '', 'card'), [LINK], 'no base set: the link, as before');
  assert.deepEqual(postPicSources(null, [], BASE, 'card'), []);
});

test('the base is its own setting, else the coin-logo folder swapped, else none', () => {
  assert.equal(postPicBase('https://s.example/x/', 'https://s.example/b/coin-logos'), 'https://s.example/x');
  assert.equal(postPicBase(undefined, 'https://s.example/b/coin-logos/'), BASE);
  assert.equal(postPicBase('', 'https://elsewhere.example/logos'), '');
  assert.equal(postPicBase(undefined, undefined), '');
});

test('a file name is 32 hex characters and nothing else can become a path', () => {
  assert.equal(postPicFile(FILE), FILE);
  assert.equal(postPicFile('../coin-logos/x'), null);
  assert.equal(postPicFile(42), null);
  assert.deepEqual(postPicSources('../x', [LINK], BASE, 'card'), [LINK]);
});
