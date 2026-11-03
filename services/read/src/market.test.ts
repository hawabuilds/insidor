/**
 * What the token page is told about the chart's pool: the token on its other side (and whether it
 * is a tokenised stock), the dex by name, and its liquidity; and the coin's own name as the market
 * lists it. Pure, against hand-built pools; the route is exercised in routes.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coinOf, pairOf, tokenisedStock } from './market.ts';

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = { address: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: 'https://img.example/mstr.png' };
const SOL = { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', imageUrl: null };
const LAURA_SIDE = { address: LAURA, symbol: 'Laura', name: 'Forever Laura', imageUrl: null };

test('★ Laura on PumpSwap: paired with MSTRx, a stock, with the pool\'s reserve as its liquidity', () => {
  const pair = pairOf({ address: 'Fv44', dex: 'pumpswap', dexName: 'PumpSwap', reserveUsd: 17_471.85, base: LAURA_SIDE, quote: MSTRX }, LAURA);
  assert.deepEqual(pair.token, { address: MSTRX.address, ticker: 'MSTRx', name: 'MicroStrategy xStock', imageUrl: MSTRX.imageUrl, stock: true });
  assert.deepEqual(pair.venue, { name: 'PumpSwap', launchpad: true, url: `https://pump.fun/coin/${LAURA}` });
  assert.deepEqual(pair.liquidityUsd, { v: 17_471.85 });
  assert.deepEqual(coinOf({ address: 'Fv44', dex: 'pumpswap', reserveUsd: 1, base: LAURA_SIDE, quote: MSTRX }, LAURA), { ticker: 'Laura', name: 'Forever Laura' });
});

test('a pool off the launchpad links to the pool on the explorer; a SOL pair is no stock', () => {
  const pair = pairOf({ address: 'Pool9', dex: 'meteora', dexName: 'Meteora', reserveUsd: 195.7, base: LAURA_SIDE, quote: SOL }, LAURA);
  assert.equal(pair.token?.stock, false);
  assert.equal(pair.token?.ticker, 'SOL');
  assert.deepEqual(pair.venue, { name: 'Meteora', launchpad: false, url: 'https://solscan.io/account/Pool9' });
});

test('★ an absent liquidity is a reason, never 0: unreported reserve, and a curve\'s reserve is not liquidity', () => {
  assert.deepEqual(pairOf({ address: 'P', dex: 'pumpswap', reserveUsd: null, base: LAURA_SIDE, quote: SOL }, LAURA).liquidityUsd, { v: null, why: 'not_reported' });
  assert.deepEqual(pairOf({ address: 'C', dex: 'pump-fun', reserveUsd: 4_000, base: LAURA_SIDE, quote: SOL }, LAURA).liquidityUsd, { v: null, why: 'not_reported' });
});

test('a pool whose sides were not included pairs the coin with nothing and names it nothing', () => {
  const pool = { address: 'P', dex: 'pumpswap', reserveUsd: 10 };
  assert.equal(pairOf(pool, LAURA).token, null);
  assert.equal(pairOf(pool, LAURA).venue.name, null);
  assert.equal(coinOf(pool, LAURA), null);
  assert.equal(coinOf(null, LAURA), null);
});

test('a tokenised stock is named so in both its name and its symbol', () => {
  assert.equal(tokenisedStock('MSTRx', 'MicroStrategy xStock'), true);
  assert.equal(tokenisedStock('NVDAx', 'NVIDIA xStock'), true);
  assert.equal(tokenisedStock('TSLAon', 'Tesla (Ondo Tokenized)'), true);
  assert.equal(tokenisedStock('XSTOCK', 'xStock'), false, 'a meme named xStock with a plain ticker');
  assert.equal(tokenisedStock('MSTRx', 'Junior USD*'), false);
  assert.equal(tokenisedStock(null, 'MicroStrategy xStock'), false);
  assert.equal(tokenisedStock('SOL', 'Wrapped SOL'), false);
});

test('★ served from our own data, the reply has the same shape, and the market source is not asked', async () => {
  const NOW = Date.now();
  const { coinMarket, ASSET_SQL } = await import('./market.ts');
  const { CHART_SQL, CANDLES_SQL } = await import('./own-market.ts');
  const db = {
    query: async (sql: string) => {
      if (sql === ASSET_SQL) return [{ chain: 'solana', address: LAURA }];
      if (sql === CHART_SQL) return [{ recorded_from: NOW - 600_000, from_launch: true, pool: 'pump', pool_address: 'curve1', quote_mint: SOL.address, symbol: 'Laura', name: 'Forever Laura', image_uri: null }];
      if (sql === CANDLES_SQL) return [{ t: NOW - 120_000, o: 1, h: 2, l: 0.5, c: 1.5 }];
      throw new Error('unexpected');
    },
  };
  let asked = 0;
  const trade = { tx: 's1', side: 'buy' as const, tokenAmount: 10, usd: null, priceUsd: 0.1, at: NOW - 1000, maker: 'w1' };
  const r = await coinMarket(`solana:${LAURA}`, '1m', {
    db: db as never,
    log: { info: () => undefined, error: () => undefined } as never,
    market: { coin: async () => { asked += 1; throw new Error('not asked'); }, pool: async () => null },
    curveProgress: async () => 0.42,
    heldTrades: async () => ({ held: true, whole: true, trades: [trade] }),
  });
  assert.equal(asked, 0);
  const body = JSON.parse(r!.body);
  assert.deepEqual(Object.keys(body), ['kind', 'timeframe', 'venue', 'candles', 'chartFrom', 'trades', 'curveProgress', 'pair', 'coin']);
  assert.equal(body.chartFrom, null, 'recorded from launch: the chart says nothing about where it starts');
  assert.equal(body.venue, 'curve');
  assert.deepEqual(body.curveProgress, { v: 0.42 });
  assert.deepEqual(body.trades[0], { tx: 's1', side: 'buy', tokenAmount: { v: 10 }, usd: { v: null, why: 'not_reported' }, priceUsd: { v: 0.1 }, at: { at: NOW - 1000 }, maker: 'w1' });
  assert.deepEqual(body.coin, { ticker: 'Laura', name: 'Forever Laura' });
  assert.equal(body.pair.token.ticker, 'SOL');
});

test('★ an older coin our candles do not cover is drawn by `olderCoins` (the free source), never the paid one', async () => {
  const { coinMarket, ASSET_SQL } = await import('./market.ts');
  const { CHART_SQL } = await import('./own-market.ts');
  const db = {
    query: async (sql: string) => {
      if (sql === ASSET_SQL) return [{ chain: 'solana', address: LAURA }];
      if (sql === CHART_SQL) return [];
      throw new Error('unexpected');
    },
  };
  const asked: string[] = [];
  const reply = { pool: null, candles: [], trades: [] };
  await coinMarket(`solana:${LAURA}`, '1h', {
    db: db as never,
    log: { info: () => undefined, error: () => undefined } as never,
    market: { coin: async () => { asked.push('paid'); return reply as never; }, pool: async () => null },
    olderCoins: { coin: async () => { asked.push('free'); return reply as never; } },
    curveProgress: null,
    heldTrades: async () => ({ held: false, whole: false, trades: [] }),
  });
  assert.deepEqual(asked, ['free']);
});

test('★ an older coin our recording joined mid-life: our chart, labelled where it starts, when the source is slow or fails', async () => {
  const NOW = Date.now();
  const { coinMarket, ASSET_SQL } = await import('./market.ts');
  const { CHART_SQL, CANDLES_SQL } = await import('./own-market.ts');
  const from = NOW - 2 * 3_600_000;
  const db = {
    query: async (sql: string) => {
      if (sql === ASSET_SQL) return [{ chain: 'solana', address: LAURA }];
      if (sql === CHART_SQL) return [{ recorded_from: from, from_launch: false, pool: 'pump-amm', pool_address: 'pool1', quote_mint: SOL.address, symbol: 'Laura', name: 'Forever Laura', image_uri: null }];
      if (sql === CANDLES_SQL) return [{ t: NOW - 120_000, o: 1, h: 2, l: 0.5, c: 1.5 }];
      throw new Error('unexpected');
    },
  };
  const trade = { tx: 's1', side: 'buy' as const, tokenAmount: 10, usd: null, priceUsd: 0.1, at: NOW - 1000, maker: 'w1' };
  const r = await coinMarket(`solana:${LAURA}`, '1D', {
    db: db as never,
    log: { info: () => undefined, error: () => undefined } as never,
    market: { coin: async () => { throw new Error('refused'); }, pool: async () => null },
    curveProgress: null,
    heldTrades: async () => ({ held: true, whole: false, trades: [trade] }),
  });
  const body = JSON.parse(r!.body);
  assert.equal(body.kind, 'read');
  assert.ok(body.candles.length > 0);
  assert.deepEqual(body.chartFrom, { at: from });
  assert.equal(body.trades.length, 1, 'the latest trades we hold, though not the whole list');
});

/* ★ A COIN SECONDS OLD (2026-11-03): no source names its pool, so its own curve does. */
const freshCoin = async (curve: { address: string; progress: number; complete: boolean; untouched: boolean } | null, sourceReply: unknown = { pool: null, candles: null, trades: null }) => {
  const { coinMarket, ASSET_SQL } = await import('./market.ts');
  const { CHART_SQL } = await import('./own-market.ts');
  const db = { query: async (sql: string) => (sql === ASSET_SQL ? [{ chain: 'solana', address: LAURA }] : sql === CHART_SQL ? [] : []) };
  const asked: string[] = [];
  const r = await coinMarket(`solana:${LAURA}`, '1m', {
    db: db as never,
    log: { info: () => undefined, error: () => undefined } as never,
    market: { coin: async () => sourceReply as never, pool: async () => null },
    curveProgress: async () => curve?.progress ?? null,
    curveOfMint: async (mint) => { asked.push(mint); return curve; },
    heldTrades: async () => ({ held: false, whole: false, trades: [] }),
  });
  return { body: JSON.parse((r as { body: string }).body), asked };
};

