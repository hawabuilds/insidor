/**
 * Curve arithmetic and the itemised cost of a trade. The costs matter as much
 * as the maths: measured all-in cost ranged 1.60% to 22.72% across three
 * same-age mints, so a confirm sheet that renders a fixed percentage is lying.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { allInBps, ATA_RENT_LAMPORTS, buyOut, itemiseCosts, priceImpactBps, VENUE_FEE_BPS, withSlippage } from './curve.ts';

const V_SOL = 30_000_000_000n; // 30 SOL virtual
const V_TOK = 1_073_000_000_000_000n; // ~1.073B tokens at 6 decimals
const ONE_SOL = 1_000_000_000n;

test('a buy walks the constant product and never returns more than the reserve', () => {
  const out = buyOut(V_SOL, V_TOK, ONE_SOL);
  assert.ok(out > 0n);
  assert.ok(out < V_TOK);
  // k is preserved under floor division to within one unit.
  const k = V_SOL * V_TOK;
  assert.ok((V_SOL + ONE_SOL) * (V_TOK - out) >= k - (V_SOL + ONE_SOL));
});

test('a bigger buy gets a worse price — that is what price impact means', () => {
  const small = buyOut(V_SOL, V_TOK, ONE_SOL);
  const large = buyOut(V_SOL, V_TOK, ONE_SOL * 10n);
  assert.ok(large < small * 10n);
  assert.ok(priceImpactBps(V_SOL, V_TOK, ONE_SOL * 10n, large) > priceImpactBps(V_SOL, V_TOK, ONE_SOL, small));
});

test('everything is bigint, because a token with 18 decimals exceeds 2^53', () => {
  const out = buyOut(V_SOL, V_TOK, ONE_SOL);
  assert.equal(typeof out, 'bigint');
  assert.equal(typeof withSlippage(out, 100), 'bigint');
});

test('the minimum out is below the expected out by exactly the slippage', () => {
  const out = 1_000_000n;
  assert.equal(withSlippage(out, 100), 990_000n);
  assert.equal(withSlippage(out, 0), out);
});

test('costs are itemised, and rent is refundable per cost rather than per quote', () => {
  const costs = itemiseCosts({
    baseIn: ONE_SOL,
    priceImpactBps: 250,
    networkLamports: 5_000n,
    priorityLamports: 200_000n,
    needsTokenAccount: true,
    platformFeeBps: 50,
    baseUsd: 180,
  });

  const codes = costs.map((c) => c.code);
  assert.deepEqual(codes, ['network', 'priority', 'venue', 'price-impact', 'platform', 'rent']);

  const rent = costs.find((c) => c.code === 'rent');
  assert.equal(rent?.refundable, true);
  assert.equal(costs.filter((c) => c.refundable).length, 1);

  const venue = costs.find((c) => c.code === 'venue');
  assert.equal(venue?.bps, VENUE_FEE_BPS);
  assert.ok((rent?.amountUsd ?? 0) > 0);
  assert.equal(ATA_RENT_LAMPORTS > 0n, true);
});

test('with no price for the base asset the USD column is null, not zero', () => {
  const costs = itemiseCosts({
    baseIn: ONE_SOL,
    priceImpactBps: 10,
    networkLamports: 5_000n,
    priorityLamports: 0n,
    needsTokenAccount: false,
    platformFeeBps: 50,
    baseUsd: null,
  });
  assert.ok(costs.every((c) => c.amountUsd === null));
  assert.ok(costs.every((c) => c.bps !== null));
});

test('all-in is the sum of the itemised bps, refundable ones included', () => {
  const costs = itemiseCosts({
    baseIn: ONE_SOL,
    priceImpactBps: 250,
    networkLamports: 5_000n,
    priorityLamports: 200_000n,
    needsTokenAccount: false,
    platformFeeBps: 50,
    baseUsd: 180,
  });
  const expected = costs.reduce((s, c) => s + (c.bps ?? 0), 0);
  assert.equal(allInBps(costs), expected);
  assert.ok(allInBps(costs) >= VENUE_FEE_BPS + 250 + 50);
});
