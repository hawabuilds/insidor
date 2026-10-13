/**
 * The running older coins as the card receives them: dollars and prices, never the bars, never
 * a coin shape a Buy could be built from, and a refused word dropping the coin, not the post.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { olderCoinFacts } from './older-coins.ts';

const ROW = {
  item_id: 'x:2109759454858379456',
  address: '4wg6M8RWGjhmXJcBr2v1G2uum2GZyDFk39Dby4bMpump',
  name: 'The Goliath Expedition',
  ticker: 'KARL',
  launched_at: '2026-05-19T10:13:53Z',
  checked_at: '2026-10-13T04:00:00Z',
  hour_before_usd: '189.27',
  peak_hour_usd: '1578.54',
  price_at_post_usd: '0.0000167',
  price_since_usd: '0.0000125',
};

test('★ the Goliath coin on the wire: its usual hour, its busiest hour since, and its price since, as facts', () => {
  const coin = olderCoinFacts(ROW);
  assert.ok(coin !== null);
  assert.deepEqual(Object.keys(coin).sort(), ['address', 'hourBeforeUsd', 'launchedAt', 'name', 'peakHourUsd', 'priceChangeSincePost', 'readAt', 'ticker']);
  assert.equal(coin.ticker, 'KARL');
  assert.equal(coin.peakHourUsd, 1578.54);
  assert.equal(coin.hourBeforeUsd, 189.27);
  assert.ok(coin.priceChangeSincePost !== null && coin.priceChangeSincePost < -0.2, 'the fall is said, not hidden');
  assert.deepEqual(coin.launchedAt, { at: Date.parse('2026-05-19T10:13:53Z') });
  assert.equal('coinId' in coin || 'priceUsd' in coin, false, 'no coin shape a Buy could be built from');
});

test('no price before the post is an unknown change, never zero', () => {
  assert.equal(olderCoinFacts({ ...ROW, price_at_post_usd: null })?.priceChangeSincePost, null);
});

test('a row with no busiest hour is not said at all', () => {
  assert.equal(olderCoinFacts({ ...ROW, peak_hour_usd: null }), null);
});

test('★ a coin named with a word the wire refuses is dropped, and the post survives it', () => {
  assert.equal(olderCoinFacts({ ...ROW, name: 'dexscreener goliath' }), null);
});