test('★ a curve never bought from: on the curve at 0%, and no trades is a fact (an empty chart and tape, not "could not be read")', async () => {
  const { body, asked } = await freshCoin({ address: 'Curve1', progress: 0, complete: false, untouched: true });
  assert.deepEqual(asked, [LAURA]);
  assert.equal(body.venue, 'curve');
  assert.deepEqual(body.candles, []);
  assert.deepEqual(body.trades, []);
  assert.deepEqual(body.curveProgress, { v: 0 });
  assert.equal(body.pair.venue.launchpad, true);
});

test('★ a curve that was bought from, with nothing held: on the curve, but its chart and tape stay "could not be read"', async () => {
  const { body } = await freshCoin({ address: 'Curve1', progress: 0.02, complete: false, untouched: false });
  assert.equal(body.venue, 'curve');
  assert.equal(body.candles, null);
  assert.equal(body.trades, null);
});

test('a coin whose pool a source named is never read from its curve, and a finished curve names no pool', async () => {
  const named = await freshCoin({ address: 'Curve1', progress: 0, complete: false, untouched: true }, { pool: { address: 'Pool9', dex: 'pumpswap', dexName: 'PumpSwap', reserveUsd: 10, base: { address: LAURA, symbol: null, name: null, imageUrl: null }, quote: SOL }, candles: [], trades: [] });
  assert.deepEqual(named.asked, []);
  assert.equal(named.body.venue, 'pool');
  const done = await freshCoin({ address: 'Curve1', progress: 1, complete: true, untouched: false });
  assert.equal(done.body.venue, null);
});
