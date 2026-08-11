/**
 * The alert rule, asserted.
 *
 * The distinction being protected: an UNSURE match is not a mint event. Alerting on "some
 * coin claims your story" trains a user to ignore the alert, and the alert is the product's
 * headline moment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Coin } from '../../shared/api/index.ts';
import { known, instant } from '../../shared/format/measure.ts';
import { createWatchStore } from './watchlist-store.ts';

const COIN: Coin = {
  coinId: 'c_1',
  ticker: 'KANG',
  name: 'Kang',
  address: 'addr',
  venueLabel: 'a launchpad',
  imageUrl: null,
  mintedAt: instant(1_700_000_000_000),
  priceUsd: known(0.0001),
  marketCapUsd: known(100_000),
  marketCapBasis: 'fully-diluted',
  liquidityUsd: known(1_000),
  tradable: true,
};

test('a settled coin on a watched story fires once', () => {
  const store = createWatchStore();
  store.toggle('st_1');
  const first = store.observe('st_1', { kind: 'one', coin: COIN }, 1);
  const second = store.observe('st_1', { kind: 'one', coin: COIN }, 2);
  assert.equal(first?.ticker, 'KANG');
  assert.equal(second, null);
  assert.equal(store.alerts().length, 1);
});

test('an unsure match is not a mint event', () => {
  const store = createWatchStore();
  store.toggle('st_1');
  assert.equal(store.observe('st_1', { kind: 'unsure', candidateCount: 306 }, 1), null);
  assert.equal(store.alerts().length, 0);
});

test('several unsettled coins do not fire either', () => {
  const store = createWatchStore();
  store.toggle('st_1');
  assert.equal(store.observe('st_1', { kind: 'several', coins: [COIN, COIN] }, 1), null);
});

test('an unwatched story never fires', () => {
  const store = createWatchStore();
  assert.equal(store.observe('st_9', { kind: 'one', coin: COIN }, 1), null);
});

test('unwatching clears the alert and re-arms it', () => {
  const store = createWatchStore();
  store.toggle('st_1');
  store.observe('st_1', { kind: 'one', coin: COIN }, 1);
  store.toggle('st_1');
  assert.equal(store.alerts().length, 0);
  store.toggle('st_1');
  assert.notEqual(store.observe('st_1', { kind: 'one', coin: COIN }, 3), null);
});
