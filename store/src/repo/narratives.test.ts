/**
 * The narrative page queue's turns (`fairTurns`, used by `pagesDue`): the projector writes 25 older
 * pages a frame, and until 2026-10-23 the pages never written always went first — about 115 that
 * the listing rule dropped every frame took every place, and 751 of 957 pages went over an hour
 * unwritten. These hold that neither side can take every place while the other waits.
 *
 * Pure: the two lists are what the two reads return; no database is asked (as the rest of this
 * package's tests).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fairTurns } from './narratives.ts';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('★ never-written pages take at most half the places; the oldest-written get the rest', () => {
  const out = fairTurns(ids('new', 115), ids('old', 900), 25);
  assert.equal(out.length, 25);
  assert.equal(out.filter((x) => x.startsWith('new')).length, 13);
  assert.deepEqual(out.filter((x) => x.startsWith('old')), ids('old', 12), 'the longest since written, in order');
});

test('a side short of its share gives its places to the other', () => {
  assert.deepEqual(fairTurns(ids('new', 3), ids('old', 900), 25), [...ids('new', 3), ...ids('old', 22)]);
  assert.deepEqual(fairTurns(ids('new', 115), ids('old', 4), 25), [...ids('new', 21), ...ids('old', 4)]);
  assert.deepEqual(fairTurns([], [], 25), []);
});
