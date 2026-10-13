/**
 * The older-coin line on a feed card: what it says for one coin and for several, the facts in
 * dollars with a falling price said as falling, and the decoder keeping it apart from the
 * post's own coin.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { decodeRisingPost } from '../../shared/api/decode.ts';
import type { OlderCoin } from '../../shared/api/index.ts';
import { olderCoinId, olderFacts, olderLine } from './older-view.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-13T08:00:00Z');

const KARL: OlderCoin = {
  address: '4wg6M8RWGjhmXJcBr2v1G2uum2GZyDFk39Dby4bMpump',
  name: 'The Goliath Expedition',
  ticker: 'KARL',
  launchedAt: { known: true, at: NOW - 147 * DAY },
  hourBeforeUsd: { known: true, amount: 189.27 },
  peakHourUsd: { known: true, amount: 1578.54 },
  priceChangeSincePost: -0.25,
  readAt: { known: true, at: NOW },
};

const POST = {
  id: 'x:2109759454858379456', sourceLabel: 'X', authorLabel: '@news', permalink: null,
  excerpt: 'Man dies after falling out of the Goliath roller coaster', thumbUrl: null, postedAt: { at: 1_000 }, reach: { v: 60_000 }, readAt: { at: 2_000 },
  spark: { points: [], windowMs: 1_800_000 }, storyId: null, coins: { kind: 'unsure', claimCount: 3 },
};

test('★ the Goliath coin: named as older, its busiest hour and multiple in dollars, the fall said as a fall', () => {
  assert.equal(olderLine([KARL]), 'An older coin, $KARL, is trading more since this post');
  assert.deepEqual(olderFacts(KARL, NOW), ['$1.6K in its busiest hour since', '8x its usual hour', 'Price down 25% since', 'Market open 147d']);
  assert.equal(olderCoinId(KARL), 'solana:4wg6M8RWGjhmXJcBr2v1G2uum2GZyDFk39Dby4bMpump');
});

test('several running coins are counted, and the card opens a list', () => {
  assert.equal(olderLine([KARL, { ...KARL, address: 'b', ticker: null }]), '2 older coins with this name are trading more since this post');
  assert.equal(olderLine([]), null);
});

test('a usual hour of nothing is "No trades the day before", never a multiple of zero; an unknown price says nothing', () => {
  const quiet = { ...KARL, hourBeforeUsd: { known: true as const, amount: 0 }, priceChangeSincePost: null };
  assert.deepEqual(olderFacts(quiet, NOW), ['$1.6K in its busiest hour since', 'No trades the day before', 'Market open 147d']);
});

test('the multiple is rounded down: 9.9 times is "9x", never "10x"', () => {
  assert.equal(olderFacts({ ...KARL, peakHourUsd: { known: true, amount: 990 }, hourBeforeUsd: { known: true, amount: 100 } }, NOW)[1], '9x its usual hour');
});

test('★ decoded beside the coin line and apart from it; a row from before the field has none', () => {
  const post = decodeRisingPost({
    ...POST,
    runningOlder: [{ address: KARL.address, name: KARL.name, ticker: 'KARL', launchedAt: { at: NOW - 147 * DAY }, hourBeforeUsd: 189.27, peakHourUsd: 1578.54, priceChangeSincePost: -0.25, readAt: { at: NOW }, buy: true }],
  });
  assert.equal(post.coins.kind, 'unsure', 'the post\'s own coin line is untouched');
  assert.equal(post.runningOlder.length, 1);
  assert.equal(post.runningOlder[0]?.ticker, 'KARL');
  assert.equal('buy' in (post.runningOlder[0] ?? {}), false, 'an unknown key is dropped');
  assert.deepEqual(post.runningOlder[0]?.peakHourUsd, { known: true, amount: 1578.54 });
  assert.deepEqual(decodeRisingPost(POST).runningOlder, []);
  assert.deepEqual(decodeRisingPost({ ...POST, runningOlder: [{ ...{ address: 'a' }, hourBeforeUsd: null, peakHourUsd: 5_000 }] }).runningOlder[0]?.hourBeforeUsd.known, false);
  assert.throws(() => decodeRisingPost({ ...POST, runningOlder: [{ ticker: 'KARL' }] }), 'an older coin without its address cannot be opened, so it is a shape error');
});
