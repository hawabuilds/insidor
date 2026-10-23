/**
 * The running coins strip's words (running-coins.ts) and its decoding (api/running.ts): the cap in
 * the app's money form, the move with its glyph, and a coin without a number left off, never 0.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { decodeRunningCoins } from './api/running.ts';
import { stripCap, stripMove } from './running-coins.ts';

test('the cap is the app\'s short money', () => {
  assert.equal(stripCap(2_341_753), '$2.34M');
  assert.equal(stripCap(42_780.84), '$43K');
  assert.equal(stripCap(3_394.19), '$3.4K');
  assert.equal(stripCap(10_165_210), '$10M');
});

test('the move carries its glyph; one decimal under ten percent, a comma over a thousand', () => {
  assert.deepEqual(stripMove(5308), { text: '▲5,308%', direction: 'up' });
  assert.deepEqual(stripMove(980.4), { text: '▲980%', direction: 'up' });
  assert.deepEqual(stripMove(-26.21), { text: '▼26%', direction: 'down' });
  assert.deepEqual(stripMove(-0.57), { text: '▼0.6%', direction: 'down' });
  assert.deepEqual(stripMove(9.96), { text: '▲10.0%', direction: 'up' });
});

test('a move that rounds to nothing is flat, with no glyph', () => {
  assert.deepEqual(stripMove(0), { text: '0%', direction: 'flat' });
  assert.deepEqual(stripMove(-0.04), { text: '0%', direction: 'flat' });
});

test('decoding keeps the server\'s order and drops a coin missing a number', () => {
  const coins = decodeRunningCoins({
    coins: [
      { coinId: 'solana:b', address: 'b', ticker: 'B', imageUrl: null, marketCapUsd: 10, change24hPct: -5 },
      { coinId: 'solana:a', address: 'a', ticker: 'A', imageUrl: 'https://x/a.png', marketCapUsd: 20, change24hPct: 5 },
      { coinId: 'solana:c', address: 'c', ticker: 'C', imageUrl: null, marketCapUsd: null, change24hPct: 5 },
      { coinId: 'solana:d', address: 'd', ticker: 'D', imageUrl: null, marketCapUsd: 0, change24hPct: 5 },
      { coinId: 'solana:e', address: 'e', ticker: 'E', imageUrl: null, marketCapUsd: 5 },
      { coinId: 'solana:a', address: 'a', ticker: 'A', imageUrl: null, marketCapUsd: 20, change24hPct: 5 },
    ],
  });
  assert.deepEqual(coins.map((c) => c.address), ['b', 'a']);
  assert.equal(coins[1]?.imageUrl, 'https://x/a.png');
});

test('an answer with no list is no coins', () => {
  assert.deepEqual(decodeRunningCoins({}), []);
  assert.deepEqual(decodeRunningCoins(null), []);
});
