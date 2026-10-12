/**
 * The trade path's safety, one rule a test: trading off means no path; only allowlisted wallets
 * and only up to the cap; the quote is built as given, never priced again; a failed simulation
 * returns nothing to sign. The venues and the chain are stand-ins; the router's quote and the
 * failed simulation are recorded replies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import { BONDED_QUOTE } from '@insidor/venue-jupiter/__fixtures__/quote.ts';
import { readQuote } from '@insidor/venue-jupiter';
import { UNFUNDED_BUY } from '@insidor/venue-solana-pumpfun/__fixtures__/simulation.ts';
import { readSimulation } from '@insidor/venue-solana-pumpfun';
import type { CurveQuote } from '@insidor/venue-solana-pumpfun/curve-trade.ts';

import { loadTradeConfig } from './config.ts';
import { capLamports, handle, type TradeDeps } from './routes.ts';

const P = DEFAULT_POLICY.trade;
const ME = 'Me11111111111111111111111111111111111111111';
const STRANGER = 'St11111111111111111111111111111111111111111';
const CURVE_COIN = 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP';
const BONDED_COIN = 'Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump';
const DEAD_COIN = 'Dd11111111111111111111111111111111111111111';

function deps(over: { trading?: boolean; allowlist?: string[]; simulation?: unknown } = {}) {
  const calls: string[] = [];
  const built: unknown[] = [];
  const d: TradeDeps = {
    cfg: { trading: over.trading ?? true, allowlist: new Set(over.allowlist ?? [ME]), rpcUrl: 'https://rpc.example' },
    policy: P,
    curve: {
      state: async (mint) => (mint === CURVE_COIN ? 'open' : mint === BONDED_COIN ? 'complete' : 'none'),
      quote: async (r) => {
        calls.push('curve.quote');
        return { venue: 'curve', side: r.side, mint: r.mint, inAmount: r.amount.toString(), outAmount: '248401937865', bound: '10300000', slippageBps: r.slippageBps };
      },
      build: async (q) => {
        calls.push('curve.build');
        built.push(q);
        return { transactionBase64: 'CURVE_TX', lastValidBlockHeight: 1 };
      },
    },
    pool: {
      quote: async (r) => {
        calls.push('pool.quote');
        if (r.outputMint === DEAD_COIN || r.inputMint === DEAD_COIN) throw new Error('jupiter unavailable at GET /swap/v1/quote: no route');
        return readQuote(BONDED_QUOTE);
      },
      build: async (q) => {
        calls.push('pool.build');
        built.push(q);
        return { transactionBase64: 'POOL_TX', lastValidBlockHeight: 2 };
      },
    },
    chain: {
      simulate: async () => (over.simulation === undefined ? { ok: true } : readSimulation(over.simulation)),
      send: async () => {
        calls.push('send');
        return 'SIG';
      },
    },
    payerOf: (tx) => (tx === 'SIGNED_BY_ME' ? ME : STRANGER),
    log: { info: () => undefined, error: () => undefined },
  };
  return { d, calls, built };
}

const body = (r: { body: string }) => JSON.parse(r.body) as Record<string, any>;
const quoteUrl = (mint: string, amount: string, wallet = ME, side = 'buy', slip = P.defaultSlippageBps) =>
  `/quote?mint=${mint}&side=${side}&amount=${amount}&wallet=${wallet}&slippageBps=${slip}`;

test('★ TRADING off means no trade path at all: every route refuses before reading anything', async () => {
  const { d, calls } = deps({ trading: false });
  for (const [m, u] of [['GET', `/venue/${CURVE_COIN}`], ['GET', quoteUrl(CURVE_COIN, '1000')], ['POST', '/build'], ['POST', '/send']] as const) {
    const r = await handle(m, u, '{}', d);
    assert.equal(r.status, 403, u);
    assert.equal(body(r).refusal, 'trading_off');
  }
  assert.deepEqual(calls, [], 'not one venue or chain call');
  assert.equal((await handle('GET', '/health', null, d)).status, 200);
});

test('★ the switch must be exactly "on", the allowlist must name someone, and an RPC must exist', () => {
  assert.equal(loadTradeConfig({ TRADING: 'off', TRADING_ALLOWLIST: ME, HELIUS_API_KEY: 'k' }).trading, false);
  assert.equal(loadTradeConfig({ TRADING: 'true', TRADING_ALLOWLIST: ME, HELIUS_API_KEY: 'k' }).trading, false);
  assert.equal(loadTradeConfig({ TRADING: 'on', TRADING_ALLOWLIST: ME, HELIUS_API_KEY: 'k' }).trading, true);
  assert.throws(() => loadTradeConfig({ TRADING_ALLOWLIST: 'not-a-wallet' }), /not wallet addresses/);
});

test('★ an empty allowlist is nobody, not everybody', async () => {
  const { d } = deps({ allowlist: [] });
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000'), null, d)).refusal, 'trading_off');
});

test('★ only an allowlisted wallet gets a quote, a build or a send', async () => {
  const { d, calls } = deps();
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000', STRANGER), null, d)).refusal, 'not_allowed');
  const q = body(await handle('GET', quoteUrl(CURVE_COIN, '1000'), null, d)).quote;
  assert.equal(body(await handle('POST', '/build', JSON.stringify({ quote: q, wallet: STRANGER }), d)).refusal, 'not_allowed');
  assert.equal(body(await handle('POST', '/send', JSON.stringify({ transaction: 'SIGNED_BY_STRANGER' }), d)).refusal, 'not_allowed');
  assert.equal(calls.includes('curve.build'), false);
  assert.equal(calls.includes('send'), false);
  assert.equal(body(await handle('POST', '/send', JSON.stringify({ transaction: 'SIGNED_BY_ME' }), d)).signature, 'SIG');
});

test('★ a buy past the cap, counting its slippage, is refused — on the quote and again on the build', async () => {
  const { d, calls } = deps();
  const cap = capLamports(P);
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, cap.toString()), null, d)).refusal, 'over_cap', 'the cap plus slippage is over the cap');
  const under = (cap * 10_000n) / BigInt(10_000 + P.defaultSlippageBps);
  assert.ok(body(await handle('GET', quoteUrl(CURVE_COIN, under.toString()), null, d)).quote);
  /* A quote edited in the browser to spend more is caught at the build. */
  const forged: CurveQuote = { venue: 'curve', side: 'buy', mint: CURVE_COIN, inAmount: (cap * 10n).toString(), outAmount: '1', bound: '1', slippageBps: 300 };
  assert.equal(body(await handle('POST', '/build', JSON.stringify({ quote: forged, wallet: ME }), d)).refusal, 'over_cap');
  assert.equal(calls.includes('curve.build'), false);
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000', ME, 'buy', P.maxSlippageBps + 1), null, d)).refusal, 'bad_slippage');
});

