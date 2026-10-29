import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeCoinMarket } from '../../shared/api/decode.ts';
import type { MarketPair } from '../../shared/api/index.ts';
import { pairChip, pairFrom, poolLiquidity, shownName, SOL_MINT, venueChip } from './pair-view.ts';

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';

const laura: MarketPair = {
  token: { address: MSTRX, ticker: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: 'https://img.example/mstr.png', stock: true },
  venue: { name: 'PumpSwap', launchpad: true, url: `https://pump.fun/coin/${LAURA}` },
  liquidityUsd: { known: true, amount: 17_471 },
};
const solOnLaunchpad: MarketPair = {
  token: { address: SOL_MINT, ticker: 'SOL', name: 'Wrapped SOL', imageUrl: null, stock: false },
  venue: { name: 'PumpSwap', launchpad: true, url: 'https://pump.fun/coin/X' },
  liquidityUsd: { known: true, amount: 40_000 },
};

test('★ Laura shows MSTRx with a Stock tag, PumpSwap as its venue and its pool\'s liquidity', () => {
  assert.deepEqual(pairChip(laura), { kind: 'token', address: MSTRX, ticker: 'MSTRx', imageUrl: 'https://img.example/mstr.png', stock: true });
  assert.deepEqual(venueChip(laura, 'pump.fun', LAURA), { label: 'PumpSwap', url: `https://pump.fun/coin/${LAURA}` });
  assert.deepEqual(poolLiquidity(laura, { known: false, pending: 'not_reported' }), { known: true, amount: 17_471 });
});

test('★ a SOL-paired coin on the launchpad looks as it did: "SOL" and the launchpad\'s own label', () => {
  assert.deepEqual(pairChip(solOnLaunchpad), { kind: 'sol' });
  assert.deepEqual(venueChip(solOnLaunchpad, 'pump.fun', 'X'), { label: 'pump.fun', url: 'https://pump.fun/coin/X' });
  assert.deepEqual(poolLiquidity(solOnLaunchpad, 'loading'), { known: true, amount: 40_000 }, 'and its liquidity, from the chart\'s pool');
});

test('a SOL pool off the launchpad names its dex and links to the pool', () => {
  const meteora: MarketPair = { ...solOnLaunchpad, venue: { name: 'Meteora', launchpad: false, url: 'https://solscan.io/account/P' } };
  assert.deepEqual(pairChip(meteora), { kind: 'sol' });
  assert.deepEqual(venueChip(meteora, 'pump.fun', 'X'), { label: 'Meteora', url: 'https://solscan.io/account/P' });
});

test('★ before the first read the pair is not claimed, and an unreported depth keeps what the page had, never 0', () => {
  assert.deepEqual(pairChip('unread'), { kind: 'unread' });
  assert.deepEqual(venueChip('unread', 'pump.fun', 'X'), { label: 'pump.fun', url: 'https://pump.fun/coin/X' });
  const shallow: MarketPair = { ...laura, liquidityUsd: { known: false, pending: 'not_reported' } };
  assert.equal(poolLiquidity(shallow, 'loading'), 'loading');
  assert.deepEqual(poolLiquidity(null, { known: false, pending: 'not_reported' }), { known: false, pending: 'not_reported' });
});

test('the pair is kept across timeframes: a loading read does not unknow it, a new read replaces it', () => {
  assert.equal(pairFrom(null, laura), laura);
  assert.equal(pairFrom({ kind: 'unavailable', timeframe: '1m' }, laura), laura);
  assert.equal(pairFrom({ kind: 'read', timeframe: '1m', venue: 'pool', candles: [], chartFrom: null, trades: [], curveProgress: null, pair: null, coin: null }, laura), null);
});

test('the wire: the pair is read whole; a link that is not https is no link; an older reply has no pair', () => {
  const m = decodeCoinMarket({
    kind: 'read', timeframe: '1h', venue: 'pool', candles: [], chartFrom: null, trades: [], curveProgress: null,
    pair: { token: { address: MSTRX, ticker: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: 'http://x', stock: true }, venue: { name: 'PumpSwap', launchpad: true, url: 'javascript:1' }, liquidityUsd: { v: null, why: 'not_reported' } },
    coin: { ticker: 'Laura', name: 'Forever Laura' },
  });
  assert.ok(m.kind === 'read');
  assert.deepEqual(m.pair?.token, { address: MSTRX, ticker: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: null, stock: true });
  assert.equal(m.pair?.venue.url, null);
  assert.deepEqual(m.pair?.liquidityUsd, { known: false, pending: 'not_reported' });
  assert.deepEqual(m.coin, { ticker: 'Laura', name: 'Forever Laura' });
  const old = decodeCoinMarket({ kind: 'read', timeframe: '1h', venue: 'pool', candles: [], chartFrom: null, trades: [], curveProgress: null });
  assert.ok(old.kind === 'read' && old.pair === null && old.coin === null);
});

test('★ the market\'s own name wins over a stale index name: MSTRx, not "Junior USD*"', () => {
  assert.deepEqual(shownName({ ticker: 'MSTRx', name: 'MicroStrategy xStock' }, 'USD*-J', 'Junior USD*'), { ticker: 'MSTRx', name: 'MicroStrategy xStock' });
  assert.deepEqual(shownName({ ticker: 'Laura', name: null }, 'Laura', 'Forever Laura'), { ticker: 'Laura', name: 'Forever Laura' }, 'field by field');
  assert.deepEqual(shownName(null, 'Laura', null), { ticker: 'Laura', name: null }, 'no listing yet: what the page was opened with');
});
