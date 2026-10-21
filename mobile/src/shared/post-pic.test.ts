/**
 * The post picture's order: our copy at the box's size, then the source's links in the caller's
 * order, then the placeholder; and the copy's path is built only from a real file name.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { linkExpired, postPicBase, postPicFile, postPicSources, storyPictures } from './post-pic.ts';

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

test("★ a narrative's box tries its own picture, then its posts', skipping a signed link past its end", () => {
  const NOW = 1_792_500_000_000;
  const expired = 'https://p16.example/obj/c~cover.jpeg?a=1&x-expires=1792440000&x-signature=s';
  const live = 'https://p16.example/obj/d~cover.jpeg?x-expires=1792600000';
  const tw = 'https://pbs.example/media/b.jpg';
  assert.equal(linkExpired(expired, NOW), true);
  assert.equal(linkExpired(live, NOW), false);
  assert.equal(linkExpired(tw, NOW), false, 'a link naming no end is never judged expired');
  /* The live case of 2026-10-21: the narrative's picture is an expired short-video cover, its posts' pictures load. */
  assert.deepEqual(storyPictures({ url: expired, file: null }, [{ url: null, file: null }, { url: tw, file: null }, { url: expired, file: null }], NOW), [{ url: tw, file: null }]);
  /* Our copy outlives its link: kept, and first. */
  assert.deepEqual(storyPictures({ url: expired, file: FILE }, [{ url: tw, file: null }], NOW), [{ url: null, file: FILE }, { url: tw, file: null }]);
  assert.deepEqual(storyPictures({ url: tw, file: null }, [{ url: tw, file: null }], NOW), [{ url: tw, file: null }], 'the same picture once');
  const many = Array.from({ length: 10 }, (_, i) => ({ url: `${tw}?n=${i}`, file: null }));
  assert.equal(storyPictures({ url: null, file: null }, many, NOW).length, 4, 'a few tries, not one per post');
  assert.deepEqual(storyPictures({ url: null, file: null }, [], NOW), [], 'nothing at all: the placeholder');
});
