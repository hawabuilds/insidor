import { test } from 'node:test';
import assert from 'node:assert/strict';

import { caughtEarly, catchStats, entryAndPeak, firstBuys, sightingsFrom } from './catches.ts';

const H = 3_600_000;

test('★ caught early means on For You strictly before the mint, judged on the first frame', () => {
  const held = ['A', 'B', 'C', 'D'];
  const early = caughtEarly(held, [
    { address: 'A', firstShownAt: 100, mintedAt: 200 },
    /* B's first card came after its mint: not a catch, even though a later card is listed too. */
    { address: 'B', firstShownAt: 300, mintedAt: 200 },
    { address: 'B', firstShownAt: 400, mintedAt: 200 },
    /* C's mint is unknown: never called early. */
    { address: 'C', firstShownAt: 100, mintedAt: null },
    /* Same instant is not before. */
    { address: 'D', firstShownAt: 200, mintedAt: 200 },
    /* A coin not held is never listed. */
    { address: 'E', firstShownAt: 1, mintedAt: 2 },
  ]);
  assert.deepEqual(early, ['A']);
});

test('entry is the close of the bucket the buy fell in; the peak is the highest close since, never a wick', () => {
  const candles = [
    { t: 0, c: 1 },
    { t: H, c: 2 },
    { t: 2 * H, c: 9 },
    { t: 3 * H, c: 4 },
  ];
  assert.deepEqual(entryAndPeak(candles, H + 10, H), { entry: 2, peak: 9 });
  /* A buy before the first bucket the market gave has no entry. */
  assert.equal(entryAndPeak([{ t: 5 * H, c: 1 }], 0, H), null);
  /* A buy after the last bucket has none either. */
  assert.equal(entryAndPeak(candles, 10 * H, H), null);
});

test('★ the strip: count, best multiple and hit rate, each a reason when it cannot be said', () => {
  const none = catchStats([]);
  assert.deepEqual(none.caughtEarly, { v: 0 });
  assert.deepEqual(none.bestCatch, { v: null, why: 'none_caught' });
  assert.deepEqual(none.hitRate, { v: null, why: 'none_caught' });

  const s = catchStats([
    { address: 'A', entry: { entry: 1, peak: 164 }, nowUsd: 3, unread: false },
    { address: 'B', entry: { entry: 2, peak: 5 }, nowUsd: 1, unread: false },
    { address: 'C', entry: null, nowUsd: 9, unread: false },
  ]);
  assert.deepEqual(s.caughtEarly, { v: 3 });
  assert.deepEqual(s.bestCatch, { v: 164 });
  /* C has no entry, so it is out of the share: one of two is up. */
  assert.deepEqual(s.hitRate, { v: 0.5 });
  assert.deepEqual(s.early.map((e) => e.multiple), [{ v: 164 }, { v: 2.5 }, { v: null, why: 'no_entry' }]);

  /* Caught early, but none bought here: counted, and the other two say why they are empty. */
  const elsewhere = catchStats([{ address: 'A', entry: null, nowUsd: 1, unread: false }]);
  assert.deepEqual(elsewhere.caughtEarly, { v: 1 });
  assert.deepEqual(elsewhere.bestCatch, { v: null, why: 'no_entry' });
  assert.deepEqual(elsewhere.hitRate, { v: null, why: 'no_entry' });

  /* The market could not be read: said, not zero. */
  const down = catchStats([{ address: 'A', entry: null, nowUsd: 1, unread: true }]);
  assert.deepEqual(down.bestCatch, { v: null, why: 'not_read_yet' });

  /* Every coin down is a real 0, not a missing number. */
  const allDown = catchStats([{ address: 'A', entry: { entry: 2, peak: 3 }, nowUsd: 1, unread: false }]);
  assert.deepEqual(allDown.hitRate, { v: 0 });
});

test('first buys come from buy rows only, the earliest per coin', () => {
  const m = firstBuys([
    { kind: 'buy', mint: 'A', at: '300' },
    { kind: 'buy', mint: 'A', at: '100' },
    { kind: 'sell', mint: 'A', at: '50' },
    { kind: 'buy', mint: 'B', at: 'x' },
  ]);
  assert.deepEqual([...m], [['A', 100]]);
});

test('sightings read from rows, a missing mint kept as unknown', () => {
  assert.deepEqual(sightingsFrom([{ address: 'A', first_shown: '10', minted: null }, { address: null, first_shown: 1, minted: 2 }]), [{ address: 'A', firstShownAt: 10, mintedAt: null }]);
});
