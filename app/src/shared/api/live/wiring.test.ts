/**
 * ★ THE WIRING, END TO END, THROUGH THE CODE APP.TSX ACTUALLY RUNS.
 *
 * channel.test.ts proves the transport calls `onSubscribed` on every ready. boardStore.test.ts
 * proves a hole in the tick sequence reaches `onGap`. Neither proves the thing that was
 * actually broken in the build this replaces, which is the JOIN between them: that a
 * subscribe transition ends in a refetch, and that a missed frame does too.
 *
 * So this test assembles the real channel, the real handlers and the real store, with a fake
 * EventSource and a fake refetch, and drives an outage through them. If somebody makes
 * `onSubscribed` idempotent, or drops the `onGap` wiring, this fails — which is the whole
 * point of `createLiveHandlers` being a function rather than four lines inside a component.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { BoardRow, BoardTick } from '../wire/board.ts';
import { instant, known, pending } from '../../format/measure.ts';
import { createBoardStore } from './boardStore.ts';
import { createLiveChannel, type EventStream } from './channel.ts';
import { createLiveHandlers } from './wiring.ts';

function row(id: string): BoardRow {
  return {
    id,
    title: id,
    summary: ['one', 'two'],
    thumbUrl: null,
    reach: known(10),
    spark: { points: [], windowMs: 3_600_000 },
    momentum: 'steady',
    marketCapUsd: pending('not_minted'),
    priceChange24h: pending('not_minted'),
    firstSeenAt: instant(1_700_000_000_000),
    coins: { kind: 'none' },
    isNew: false,
  };
}

function frame(n: number): BoardTick {
  return { tick: n, order: ['a'], rows: [row('a')], provenance: { kind: 'observed' } };
}

interface Harness {
  emit(type: string, data?: string): void;
  refetches: number;
  store: ReturnType<typeof createBoardStore>;
  close(): void;
}

function harness(): Harness {
  const listeners = new Map<string, Array<(data: string) => void>>();
  const stream: EventStream = {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? [];
      set.push(listener);
      listeners.set(type, set);
    },
    close() {},
  };

  const state = { refetches: 0 };
  /* Exactly App.tsx's arrangement: `onGap` is fixed when the store is created but the refetch
     it should call is not, so it goes through an indirection. */
  const refetch = (): void => {
    state.refetches += 1;
  };
  const store = createBoardStore({ onGap: () => refetch(), now: () => 1_000 });
  const channel = createLiveChannel('/stream/board/default', createLiveHandlers(store, refetch), () => stream);

  return {
    store,
    get refetches() {
      return state.refetches;
    },
    emit: (type, data = '') => {
      for (const l of listeners.get(type) ?? []) l(data);
    },
    close: () => channel.close(),
  };
}

test('★ a subscribe transition triggers an authoritative refetch, every single time', () => {
  const h = harness();
  try {
    h.emit('ready');
    assert.equal(h.refetches, 1);
    assert.equal(h.store.getMeta().link, 'live');

    /* The outage. The socket dies, the transport retries, and the server says ready again. */
    h.emit('error');
    assert.equal(h.store.getMeta().link, 'dropped');
    assert.equal(h.refetches, 1, 'a drop is not a read; the repair belongs to the next subscribe');

    h.emit('ready');
    assert.equal(h.refetches, 2, 'the reconnect resumed without re-reading the board');

    h.emit('hold');
    h.emit('ready');
    assert.equal(h.refetches, 3, 'the server regaining its own feed is also a subscribe');
  } finally {
    h.close();
  }
});

test('★ a hole in the tick sequence triggers a refetch, because the missed frames are gone', () => {
  const h = harness();
  try {
    h.emit('ready');
    assert.equal(h.refetches, 1);

    h.emit('frame', JSON.stringify(frame(1)));
    h.emit('frame', JSON.stringify(frame(2)));
    assert.equal(h.refetches, 1, 'a consecutive frame is not a gap');
    assert.equal(h.store.getMeta().tick, 2);

    /* Frames 3, 4 and 5 were published and this client never saw them. Broadcast has no
       replay, so there is nothing to ask for — the only correct answer is to re-read. */
    h.emit('frame', JSON.stringify(frame(6)));
    assert.equal(h.refetches, 2);
    assert.equal(h.store.getMeta().tick, 6, 'the frame still applies; the refetch corrects what it missed');
  } finally {
    h.close();
  }
});

test('a frame arriving on the channel reaches the board, decoded', () => {
  const h = harness();
  try {
    h.emit('ready');
    h.emit('frame', JSON.stringify(frame(1)));
    assert.deepEqual(h.store.getOrder(), ['a']);
    assert.equal(h.store.getRow('a')?.title, 'a');
  } finally {
    h.close();
  }
});

test('a payload carrying internal vocabulary is fatal here rather than rendered', () => {
  const h = harness();
  try {
    h.emit('ready');
    /* decode.ts asserts over the RAW payload before it picks fields, precisely so that a leak
       is loud at the boundary rather than silently dropped and never fixed at the source. */
    assert.throws(
      () => h.emit('frame', '{"tick":1,"order":["a"],"rows":[{"id":"a","score":0.91}]}'),
      /wire:/,
    );
  } finally {
    h.close();
  }
});
