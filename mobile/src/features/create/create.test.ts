import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanTicker, feeRate, presetsWithin, suggestTicker, tickerLine } from './create-form.ts';

test('a short name suggests its last word, a long title its first', () => {
  assert.equal(suggestTicker('Grim Reaper'), 'REAPER');
  assert.equal(suggestTicker('Jimothy'), 'JIMOTHY');
  assert.equal(suggestTicker('Jimothy Heads To DC'), 'JIMOTHY');
});

test('a ticker is capitals and digits, ten at most', () => {
  assert.equal(cleanTicker('$fer-ry 2!'), 'FERRY2');
  assert.equal(cleanTicker('abcdefghijklmnop'), 'ABCDEFGHIJ');
  assert.equal(suggestTicker('  '), '');
});

test('★ the dev buy cap: a preset above it is not offered at all', () => {
  assert.deepEqual(presetsWithin(2_000_000_000n), [0.5, 1, 2]);
  assert.deepEqual(presetsWithin(1_000_000_000n), [0.5, 1]);
  assert.deepEqual(presetsWithin(100_000_000n), []);
});

test('the ticker check speaks only for the coins Insidor has seen, and says when it could not check', () => {
  assert.equal(tickerLine('JIM', 0), "You'd be first: no coin Insidor has seen uses $JIM.");
  assert.equal(tickerLine('JIM', 3), '3 coins Insidor has seen already use $JIM.');
  assert.equal(tickerLine('JIM', 1), '1 coin Insidor has seen already uses $JIM.');
  assert.equal(tickerLine('JIM', null), "Whether $JIM is taken couldn't be checked.");
});

test('★ the creator fee is written from the chain\'s number, never a constant', () => {
  assert.equal(feeRate(30), '0.30% of every trade');
  assert.equal(feeRate(55), '0.55% of every trade');
});

test('★ TRADING off means no create path: the sheet is the Coming soon one', async () => {
  const { tradingOn } = await import('../../shared/trading.ts');
  assert.equal(tradingOn({}), false);
  assert.equal(tradingOn({ VITE_TRADING: 'yes' }), false);
});
