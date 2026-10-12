/**
 * The source, with its fetch replaced by recorded replies: one coin's pool, candles and trades
 * in one call each, kept so a second look costs nothing, and the last good answer served when
 * the vendor refuses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GRADUATED_MINT, OHLCV_5M, POOLS, TRADES } from './__fixtures__/replies.ts';
import { geckoterminal } from './index.ts';

function source(fail = { now: false }) {
  const asked: string[] = [];
  let now = 1_000_000;
  const fetch = (async (url: string) => {
    asked.push(url);
    if (fail.now) return new Response('slow down', { status: 429 });
    const body = url.includes('/tokens/') ? POOLS : url.includes('/ohlcv/') ? OHLCV_5M : TRADES;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const market = geckoterminal({ baseUrl: 'https://gecko.invalid/api/v2', fetch, timeoutMs: 1_000, now: () => now });
  return { market, asked, advance: (ms: number) => (now += ms) };
}

test('★ one coin: its pool, candles (priced as OUR coin) and trades, one call each', async () => {
  const { market, asked } = source();
  const coin = await market.coin(GRADUATED_MINT, '5m');
  assert.equal(coin.pool?.dex, 'pumpswap');
  assert.equal(coin.candles.length, 5);
  assert.equal(asked.length, 3);
  assert.ok(asked.some((u) => u.includes(`/ohlcv/minute?aggregate=5&limit=300&token=${GRADUATED_MINT}`)), 'the candle request names our coin');
});

test('★ a second look inside the keep time costs nothing; a refusal serves the last good answer', async () => {
  const fail = { now: false };
  const { market, asked, advance } = source(fail);
  await market.coin(GRADUATED_MINT, '5m');
  await market.coin(GRADUATED_MINT, '5m');
  assert.equal(asked.length, 3, 'kept');
  advance(60_000);
  fail.now = true;
  const coin = await market.coin(GRADUATED_MINT, '5m');
  assert.equal(coin.candles.length, 5, 'the vendor refused; the last good candles were served');
});
