/**
 * The ordering rules, asserted.
 *
 * Each test is a product decision written down: values move while frozen, order does not,
 * an out-of-order frame is ignored, and a hole in the tick sequence is reported rather than
 * absorbed — the last of which is the reconnect bug from the previous build.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { BoardRow, BoardTick } from '../wire/board.ts';
import { known, instant } from '../../format/measure.ts';
import { createBoardStore } from './boardStore.ts';

function row(id: string, reach: number): BoardRow {
  return {
    id,
    title: id,
    summary: ['one', 'two'],
    thumbUrl: null,
    reach: known(reach),
    spark: { points: [], windowMs: 3_600_000 },
    momentum: 'steady',
    firstSeenAt: instant(1_700_000_000_000),
    coins: { kind: 'none' },
    isNew: false,
  };
}

function tick(n: number, order: readonly string[], rows: readonly BoardRow[]): BoardTick {
  return { tick: n, order, rows };
}

test('order comes from the server and the client never sorts', () => {
  const store = createBoardStore();
  store.tick(tick(1, ['b', 'a'], [row('a', 10), row('b', 5)]));
  assert.deepEqual(store.getOrder(), ['b', 'a']);
});

test('a frozen board holds order but keeps patching values', () => {
  const store = createBoardStore();
  store.tick(tick(1, ['a', 'b'], [row('a', 10), row('b', 5)]));
  store.setFrozen(true);
  store.tick(tick(2, ['b', 'a'], [row('a', 99), row('b', 5)]));

  assert.deepEqual(store.getOrder(), ['a', 'b'], 'order moved under the cursor');
  assert.equal(store.getMeta().pendingCount, 1);

  store.patch({ id: 'a', fields: { reach: known(42) } });
  const a = store.getRow('a');
  assert.ok(a && a.reach.known && a.reach.amount === 42, 'values froze, which would be a lie');
});

test('releasing the freeze applies the newest held frame', () => {
  const store = createBoardStore();
  store.tick(tick(1, ['a', 'b'], [row('a', 1), row('b', 2)]));
  store.setFrozen(true);
  store.tick(tick(2, ['b', 'a'], []));
  store.tick(tick(3, ['a', 'b'], []));
  store.setFrozen(false);
  assert.equal(store.getMeta().tick, 3);
  assert.deepEqual(store.getOrder(), ['a', 'b']);
  assert.equal(store.getMeta().pendingCount, 0);
});

test('an older frame is an echo, not a correction', () => {
  const store = createBoardStore();
  store.tick(tick(5, ['a'], [row('a', 1)]));
  store.tick(tick(4, ['b'], [row('b', 1)]));
  assert.deepEqual(store.getOrder(), ['a']);
});

test('a hole in the tick sequence is reported, because broadcast has no replay', () => {
  const gaps: number[][] = [];
  const store = createBoardStore({ onGap: (expected, saw) => gaps.push([expected, saw]) });
  store.tick(tick(1, ['a'], [row('a', 1)]));
  store.tick(tick(4, ['a'], [row('a', 2)]));
  assert.deepEqual(gaps, [[2, 4]]);
});

test('one row changing notifies one row', () => {
  const store = createBoardStore();
  store.tick(tick(1, ['a', 'b'], [row('a', 1), row('b', 1)]));
  let aHits = 0;
  let bHits = 0;
  store.subscribeRow('a', () => (aHits += 1));
  store.subscribeRow('b', () => (bHits += 1));
  store.patch({ id: 'a', fields: { reach: known(2) } });
  assert.equal(aHits, 1);
  assert.equal(bHits, 0);
});

test('a patch for an unknown row is ignored, not inserted', () => {
  const store = createBoardStore();
  store.tick(tick(1, ['a'], [row('a', 1)]));
  store.patch({ id: 'ghost', fields: { reach: known(9) } });
  assert.equal(store.getRow('ghost'), undefined);
  assert.deepEqual(store.getOrder(), ['a']);
});

test('an authoritative refetch replaces everything, whatever its tick number', () => {
  const store = createBoardStore();
  store.tick(tick(9, ['a'], [row('a', 1)]));
  store.reset(tick(1, ['c'], [row('c', 3)]));
  assert.deepEqual(store.getOrder(), ['c']);
  assert.equal(store.getRow('a'), undefined);
});

test('meta keeps identity when nothing changed, so a snapshot read cannot loop', () => {
  const store = createBoardStore();
  const first = store.getMeta();
  store.setFrozen(false);
  assert.equal(store.getMeta(), first);
});
