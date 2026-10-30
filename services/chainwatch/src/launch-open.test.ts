import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { LaunchOpens, OPEN_WINDOW_MS } from './launch-open.ts';

const T0 = 1_800_000_000_000;
const P = DEFAULT_POLICY.launchSignals;
const MINUTE = P.devSellWindowMs;
const buy = (maker: string, atMs: number, usd: number | null = 10, tokens = 1_000_000, sol: number | null = 0.05) => ({ coin: 'C', side: 'buy' as const, maker, usd, sol, tokens, pool: 'pump', atMs });
const sell = (maker: string, atMs: number) => ({ coin: 'C', side: 'sell' as const, maker, usd: 5, sol: 0.02, tokens: 500_000, pool: 'pump', atMs });

test('★ a launch\'s first second: buys, distinct buyers and the creator\'s opening buy, one row when its minute closes', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  o.trade(buy('dev', T0, 400, 100_000_000, 3), T0);
  o.trade(buy('w1', T0 + 100), T0);
  o.trade(buy('w1', T0 + 200), T0);
  o.trade(buy('w2', T0 + OPEN_WINDOW_MS, 10, 5_000_000), T0);
  o.trade(sell('w3', T0 + 300), T0);
  o.trade(buy('late', T0 + OPEN_WINDOW_MS + 1), T0 + 2_000);
  assert.deepEqual(o.take(T0 + 2_000), [], 'the dev\'s minute is still open');
  o.trade(buy('after', T0 + MINUTE + 1), T0 + MINUTE + 1_000);
  assert.deepEqual(o.take(T0 + MINUTE + 1_000), [
    {
      address: 'C',
      launchedAtMs: T0,
      buyers: 3,
      buys: 4,
      devBuyUsd: 400,
      devBuySol: 3,
      pool: 'pump',
      /* dev 100M + w1 1M + 1M inside the block; w2 came after it. */
      blockShare: 102_000_000 / P.supplyTokens,
      firstBuyers: ['dev', 'w1', 'w2'],
      devSold: false,
    },
  ]);
  assert.deepEqual(o.take(T0 + MINUTE + 3_000), [], 'one row a launch');
});

test('★ the dev selling inside the minute is recorded; a sell after it, or by anyone else, is not', () => {
  const sold = new LaunchOpens();
  sold.launched('C', T0, T0);
  sold.trade(buy('dev', T0), T0);
  sold.trade(sell('other', T0 + 5_000), T0 + 5_000);
  sold.trade(sell('dev', T0 + 42_000), T0 + 42_000);
  assert.equal(sold.take(T0 + MINUTE + 20_000)[0]?.devSold, true);

  const held = new LaunchOpens();
  held.launched('C', T0, T0);
  held.trade(buy('dev', T0), T0);
  held.trade(sell('other', T0 + 5_000), T0 + 5_000);
  held.trade(sell('dev', T0 + MINUTE + 1), T0 + MINUTE + 1);
  assert.equal(held.take(T0 + MINUTE + 1)[0]?.devSold, false);
});

test('only the first `firstBuyersKept` buyers are listed, every one is counted', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  for (let i = 0; i < P.firstBuyersKept + 5; i += 1) o.trade(buy(`w${i}`, T0 + i), T0);
  const [row] = o.take(T0 + MINUTE + 20_000);
  assert.equal(row?.buyers, P.firstBuyersKept + 5);
  assert.equal(row?.firstBuyers.length, P.firstBuyersKept);
  assert.equal(row?.firstBuyers[0], 'w0');
});

test('an absence is not a zero: no opening buy is no dev to watch, and no trade is no share', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  o.launched('D', T0, T0);
  o.trade({ ...sell('someone', T0), coin: 'D' }, T0);
  o.trade({ coin: 'OTHER', side: 'buy', maker: 'x', usd: 1, sol: 1, tokens: 1, pool: 'pump', atMs: T0 }, T0);
  const rows = o.take(T0 + MINUTE + 10_000);
  assert.deepEqual(rows.find((r) => r.address === 'C'), { address: 'C', launchedAtMs: T0, buyers: 0, buys: 0, devBuyUsd: null, devBuySol: null, pool: null, blockShare: null, firstBuyers: [], devSold: null });
  const d = rows.find((r) => r.address === 'D');
  assert.equal(d?.devSold, null);
  assert.equal(d?.blockShare, 0);
  assert.equal(rows.length, 2, 'a coin whose launch was not seen is not counted');
});

test('a quote in another token leaves the SOL buy unknown, and a share over the supply is not recorded', () => {
  const o = new LaunchOpens();
  o.launched('C', T0, T0);
  o.trade(buy('dev', T0, 10, P.supplyTokens * 2, null), T0);
  const [row] = o.take(T0 + MINUTE + 10_000);
  assert.equal(row?.devBuySol, null);
  assert.equal(row?.blockShare, null);
});