test('★ the quote is built exactly as given, and never priced again', async () => {
  const { d, calls, built } = deps();
  const pool = body(await handle('GET', quoteUrl(BONDED_COIN, '10000000'), null, d)).quote;
  calls.length = 0;
  const r = await handle('POST', '/build', JSON.stringify({ quote: pool, wallet: ME }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(calls, ['pool.build'], 'the build path asks for no price');
  assert.deepEqual((built[0] as { raw: unknown }).raw, BONDED_QUOTE, 'the router gets its own reply back, unchanged');

  const curve = body(await handle('GET', quoteUrl(CURVE_COIN, '10000000'), null, d)).quote;
  calls.length = 0;
  await handle('POST', '/build', JSON.stringify({ quote: curve, wallet: ME }), d);
  assert.deepEqual(calls, ['curve.build']);
  assert.deepEqual(built[1], curve);
});

test('★ a pool quote whose shown amounts disagree with the router\'s own reply is refused', async () => {
  const { d, calls } = deps();
  const pool = body(await handle('GET', quoteUrl(BONDED_COIN, '10000000'), null, d)).quote;
  const r = await handle('POST', '/build', JSON.stringify({ quote: { ...pool, outAmount: '999999999999999' }, wallet: ME }), d);
  assert.equal(body(r).refusal, 'quote_tampered');
  assert.equal(calls.includes('pool.build'), false);
});

test('★ a failed simulation blocks signing: the reply says why and carries no transaction', async () => {
  const { d } = deps({ simulation: UNFUNDED_BUY });
  const q = body(await handle('GET', quoteUrl(CURVE_COIN, '10000000'), null, d)).quote;
  const r = await handle('POST', '/build', JSON.stringify({ quote: q, wallet: ME }), d);
  assert.equal(r.status, 422);
  assert.equal(body(r).error, 'This wallet has no SOL yet. Fund it and try again.');
  assert.equal('transaction' in body(r), false);
  assert.equal(r.body.includes('CURVE_TX'), false);
});

test('a coin on its curve trades there, a bonded one through the router, and one with no route says so', async () => {
  const { d } = deps();
  assert.equal(body(await handle('GET', `/venue/${CURVE_COIN}`, null, d)).kind, 'curve');
  assert.equal(body(await handle('GET', `/venue/${BONDED_COIN}`, null, d)).kind, 'pool');
  assert.equal(body(await handle('GET', `/venue/${DEAD_COIN}`, null, d)).kind, 'none');
  const r = await handle('GET', quoteUrl(DEAD_COIN, '1000'), null, d);
  assert.equal(r.status, 409);
  assert.equal(body(r).error, "This coin can't be traded right now.");
});

test('sells are not capped: they return what the wallet already holds', async () => {
  const { d } = deps();
  const r = await handle('GET', quoteUrl(CURVE_COIN, (capLamports(P) * 100n).toString(), ME, 'sell'), null, d);
  assert.equal(r.status, 200);
});
