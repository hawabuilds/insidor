/** Back finds the page it left; a new visit never gets an old one. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { arrive, type KeptPage } from './kept-pages.ts';

const p = (id: string, at: number, href = `#/story/${id}`): KeptPage<string> => ({ id, at, route: href, href });

test('a page opened from a tab is kept; a deeper page joins it', () => {
  let s = arrive<string>([], p('a', 1), true);
  s = arrive(s, p('c', 2, '#/story/a/coin/x'), true);
  assert.deepEqual(s.map((x) => x.id), ['a', 'c']);
});

test('★ back onto a kept page finds the very same page, and drops the one we left', () => {
  const a = p('a', 1);
  const c = p('c', 2, '#/story/a/coin/x');
  const s = arrive(arrive(arrive<string>([], a, true), c, true), { ...a }, true);
  assert.equal(s.length, 1);
  assert.equal(s[0], a);
});

test('back to the tab under them drops every page ahead of it', () => {
  const s = arrive(arrive(arrive<string>([], p('a', 1), true), p('c', 2), true), p('tab', 0, '#/narratives'), false);
  assert.deepEqual(s, []);
});

test('★ a new tap on the same narrative is a new entry: it is not handed the old page', () => {
  /* tab(0) → a(1) → back to tab(0) → the same narrative again: a new id at depth 1 */
  let s = arrive<string>([], p('a', 1), true);
  s = arrive(s, p('tab', 0, '#/narratives'), false);
  s = arrive(s, p('a2', 1, '#/story/a'), true);
  assert.deepEqual(s.map((x) => x.id), ['a2']);
});

test('a tab tapped from a page keeps the pages behind it, so Back still finds them', () => {
  let s = arrive<string>([], p('a', 1), true);
  const c = p('c', 2);
  s = arrive(s, c, true);
  s = arrive(s, p('tab', 3, '#/'), false);
  assert.deepEqual(s.map((x) => x.id), ['a', 'c']);
  s = arrive(s, p('c', 2), true);
  assert.deepEqual(s.map((x) => x.id), ['a', 'c']);
  assert.equal(s[1], c);
});

test('an entry replaced in place (same depth, new id) drops the page it replaced', () => {
  const s = arrive(arrive<string>([], p('a', 1), true), p('b', 1, '#/u/x'), true);
  assert.deepEqual(s.map((x) => x.id), ['b']);
});

test('the same entry rewritten in place keeps its place, with the new address', () => {
  /* #/feed/settings becomes #/feed/notifications the moment it opens (NotificationsScreen.tsx). */
  const s = arrive(arrive<string>([], p('a', 1, '#/feed/settings'), true), p('a', 1, '#/feed/notifications'), true);
  assert.equal(s.length, 1);
  assert.equal(s[0]?.id, 'a');
  assert.equal(s[0]?.href, '#/feed/notifications');
});

test('a very deep walk keeps only the newest pages', () => {
  let s: readonly KeptPage<string>[] = [];
  for (let i = 1; i <= 12; i += 1) s = arrive(s, p(`e${i}`, i), true, 8);
  assert.equal(s.length, 8);
  assert.equal(s[0]?.id, 'e5');
  assert.equal(s[7]?.id, 'e12');
});

test('nothing changed: the same array back, so the shell does not redraw', () => {
  const s = arrive<string>([], p('a', 1), true);
  assert.equal(arrive(s, p('a', 1), true), s);
  const t = arrive<string>([], p('tab', 0, '#/'), false);
  assert.equal(arrive(t, p('tab', 0, '#/'), false), t);
});
