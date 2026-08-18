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
import { known, instant, pending } from '../../format/measure.ts';
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
    /* `coins` is 'none' here, so the honest cap is the matching absence. A stub row that
       claimed a number no coin backs would let a test pass over a rule it is not testing. */
    marketCapUsd: pending('not_minted'),
    /* And the same absence for the gain, for the same reason: both are derived from
       `coins`, so a stub that gave one a number and the other a dash would be a shape
       the projector cannot produce. */
    priceChange24h: pending('not_minted'),
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

/* ── the live channel's state, as the status line reads it ─────────────────
   Three states rather than a boolean, because "not connected" covers two situations that
   must never render the same: a board with no transport behind it, and a board whose
   transport died. The second is the one that looks exactly like a quiet market. */

test('a board with no transport is idle, not dropped', () => {
  const store = createBoardStore({ now: () => 500 });
  assert.equal(store.getMeta().link, 'idle');

  /* App.tsx calls this when there is no channel to open at all — sample data, or an
     environment with no EventSource. Nothing was ever subscribed, so nothing was lost. */
  store.setConnected(false);
  assert.equal(store.getMeta().link, 'idle', 'a board that never streamed reported a lost connection');
  assert.equal(store.getMeta().linkChangedAt, 0);
});

test('★ a channel that was live and stopped is DROPPED, and says when', () => {
  let clock = 1_000;
  const store = createBoardStore({ now: () => clock });

  store.setConnected(true);
  assert.equal(store.getMeta().link, 'live');
  assert.equal(store.getMeta().linkChangedAt, 1_000);

  clock = 4_000;
  store.setConnected(false);
  assert.equal(store.getMeta().link, 'dropped');
  /* The stamp is what lets the status line separate "reconnecting" from "this board has
     stopped updating" without the store having to hold an opinion about how long is too long. */
  assert.equal(store.getMeta().linkChangedAt, 4_000);
});

test('a repeated report is not a transition, so the stamp does not creep', () => {
  let clock = 1_000;
  const store = createBoardStore({ now: () => clock });
  store.setConnected(true);
  clock = 2_000;
  store.setConnected(true);
  assert.equal(store.getMeta().linkChangedAt, 1_000, 'a re-subscribe reset the clock on an unchanged state');
});

test('a frame arriving stamps the board freshness, held or not', () => {
  let clock = 10;
  const store = createBoardStore({ now: () => clock });
  assert.equal(store.getMeta().lastFrameAt, null, 'a board with no frame yet has no freshness to claim');

  store.tick(tick(1, ['a'], [row('a', 1)]));
  assert.equal(store.getMeta().lastFrameAt, 10);

  /* Held behind the freeze, and still stamped: the channel DID deliver, and blaming the
     transport for a decision this store made would put "no update in 4m" next to a pill
     saying four updates are waiting. */
  clock = 50;
  store.setFrozen(true);
  store.tick(tick(2, ['a'], []));
  assert.equal(store.getMeta().lastFrameAt, 50);
  assert.equal(store.getMeta().pendingCount, 1);
});

test('★ a refetch that returns the board we already hold is not a frame arriving', () => {
  /* THE FAILURE. `onSubscribed` fires on every subscribe and the caller answers it with an
     authoritative refetch — correctly, because broadcast has no replay. If the projector is
     dead and the channel merely blinked, that refetch comes back with the tick already on
     screen. `reset` forces it through, and stamping the freshness on the way would turn
     "12m ago" into "0s ago" beside a label that says "live", which is precisely the pair of
     claims this readout exists to prevent anyone making. Measured before the fix: ten
     minutes of silence, one reconnect, and the board claimed it had just moved. */
  let clock = 1_000;
  const store = createBoardStore({ now: () => clock });
  store.setConnected(true);
  store.reset(tick(7, ['a'], [row('a', 1)]));
  assert.equal(store.getMeta().lastFrameAt, 1_000);

  clock = 601_000; /* ten minutes, and the projector has not committed anything. */
  store.setConnected(false);
  store.setConnected(true);
  store.reset(tick(7, ['a'], [row('a', 1)]));

  assert.equal(store.getMeta().lastFrameAt, 1_000, 'the same frame twice is not two frames');
  assert.equal(store.getMeta().tick, 7);

  /* A refetch that DID bring something newer is an arrival, and stamps. */
  clock = 602_000;
  store.reset(tick(8, ['a'], [row('a', 2)]));
  assert.equal(store.getMeta().lastFrameAt, 602_000);
});

test('a frame held behind the freeze is stamped when it arrives, not when it is applied', () => {
  let clock = 10;
  const store = createBoardStore({ now: () => clock });
  store.tick(tick(1, ['a'], [row('a', 1)]));

  clock = 50;
  store.setFrozen(true);
  store.tick(tick(2, ['a'], [row('a', 2)]));
  assert.equal(store.getMeta().lastFrameAt, 50);

  /* Thawing re-applies that same frame. It did not arrive twice, so the instant it arrived
     is the instant it arrived — otherwise a long interaction would make a stale board look
     freshly fed the moment the user let go of it. */
  clock = 9_000;
  store.setFrozen(false);
  assert.equal(store.getMeta().tick, 2);
  assert.equal(store.getMeta().lastFrameAt, 50, 'thawing is not an arrival');
});
