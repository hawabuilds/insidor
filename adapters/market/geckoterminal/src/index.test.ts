/**
 * The source, with its fetch replaced by recorded replies: one coin's pool, candles and trades
 * in one call each, kept so a second look costs nothing, and the last good answer served when
 * the vendor refuses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GRADUATED_MINT, OHLCV_5M, POOLS, TRADES } from './__fixtures__/replies.ts';
import { BASE_URLS, geckoterminal } from './index.ts';

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
  assert.equal(coin.candles?.length, 5);
  assert.equal(asked.length, 3);
  assert.ok(asked.some((u) => u.includes(`/ohlcv/minute?aggregate=5&limit=300&token=${GRADUATED_MINT}`)), 'the candle request names our coin');
});

test('★ candles and trades fail apart: a refusal of one never costs the other', async () => {
  let refuseTrades = false;
  const fetch = (async (url: string) => {
    if (refuseTrades && url.includes('/trades')) return new Response('slow down', { status: 429 });
    const body = url.includes('/tokens/') ? POOLS : url.includes('/ohlcv/') ? OHLCV_5M : TRADES;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  refuseTrades = true;
  const coin = await geckoterminal({ baseUrl: 'https://gecko.invalid', fetch, timeoutMs: 1_000, now: () => 1 }).coin(GRADUATED_MINT, '5m');
  assert.equal(coin.candles?.length, 5);
  assert.equal(coin.trades, null, 'unread, never an empty tape');
});

test('★ it stays under the free limit: past 25 requests a minute, nothing more is sent', async () => {
  let sent = 0;
  const fetch = (async (url: string) => {
    sent += 1;
    return new Response(JSON.stringify(url.includes('/tokens/') ? POOLS : url.includes('/ohlcv/') ? OHLCV_5M : TRADES), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const market = geckoterminal({ baseUrl: 'https://gecko.invalid', fetch, timeoutMs: 1_000, now: () => 1 });
  let heldBack = 0;
  for (let i = 0; i < 30; i++) await market.coin(`Mint${i}`, '5m').catch(() => (heldBack += 1));
  assert.equal(sent, 25);
  assert.ok(heldBack > 0, 'a coin with nothing kept, past the cap, is unavailable rather than sent');
});

test('★ with a key, the same paths go to CoinGecko\'s on-chain API with the key in a header; without one, none is sent', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, headers: init.headers });
    return new Response(JSON.stringify(url.includes('/tokens/') ? POOLS : url.includes('/ohlcv/') ? OHLCV_5M : TRADES), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  await geckoterminal({ plan: 'pro', apiKey: 'cg-key', baseUrl: BASE_URLS.pro, fetch, timeoutMs: 1_000, now: () => 1 }).coin(GRADUATED_MINT, '5m');
  assert.ok(seen[0]?.url.startsWith('https://pro-api.coingecko.com/api/v3/onchain/networks/solana/tokens/'));
  assert.equal(seen[0]?.headers['x-cg-pro-api-key'], 'cg-key');
  seen.length = 0;
  await geckoterminal({ plan: 'pro', apiKey: '', baseUrl: BASE_URLS.free, fetch, timeoutMs: 1_000, now: () => 1 }).coin(GRADUATED_MINT, '5m');
  assert.equal(Object.keys(seen[0]?.headers ?? {}).some((h) => h.startsWith('x-cg')), false, 'a plan with no key is the free API, and sends no key');
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
  assert.equal(coin.candles?.length, 5, 'the vendor refused; the last good candles were served');
});
