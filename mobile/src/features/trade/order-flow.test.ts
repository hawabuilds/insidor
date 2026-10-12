import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { TradeQuote } from '../../shared/api/index.ts';
import { tradingOn } from '../../shared/trading.ts';
import { availability, confirmOrder, fromBase64, fromBaseUnits, toBase64, toBaseUnits } from './order-flow.ts';

const QUOTE: TradeQuote = { venue: 'curve', side: 'buy', inAmount: '10000000', outAmount: '248401937865', bound: '10300000', slippageBps: 300, priceImpactPct: null, sent: { venue: 'curve' } };

test('★ TRADING off means no trade path: no buttons whatever the coin', () => {
  assert.equal(tradingOn({}), false);
  assert.equal(tradingOn({ VITE_TRADING: 'true' }), false);
  for (const v of ['curve', 'pool', 'none', 'unavailable', 'loading'] as const) assert.deepEqual(availability(false, v), { kind: 'off' });
});

test('★ a coin with no liquidity shows no button, only the line', () => {
  assert.deepEqual(availability(true, 'none'), { kind: 'closed', line: "Can't be traded right now" });
  assert.deepEqual(availability(true, 'unavailable'), { kind: 'closed', line: "Trading isn't available just now" });
  assert.deepEqual(availability(true, 'curve'), { kind: 'open' });
  assert.deepEqual(availability(true, 'pool'), { kind: 'open' });
});

test('★ a failed simulation blocks signing: the wallet is never asked', async () => {
  let asked = 0;
  const out = await confirmOrder(QUOTE, {
    build: async () => ({ kind: 'blocked', why: 'This wallet has no SOL yet. Fund it and try again.' }),
    signAndSend: async () => { asked += 1; return { kind: 'sent', ref: 'x' }; },
    decode: fromBase64,
  });
  assert.deepEqual(out, { kind: 'blocked', why: 'This wallet has no SOL yet. Fund it and try again.' });
  assert.equal(asked, 0);
});

test('★ the quote goes to the build exactly as the person saw it', async () => {
  const seen: TradeQuote[] = [];
  const out = await confirmOrder(QUOTE, {
    build: async (q) => { seen.push(q); return { kind: 'ready', transaction: toBase64(new Uint8Array([1, 2, 3])) }; },
    signAndSend: async (bytes) => ({ kind: 'sent', ref: [...bytes].join('') }),
    decode: fromBase64,
  });
  assert.equal(seen[0], QUOTE);
  assert.deepEqual(out, { kind: 'sent', ref: '123' });
});

test('declining in the wallet is the person\'s answer, not an error', async () => {
  const out = await confirmOrder(QUOTE, { build: async () => ({ kind: 'ready', transaction: 'AQ==' }), signAndSend: async () => ({ kind: 'refused' }), decode: fromBase64 });
  assert.deepEqual(out, { kind: 'refused' });
});

test('amounts are exact decimals in base units, never floats', () => {
  assert.equal(toBaseUnits('0.1', 9), 100_000_000n);
  assert.equal(toBaseUnits('0.05', 9), 50_000_000n);
  assert.equal(toBaseUnits('1.0000001', 6), null, 'more places than the coin has');
  assert.equal(toBaseUnits('0', 9), null);
  assert.equal(toBaseUnits('-1', 9), null);
  assert.equal(fromBaseUnits('248401937865', 6), '248401.937865');
  assert.equal(fromBaseUnits('50000000', 9), '0.05');
});
