/** A holding alerts at the highest multiple of its buy price crossed, once, and never without a buy history or under the size floor. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { holdingDown, holdingLevel } from './market.ts';

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

test('★ a holding at half its buy price or under alerts once as down by half; above half, spent, or tiny: nothing', () => {
  const hit = holdingDown({ held: 1_000_000, costSol: 1e-6, quote: quote(4e-7, 0.0001), spent: false }, P);
  assert.equal(hit?.level, 50);
  assert.equal(Math.round(Number(hit?.facts['downPercent'])), 60);
  assert.equal(hit?.facts['positionUsd'], 100);
  assert.equal(holdingDown({ held: 1_000_000, costSol: 1e-6, quote: quote(6e-7, 0.0001), spent: false }, P), null, 'down 40% is not halved');
  assert.equal(holdingDown({ held: 1_000_000, costSol: 1e-6, quote: quote(4e-7, 0.0001), spent: true }, P), null, 'once per coin, ever');
  assert.equal(holdingDown({ held: 1, costSol: 1e-6, quote: quote(4e-7, 1), spent: false }, P), null, 'a dollar position is under the floor');
});
