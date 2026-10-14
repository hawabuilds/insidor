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

const LIMITS = { maxBuyLamports: '50000000', defaultSlippageBps: 300, maxSlippageBps: 1500, feeBps: 0 };

test('★ no buy preset the gate would refuse: the last is the largest buy at this slippage', async () => {
  const { buyPresets, largestBuy } = await import('./order-flow.ts');
  const presets = buyPresets(LIMITS, 300);
  assert.deepEqual(presets.map((p) => p.label), ['0.01 SOL', '0.025 SOL', 'Max']);
  const max = presets[presets.length - 1]?.lamports ?? 0n;
  assert.equal(max, largestBuy(LIMITS, 300));
  assert.ok(max + (max * 300n) / 10_000n <= 50_000_000n, 'the largest, plus its slippage, is within the cap');
  assert.deepEqual(buyPresets(null, 300), [], 'no limits read, no presets: the amount is typed');
});

test('★ with no cap (null), the ladder\'s top three show and nothing is cut', async () => {
  const { buyPresets, largestBuy } = await import('./order-flow.ts');
  const open = { ...LIMITS, maxBuyLamports: null };
  assert.equal(largestBuy(open, 1000), null);
  assert.deepEqual(buyPresets(open, 1000).map((p) => p.label), ['0.05 SOL', '0.25 SOL', '1 SOL']);
});

test('the amount field keeps digits and one point; shares round down and 100% is the whole balance', async () => {
  const { impactLevel, sanitizeAmount, shareOf } = await import('./order-flow.ts');
  assert.equal(sanitizeAmount('1.2.345678x9', 6), '1.234567');
  assert.equal(shareOf(999n, 50), 499n);
  assert.equal(shareOf(999n, 100), 999n);
  assert.deepEqual([impactLevel(1), impactLevel(3), impactLevel(20), impactLevel(60), impactLevel(null)], ['ok', 'caution', 'warn', 'block', 'ok']);
});
