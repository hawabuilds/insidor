/** A holding alerts at the highest multiple of its buy price crossed, once, and never without a buy history or under the size floor. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { holdingLevel } from './market.ts';

const P = DEFAULT_POLICY.notify;
const quote = (priceSol: number, priceUsd: number) => ({ ticker: 'FERRY', priceSol, priceUsd });

test('a holding at 6x its buy price alerts at 5x with its value; spent levels do not fire again', () => {
  const hit = holdingLevel({ held: 1_000_000, costSol: 1e-6, quote: quote(6e-6, 0.001), multiples: [2, 5, 10], spent: [] }, P);
  assert.deepEqual(hit, { level: 5, facts: { symbol: 'FERRY', multiple: 5, positionUsd: 1_000 } });
  assert.equal(holdingLevel({ held: 1_000_000, costSol: 1e-6, quote: quote(6e-6, 0.001), multiples: [2, 5, 10], spent: [2, 5] }, P), null);
});

test('no buy history, no price, or a position under the floor: no alert', () => {
  assert.equal(holdingLevel({ held: 1, costSol: undefined, quote: quote(1, 1), multiples: [2], spent: [] }, P), null, 'no buys seen: a dash on screen, silence here');
  assert.equal(holdingLevel({ held: 1, costSol: 0.1, quote: { ticker: 'X', priceSol: null, priceUsd: null }, multiples: [2], spent: [] }, P), null);
  assert.equal(holdingLevel({ held: 1, costSol: 1e-6, quote: quote(1e-5, 1), multiples: [2], spent: [] }, P), null, '$1 is under the $10 floor');
});
