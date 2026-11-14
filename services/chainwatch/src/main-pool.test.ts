import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MainPools, type PoolTrade } from './main-pool.ts';

const SOL = 'So11111111111111111111111111111111111111112';
const T0 = 1_794_620_000_000;
const trade = (over: Partial<PoolTrade> = {}): PoolTrade => ({ coin: 'Jensen', quoteMint: SOL, pool: 'pump-amm', poolAddress: 'Main', poolQuote: 611, priceQuote: 0.0000228, atMs: T0, ...over });

test('a crumb of a pool beside the real one is not the coin (JENSEN, 2026-11-14: 0.015 SOL against 611)', () => {
  const pools = new MainPools();
  assert.equal(pools.admit(trade()), true);
  assert.equal(pools.admit(trade({ pool: 'meteora-damm-v2', poolAddress: 'Crumb', poolQuote: 0.015087, priceQuote: 0.00000708, atMs: T0 + 1_000 })), false);
  assert.equal(pools.admit(trade({ atMs: T0 + 2_000, poolQuote: 612 })), true, 'the real pool still counts');
});

test('two real pools arbitraged together both count', () => {
  const pools = new MainPools();
  assert.equal(pools.admit(trade()), true);
  assert.equal(pools.admit(trade({ pool: 'raydium-cpmm', poolAddress: 'Second', poolQuote: 120, atMs: T0 + 1_000 })), true);
});

test('a shallow pool at the right price is real trading and counts (the many small pools of a busy coin)', () => {
  const pools = new MainPools();
  pools.admit(trade());
  assert.equal(pools.admit(trade({ pool: 'orca-whirlpool', poolAddress: 'Tiny', poolQuote: 3, priceQuote: 0.0000235, atMs: T0 + 1_000 })), true);
  assert.equal(pools.admit(trade({ pool: 'orca-whirlpool', poolAddress: 'Tiny', poolQuote: 3, priceQuote: 0.0000400, atMs: T0 + 2_000 })), false, 'the same pool far off the price does not');
});

test('graduation: the new pool counts from its first trade, and the curve stops shadowing it once quiet', () => {
  const pools = new MainPools();
  assert.equal(pools.admit(trade({ pool: 'pump', poolAddress: 'Curve', poolQuote: 115 })), true);
  assert.equal(pools.admit(trade({ poolAddress: 'Amm', poolQuote: 80, atMs: T0 + 60_000 })), true);
  assert.equal(pools.admit(trade({ poolAddress: 'Amm', poolQuote: 3, priceQuote: 0.0000100, atMs: T0 + 31 * 60_000 })), true, 'a pool drained since: the curve is forgotten, not held against it');
});

test('a trade with no depth given is counted, as before', () => {
  const pools = new MainPools();
  pools.admit(trade());
  assert.equal(pools.admit(trade({ poolAddress: 'Unknown', poolQuote: null, priceQuote: 1e-9 })), true);
  const { poolQuote: _absent, ...noDepth } = trade({ poolAddress: 'Absent', priceQuote: 1e-9 });
  assert.equal(pools.admit(noDepth), true);
  assert.equal(pools.admit(trade({ poolAddress: 'NoPrice', poolQuote: 0.01, priceQuote: null })), true);
});

test('pools are compared within one coin and one quote token', () => {
  const pools = new MainPools();
  pools.admit(trade());
  assert.equal(pools.admit(trade({ coin: 'Other', poolAddress: 'Small', poolQuote: 1, priceQuote: 1e-9 })), true);
  assert.equal(pools.admit(trade({ quoteMint: 'Usdc', poolAddress: 'UsdcPool', poolQuote: 1, priceQuote: 1e-9 })), true);
});
