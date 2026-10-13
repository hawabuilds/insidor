/**
 * The coin logo's order: our copy, then the coin's own picture, then the letter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { logoGradient, logoLetter, logoSources } from './coin-logo.ts';

const A = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

test('★ our copy first, built from the address; then the coin\'s own picture', () => {
  assert.deepEqual(logoSources(A, 'https://gw.example/ipfs/x', 'https://store.example/coin-logos'), ['https://store.example/coin-logos/' + A, 'https://gw.example/ipfs/x']);
});

test('without storage configured, or without an address, only the coin\'s own picture', () => {
  assert.deepEqual(logoSources(A, 'https://gw.example/ipfs/x', ''), ['https://gw.example/ipfs/x']);
  assert.deepEqual(logoSources(null, null, 'https://store.example'), []);
  assert.deepEqual(logoSources('../etc', null, 'https://store.example'), []);
});

test('the letter is the ticker\'s first, and a coin keeps one colour', () => {
  assert.equal(logoLetter('$wif'), 'W');
  assert.equal(logoLetter(null), '?');
  assert.equal(logoGradient(A), logoGradient(A));
});
