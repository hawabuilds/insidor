/**
 * The profile's decisions as tests: the Follow button's three states, the mutuals line, the stats
 * strip from a wallet's catches (decoded as the service sends them), the move under the total, a
 * created coin's age and the six rows before "Show all".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCatches } from '../../shared/api/catches.ts';
import { firstRows, followButton, launchedWords, moveLine, multipleWords, mutualsLine, statCells } from './profile-words.ts';

test('★ the Follow button: Follow, Follow back when they follow you, Following once you do, none on your own', () => {
  assert.deepEqual(followButton({ isMe: false, iFollow: false, followsMe: false }), { label: 'Follow', solid: true });
  assert.deepEqual(followButton({ isMe: false, iFollow: false, followsMe: true }), { label: 'Follow back', solid: true });
  assert.deepEqual(followButton({ isMe: false, iFollow: true, followsMe: false }), { label: 'Following', solid: false });
  assert.deepEqual(followButton({ isMe: false, iFollow: true, followsMe: true }), { label: 'Following', solid: false });
  assert.equal(followButton({ isMe: true, iFollow: false, followsMe: false }), null);
});

test('the mutuals line counts everyone in common, the pictured ones included', () => {
  const p = (handle: string) => ({ handle, name: null });
  assert.equal(mutualsLine(null), null);
  assert.equal(mutualsLine({ count: 0, people: [] }), null);
  assert.equal(mutualsLine({ count: 1, people: [p('a')] }), 'Followed by @a');
  assert.equal(mutualsLine({ count: 2, people: [p('a'), p('b')] }), 'Followed by @a and @b');
  assert.equal(mutualsLine({ count: 3, people: [p('a'), p('b'), p('c')] }), 'Followed by @a and 2 others');
  assert.equal(mutualsLine({ count: 2, people: [p('a')] }), 'Followed by @a and 1 other');
});

test('★ the stats strip: figures where known, a dash with its reason where not, never a made-up 0', () => {
  const read = decodeCatches({
    kind: 'read',
    caughtEarly: { v: 3 },
    bestCatch: { v: 164.4 },
    hitRate: { v: 0.666 },
    early: [{ address: 'A', multiple: { v: 164.4 } }],
  });
  assert.deepEqual(statCells(read), [
    { label: 'Caught early', value: '3', reason: null },
    { label: 'Best catch', value: '164×', reason: null },
    { label: 'Hit rate', value: '67%', reason: null },
  ]);
  assert.ok(read.kind === 'read' && read.early.has('A'));

  const none = decodeCatches({ kind: 'read', caughtEarly: { v: 0 }, bestCatch: { v: null, why: 'none_caught' }, hitRate: { v: null, why: 'no_entry' }, early: [] });
  assert.deepEqual(statCells(none).map((c) => [c.value, c.reason]), [['0', null], ['—', 'None yet'], ['—', 'Not bought here']]);

  /* Every coin down is a real 0%. */
  const down = decodeCatches({ kind: 'read', caughtEarly: { v: 1 }, bestCatch: { v: 2 }, hitRate: { v: 0 }, early: [] });
  assert.equal(statCells(down)[2]!.value, '0%');

  /* A reason this app does not know reads as not read, never as a number. */
  const odd = decodeCatches({ kind: 'read', caughtEarly: { v: null, why: 'something_new' }, bestCatch: {}, hitRate: null, early: null });
  assert.deepEqual(statCells(odd).map((c) => c.reason), ['Not read yet', 'Not read yet', 'Not read yet']);

  assert.deepEqual(statCells(decodeCatches({ kind: 'unavailable' })).map((c) => c.value), ['—', '—', '—']);
  assert.deepEqual(statCells(read, 'hidden').map((c) => c.reason), ['Hidden', 'Hidden', 'Hidden']);
  assert.deepEqual(statCells(null).map((c) => c.reason), [null, null, null]);
});

test('multiples: whole from ten, one place under', () => {
  assert.equal(multipleWords(164.9), '165×');
  assert.equal(multipleWords(2.56), '2.5×');
  assert.equal(multipleWords(3), '3×');
});

test('the move under the total is dollars only, with its window', () => {
  assert.deepEqual(moveLine([{ value: 100 }, { value: 512.8 }], '1w'), { text: '+$412.80 this week', tone: 'up' });
  assert.deepEqual(moveLine([{ value: 100 }, { value: 90 }], '3m'), { text: '−$10.00 in 3 months', tone: 'down' });
  assert.equal(moveLine([{ value: 1 }], '1d'), null);
  assert.equal(moveLine(null, '1d'), null);
});

test("a created coin's age, and unknown said as such", () => {
  const now = 10 * 86_400_000;
  assert.equal(launchedWords(now - 3 * 86_400_000, now), 'Launched 3d ago');
  assert.equal(launchedWords(now - 5 * 3_600_000, now), 'Launched 5h ago');
  assert.equal(launchedWords(now, now), 'Launched 1m ago');
  assert.equal(launchedWords(null, now), 'Launched on Insidor');
});

test('six rows, then Show all with the rest counted', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(firstRows(rows, false), { rows: [1, 2, 3, 4, 5, 6], more: 2 });
  assert.deepEqual(firstRows(rows, true), { rows, more: 0 });
  assert.deepEqual(firstRows([1, 2], false), { rows: [1, 2], more: 0 });
});
