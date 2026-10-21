/**
 * What the token page is told about the chart's pool: the token on its other side (and whether it
 * is a tokenised stock), the dex by name, and its liquidity; and the coin's own name as the market
 * lists it. Pure, against hand-built pools; the route is exercised in routes.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coinOf, pairOf, tokenisedStock } from './market.ts';

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = { address: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: 'https://img.example/mstr.png' };
const SOL = { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', imageUrl: null };
const LAURA_SIDE = { address: LAURA, symbol: 'Laura', name: 'Forever Laura', imageUrl: null };

test('★ Laura on PumpSwap: paired with MSTRx, a stock, with the pool\'s reserve as its liquidity', () => {
  const pair = pairOf({ address: 'Fv44', dex: 'pumpswap', dexName: 'PumpSwap', reserveUsd: 17_471.85, base: LAURA_SIDE, quote: MSTRX }, LAURA);
  assert.deepEqual(pair.token, { address: MSTRX.address, ticker: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: MSTRX.imageUrl, stock: true });
  assert.deepEqual(pair.venue, { name: 'PumpSwap', launchpad: true, url: `https://pump.fun/coin/${LAURA}` });
  assert.deepEqual(pair.liquidityUsd, { v: 17_471.85 });
  assert.deepEqual(coinOf({ address: 'Fv44', dex: 'pumpswap', reserveUsd: 1, base: LAURA_SIDE, quote: MSTRX }, LAURA), { ticker: 'Laura', name: 'Forever Laura' });
});

test('a pool off the launchpad links to the pool on the explorer; a SOL pair is no stock', () => {
  const pair = pairOf({ address: 'Pool9', dex: 'meteora', dexName: 'Meteora', reserveUsd: 195.7, base: LAURA_SIDE, quote: SOL }, LAURA);
  assert.equal(pair.token?.stock, false);
  assert.equal(pair.token?.ticker, 'SOL');
  assert.deepEqual(pair.venue, { name: 'Meteora', launchpad: false, url: 'https://solscan.io/account/Pool9' });
});

test('★ an absent liquidity is a reason, never 0: unreported reserve, and a curve\'s reserve is not liquidity', () => {
  assert.deepEqual(pairOf({ address: 'P', dex: 'pumpswap', reserveUsd: null, base: LAURA_SIDE, quote: SOL }, LAURA).liquidityUsd, { v: null, why: 'not_reported' });
  assert.deepEqual(pairOf({ address: 'C', dex: 'pump-fun', reserveUsd: 4_000, base: LAURA_SIDE, quote: SOL }, LAURA).liquidityUsd, { v: null, why: 'not_reported' });
});

test('a pool whose sides were not included pairs the coin with nothing and names it nothing', () => {
  const pool = { address: 'P', dex: 'pumpswap', reserveUsd: 10 };
  assert.equal(pairOf(pool, LAURA).token, null);
  assert.equal(pairOf(pool, LAURA).venue.name, null);
  assert.equal(coinOf(pool, LAURA), null);
  assert.equal(coinOf(null, LAURA), null);
});

test('a tokenised stock is named so in both its name and its symbol', () => {
  assert.equal(tokenisedStock('MSTRx', 'MicroStrategy xStock'), true);
  assert.equal(tokenisedStock('NVDAx', 'NVIDIA xStock'), true);
  assert.equal(tokenisedStock('TSLAon', 'Tesla (Ondo Tokenized)'), true);
  assert.equal(tokenisedStock('XSTOCK', 'xStock'), false, 'a meme named xStock with a plain ticker');
  assert.equal(tokenisedStock('MSTRx', 'Junior USD*'), false);
  assert.equal(tokenisedStock(null, 'MicroStrategy xStock'), false);
  assert.equal(tokenisedStock('SOL', 'Wrapped SOL'), false);
});
