/** Where a visit opens: Back where it was left, a new page at its top, a new tab visit where the tab was. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { noteWindow, savedFor, setHeld, showEntry, startAt } from './entry-scroll.ts';

test('a visit with a kept position opens there, page or tab', () => {
  assert.equal(startAt(840, undefined, false), 840);
  assert.equal(startAt(840, 20, true), 840);
});

test('★ a new visit to a page starts at its top, whatever an earlier visit kept', () => {
  assert.equal(startAt(undefined, 900, false), 0);
});

test('a new visit to a bottom tab opens where that tab was left (the owner, 2026-10-18)', () => {
  assert.equal(startAt(undefined, 1200, true), 1200);
  assert.equal(startAt(undefined, undefined, true), 0);
});

test('★ positions are kept by entry: Back finds the old one, a new entry of the same tab takes the tab\'s', () => {
  assert.equal(showEntry('e1', 'feed'), 0);
  noteWindow(1500);
  assert.equal(showEntry('story', null), 0);
  noteWindow(300);
  /* back to e1 */
  assert.equal(showEntry('e1', 'feed'), 1500);
  /* back to the story entry */
  assert.equal(showEntry('story', null), 300);
  /* a fresh entry for the For You tab (a tab-bar tap) */
  assert.equal(showEntry('e9', 'feed'), 1500);
  /* a fresh visit to a page */
  assert.equal(showEntry('story2', null), 0);
});

test('nothing is noted while a sheet holds the page', () => {
  showEntry('held', null);
  noteWindow(640);
  setHeld(true);
  noteWindow(0);
  setHeld(false);
  assert.equal(savedFor('held'), 640);
});
