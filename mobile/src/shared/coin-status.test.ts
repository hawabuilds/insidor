import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoin, decodeCoinLink } from './api/decode.ts';
import { coinStatus, oneCoinLine, settledCoins } from './coin-status.ts';

const coin = (over: Record<string, unknown> = {}) =>
  decodeCoin({
    coinId: 'c', ticker: 'FERRY', name: 'Ferry', address: 'SAMPLE', venueLabel: 'pump.fun', imageUrl: null,
    mintedAt: { at: null }, priceUsd: { v: 1 }, marketCapUsd: { v: 1 }, marketCapBasis: null,
    liquidityUsd: { v: null }, priceChange24h: { v: null }, tradable: true, ...over,
  });

test('no coin offers to create one', () => {
  assert.deepEqual(coinStatus({ kind: 'none' }), { line: 'No coin yet', action: { kind: 'create' } });
});

test('an unsure match has no button at all, and says why', () => {
  const s = coinStatus({ kind: 'unsure', claimCount: 4 });
  assert.equal(s.action, null);
  assert.match(s.line, /can't tell/);
});

test('one coin is a buy only when the server says it can be traded', () => {
  assert.equal(coinStatus({ kind: 'one', coin: coin() }).action?.kind, 'buy');
  assert.equal(coinStatus({ kind: 'one', coin: coin({ tradable: false }) }).action, null);
});

test('several coins are something to look at, never a buy of one of them', () => {
  const s = coinStatus({ kind: 'several', coins: [coin(), coin({ coinId: 'd' })] });
  assert.deepEqual(s, { line: '2 coins on pump.fun', action: { kind: 'view', count: 2 } });
});

test('an unsure match gives up no coin', () => {
  assert.deepEqual(settledCoins({ kind: 'unsure', claimCount: 9 }), []);
});

test('★ before the name has been searched there is no "No coin yet" and no Create, only a dash', () => {
  const s = coinStatus(decodeCoinLink({ kind: 'pending' }));
  assert.equal(s.action, null);
  assert.match(s.line, /^— /);
  assert.doesNotMatch(s.line, /No coin yet/);
});

test('a post\'s confident coin line: ticker and market cap; an unread cap is left out, never "$0"', () => {
  assert.equal(oneCoinLine(coin({ marketCapUsd: { v: 42_000 } })), '$FERRY, $42K market cap');
  assert.equal(oneCoinLine(coin({ marketCapUsd: { v: null, why: 'no_market' } })), '$FERRY');
  assert.equal(oneCoinLine(coin({ tradable: false })), "$FERRY, $1 market cap, can't be traded yet");
});

test('★ a post that could not be checked says so, with no button: no Create, no guess', () => {
  assert.deepEqual(coinStatus({ kind: 'unchecked' }), { line: "Couldn't check", action: null });
});
