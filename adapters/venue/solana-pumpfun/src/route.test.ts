/**
 * The route rule the trade service and the market reader share: an open curve never asks the
 * aggregator, and only the aggregator's "no route" says a coin cannot be traded.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { routeAfter } from './route.ts';

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
