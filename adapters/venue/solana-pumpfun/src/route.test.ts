/**
 * The route rule the trade service and the market reader share: an open curve never asks the
 * aggregator, and only the aggregator's "no route" says a coin cannot be traded.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { PublicKey } from '@solana/web3.js';

import { curveStateOf, routeAfter } from './route.ts';

const never = async (): Promise<unknown> => {
  throw new Error('the aggregator was asked about a coin on its curve');
};

test('an open curve is the curve route, and the aggregator is not asked', async () => {
  assert.equal(await routeAfter('open', never), 'curve');
});

test('a finished or absent curve with a route is the pool route', async () => {
  assert.equal(await routeAfter('complete', async () => ({})), 'pool');
  assert.equal(await routeAfter('none', async () => ({})), 'pool');
});

test('"no route" is none; any other failure is unavailable, not a fact about the coin', async () => {
  assert.equal(await routeAfter('complete', async () => { throw new Error('quote: no route'); }), 'none');
  assert.equal(await routeAfter('none', async () => { throw new Error('rate limited; try again in a moment'); }), 'unavailable');
  assert.equal(await routeAfter('none', async () => { throw new Error('request failed: timeout'); }), 'unavailable');
});

/* Measured 23 Oct 2026: 2Nyb…pump's curve, open, priced in this tokenised stock. */
const STOCK = new PublicKey('TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo');
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');

test('★ a curve priced in SOL is open; one priced in another token is paired; a finished one is complete', () => {
  assert.equal(curveStateOf({ complete: false }), 'open', 'the older layout carries no quote mint and was SOL only');
  assert.equal(curveStateOf({ complete: false, quoteMint: PublicKey.default }), 'open', 'the zero key is how the program marks SOL');
  assert.equal(curveStateOf({ complete: false, quoteMint: WSOL }), 'open');
  assert.equal(curveStateOf({ complete: false, quoteMint: STOCK }), 'paired');
  assert.equal(curveStateOf({ complete: true, quoteMint: STOCK }), 'complete');
});

test('★ a stock-pair curve is never the curve route: the aggregator is asked, and only its "no route" is none', async () => {
  assert.equal(await routeAfter('paired', async () => ({})), 'pool');
  assert.equal(await routeAfter('paired', async () => { throw new Error('quote: no route'); }), 'none');
  assert.equal(await routeAfter('paired', async () => { throw new Error('rate limited'); }), 'unavailable');
});
