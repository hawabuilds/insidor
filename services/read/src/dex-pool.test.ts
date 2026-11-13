/**
 * The pair source's pairs as the market source's pools: its dex ids, its curve, and its rule for
 * which pool is the coin's — on the replies 364 and Ground had on 2026-11-13.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dexPool, poolsFromPairs } from './dex-pool.ts';

const MSFTX = 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX';
const SOL = 'So11111111111111111111111111111111111111112';
const COIN = '6p4ZRmb36ggUCox9R8eJ9Jva22doySgk6QVNrTFnpump';

const pair = (dexId: string, pairAddress: string, liq: number | null, quote: string, labels: string[] = [], vol = 0) => ({
  dexId, pairAddress, labels,
  baseToken: { address: COIN, name: 'Microsoft 364', symbol: '364' },
  quoteToken: { address: quote, name: quote === SOL ? 'Wrapped SOL' : 'Microsoft xStock', symbol: quote === SOL ? 'SOL' : 'MSFTx' },
  ...(liq === null ? {} : { liquidity: { usd: liq } }),
  volume: { h24: vol },
  info: { imageUrl: 'https://cdn.example/364.png' },
});

/* 364: its PumpSwap pool against MSFTx, a few Meteora side pools against SOL, and its old curve. */
const PAIRS_364 = [
  pair('pumpswap', '7a5itSdNU31mZzvvDj8p67MiGJiy5t56nfYnVEqqmfMH', 10268.51, MSFTX, [], 30000),
  pair('meteora', 'GqchWLoJKd8XJ1JkTLDHJPW5KivwBtJDLGyVmGk5jaia', 124.27, SOL, ['DLMM']),
  pair('meteora', '8ZiyouvUpAkzYnN3JiyapdJSZxvDdmM7boLEkpoEhxmh', 539.94, SOL, ['DYN2']),
  pair('pumpfun', '5LHG7fKzd7KPU8WMN229QZa48Q4RwcUp1bFdnmg9AMZc', null, MSFTX),
];

test('★ 364: the coin\'s pool is its PumpSwap pool against MSFTx, in the market source\'s words', async () => {
  const pool = await dexPool(async () => PAIRS_364)(COIN);
  assert.equal(pool?.address, '7a5itSdNU31mZzvvDj8p67MiGJiy5t56nfYnVEqqmfMH');
  assert.equal(pool?.dex, 'pumpswap');
  assert.equal(pool?.dexName, 'PumpSwap');
  assert.equal(pool?.reserveUsd, 10268.51);
  assert.equal(pool?.quote?.symbol, 'MSFTx');
  assert.equal(pool?.base?.imageUrl, 'https://cdn.example/364.png');
});

test('★ a curve is `pump-fun` with its liquidity not reported, so market.ts reads it as on its curve', async () => {
  const pool = await dexPool(async () => [pair('pumpfun', 'Curve1', null, SOL, [], 5000)])(COIN);
  assert.equal(pool?.dex, 'pump-fun');
  assert.equal(pool?.reserveUsd, null);
});

test('one dex id, several kinds of pool: the label decides; an unknown dex passes through unnamed', () => {
  const pools = poolsFromPairs([...PAIRS_364, pair('somedex', 'Pool9', 5, SOL)]);
  assert.deepEqual(pools.map((p) => p.dex), ['pumpswap', 'meteora', 'meteora-damm-v2', 'pump-fun', 'somedex']);
  assert.equal(pools[4]?.dexName, null);
});

test('no pairs, or a reply that is not a list: no pool, never a guessed one', async () => {
  assert.equal(await dexPool(async () => [])(COIN), null);
  assert.equal(await dexPool(async () => ({ pairs: [] }))(COIN), null);
  assert.deepEqual(poolsFromPairs('nonsense'), []);
  assert.deepEqual(poolsFromPairs([{ dexId: 'pumpswap' }]), [], 'a pair with no address is left out');
});
