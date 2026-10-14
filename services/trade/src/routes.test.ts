/**
 * The trade path's safety, one rule a test: trading off means no path; only allowlisted wallets
 * (or everyone, said as `*`, never as an empty list) and only up to the cap when policy sets one
 * (since 2026-10-15 it sets none: `CAPPED` keeps the cap's mechanism tested); the quote is built as given, never priced again; a failed simulation
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
import { capLamports, handle, LaunchRefusedError, type LaunchPort, type TradeDeps } from './routes.ts';

const P = DEFAULT_POLICY.trade;
/* The caps as they were until 2026-10-15, so the mechanism stays tested while policy sets none. */
const CAPPED = { ...P, maxSolPerTrade: 0.06, maxDevBuySol: 0.05 };
const capOf = (p: typeof P): bigint => {
  const c = capLamports(p);
  assert.ok(c !== null, 'this test needs a cap');
  return c;
};
const ME = 'Me11111111111111111111111111111111111111111';
const STRANGER = 'St11111111111111111111111111111111111111111';
const CURVE_COIN = 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP';
const BONDED_COIN = 'Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump';
const DEAD_COIN = 'Dd11111111111111111111111111111111111111111';

interface LaunchOver { open?: boolean; refuse?: string; creatorFeeBps?: number; rentLamports?: number; landed?: { ok: boolean; payer: string | null; accounts: string[] } | null }

function launchStub(over: LaunchOver, calls: string[], registered: unknown[]): LaunchPort {
  return {
    rules: async () => ({ open: over.open ?? true, creatorFeeBps: over.creatorFeeBps ?? 30, protocolFeeBps: 95 }),
    build: async (r) => {
      calls.push(`launch.build:${r.uri}`);
      if (over.refuse !== undefined) throw new LaunchRefusedError(over.refuse);
      return { transactionBase64: 'LAUNCH_TX', mint: 'Mnt1111111111111111111111111111111111111pump', costs: [{ key: 'network', lamports: 22_500 }, { key: 'rent', lamports: over.rentLamports ?? 5_481_320 }, { key: 'launchpad', lamports: 0 }], totalLamports: 5_503_820, balanceLamports: 1e9, devBuy: null };
    },
    upload: async () => {
      calls.push('launch.upload');
      return { uri: 'https://store/abc.json', image: 'https://store/abc.png' };
    },
    landed: async () => (over.landed === undefined ? { ok: true, payer: ME, accounts: [ME, 'Mnt1111111111111111111111111111111111111pump'] } : over.landed),
    register: async (...args) => { registered.push(args); },
  };
}

function deps(over: { trading?: boolean; allowlist?: string[] | 'everyone'; simulation?: unknown; launch?: LaunchOver; policy?: typeof P } = {}) {
  const registered: unknown[] = [];
  const calls: string[] = [];
  const built: unknown[] = [];
  const d: TradeDeps = {
    cfg: { trading: over.trading ?? true, allowlist: over.allowlist === 'everyone' ? 'everyone' : new Set(over.allowlist ?? [ME]), rpcUrl: 'https://rpc.example' },
    policy: over.policy ?? P,
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
      tokenBalance: async () => ({ amount: '248401937865', decimals: 6 }),
    },
    launch: launchStub(over.launch ?? {}, [], registered),
    transfer: {
      build: async () => {
        calls.push('transfer.build');
        return { transactionBase64: 'SEND_TX', lastValidBlockHeight: 3 };
      },
    },
    payerOf: (tx) => (tx === 'SIGNED_BY_ME' ? ME : STRANGER),
    log: { info: () => undefined, error: () => undefined },
  };
  const withCalls: TradeDeps = { ...d, launch: launchStub(over.launch ?? {}, calls, registered) };
  return { d: withCalls, calls, built, registered };
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

test('★ everyone is the single token "*", and only that', () => {
  assert.equal(loadTradeConfig({ TRADING: 'on', TRADING_ALLOWLIST: '*', HELIUS_API_KEY: 'k' }).allowlist, 'everyone');
  assert.equal(loadTradeConfig({ TRADING: 'on', TRADING_ALLOWLIST: ' * ', HELIUS_API_KEY: 'k' }).allowlist, 'everyone');
  assert.throws(() => loadTradeConfig({ TRADING_ALLOWLIST: `*,${ME}` }), /not wallet addresses/, 'a star mixed with addresses is a mistake, not a wider list');
  assert.throws(() => loadTradeConfig({ TRADING_ALLOWLIST: '**' }), /not wallet addresses/);
  assert.deepEqual(loadTradeConfig({ TRADING_ALLOWLIST: '' }).allowlist, new Set(), 'empty is still nobody');
});

test('★ open to everyone: any wallet gets a quote, a build, a balance, a send, a launch — but only a wallet', async () => {
  const { d, calls } = deps({ allowlist: 'everyone' });
  const q = body(await handle('GET', quoteUrl(CURVE_COIN, '1000', STRANGER), null, d)).quote;
  assert.ok(q, 'a stranger gets a quote');
  assert.equal((await handle('POST', '/build', JSON.stringify({ quote: q, wallet: STRANGER }), d)).status, 200);
  assert.equal(calls.includes('curve.build'), true);
  assert.equal(body(await handle('POST', '/send', JSON.stringify({ transaction: 'SIGNED_BY_STRANGER' }), d)).signature, 'SIG');
  assert.equal((await handle('GET', `/balance?mint=${CURVE_COIN}&wallet=${STRANGER}`, null, d)).status, 200);
  assert.equal(body(await handle('POST', '/transfer', SEND({ wallet: STRANGER, to: ME }), d)).transaction, 'SEND_TX');
  assert.equal((await handle('POST', '/launch/preview', LAUNCH({ wallet: STRANGER }), d)).status, 200);
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000', 'not-a-wallet'), null, d)).refusal, 'not_allowed', 'everyone means every wallet, not any string');
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000', ''), null, d)).refusal, 'not_allowed');
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

test('★ no cap is said as null, and a buy of any size is quoted and built (the simulation still decides)', async () => {
  assert.equal(P.maxSolPerTrade, null);
  assert.equal(P.maxDevBuySol, null);
  assert.equal(capLamports(P), null);
  const { d } = deps();
  const big = (1_000n * 1_000_000_000n).toString();
  const q = body(await handle('GET', quoteUrl(CURVE_COIN, big), null, d)).quote;
  assert.ok(q, 'a 1,000 SOL buy is not refused for its size');
  assert.equal((await handle('POST', '/build', JSON.stringify({ quote: q, wallet: ME }), d)).status, 200);
  assert.equal(body(await handle('GET', `/venue/${CURVE_COIN}`, null, d)).limits.maxBuyLamports, null, 'the app is told there is no cap, not a big number');
  assert.equal(body(await handle('POST', '/transfer', SEND({ amount: big }), d)).transaction, 'SEND_TX');
  assert.equal(body(await handle('GET', '/launch/rules', null, d)).maxDevBuyLamports, null);
  assert.equal((await handle('POST', '/launch/preview', LAUNCH({ devBuyLamports: big }), d)).status, 200);
});

test('★ with no cap a buy the wallet cannot pay for still fails its simulation: nothing to sign', async () => {
  const { d } = deps({ simulation: UNFUNDED_BUY });
  const q = body(await handle('GET', quoteUrl(CURVE_COIN, (1_000n * 1_000_000_000n).toString()), null, d)).quote;
  const r = await handle('POST', '/build', JSON.stringify({ quote: q, wallet: ME }), d);
  assert.equal(r.status, 422);
  assert.equal('transaction' in body(r), false);
});

test('★ with a cap, a buy past it, counting its slippage, is refused — on the quote and again on the build', async () => {
  const { d, calls } = deps({ policy: CAPPED });
  const cap = capOf(CAPPED);
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, cap.toString()), null, d)).refusal, 'over_cap', 'the cap plus slippage is over the cap');
  const under = (cap * 10_000n) / BigInt(10_000 + P.defaultSlippageBps);
  assert.ok(body(await handle('GET', quoteUrl(CURVE_COIN, under.toString()), null, d)).quote);
  /* A quote edited in the browser to spend more is caught at the build. */
  const forged: CurveQuote = { venue: 'curve', side: 'buy', mint: CURVE_COIN, inAmount: (cap * 10n).toString(), outAmount: '1', bound: '1', slippageBps: 300 };
  assert.equal(body(await handle('POST', '/build', JSON.stringify({ quote: forged, wallet: ME }), d)).refusal, 'over_cap');
  assert.equal(calls.includes('curve.build'), false);
  assert.equal(body(await handle('GET', quoteUrl(CURVE_COIN, '1000', ME, 'buy', P.maxSlippageBps + 1), null, d)).refusal, 'bad_slippage', 'slippage is bounded with or without a cap');
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
  assert.deepEqual(body(await handle('GET', `/venue/${CURVE_COIN}`, null, d)).limits, { maxBuyLamports: null, defaultSlippageBps: d.policy.defaultSlippageBps, maxSlippageBps: d.policy.maxSlippageBps, feeBps: d.policy.platformFeeBps }, 'the ticket sizes against the gate\'s own numbers');
  assert.equal(body(await handle('GET', `/venue/${BONDED_COIN}`, null, d)).kind, 'pool');
  assert.equal(body(await handle('GET', `/venue/${DEAD_COIN}`, null, d)).kind, 'none');
  const r = await handle('GET', quoteUrl(DEAD_COIN, '1000'), null, d);
  assert.equal(r.status, 409);
  assert.equal(body(r).error, "This coin can't be traded right now.");
});

test('sells are not capped: they return what the wallet already holds', async () => {
  const { d } = deps({ policy: CAPPED });
  const r = await handle('GET', quoteUrl(CURVE_COIN, (capOf(CAPPED) * 100n).toString(), ME, 'sell'), null, d);
  assert.equal(r.status, 200);
});

test('a balance is read only for an allowlisted wallet', async () => {
  const { d } = deps();
  assert.deepEqual(body(await handle('GET', `/balance?mint=${CURVE_COIN}&wallet=${ME}`, null, d)), { amount: '248401937865', decimals: 6 });
  assert.equal(body(await handle('GET', `/balance?mint=${CURVE_COIN}&wallet=${STRANGER}`, null, d)).refusal, 'not_allowed');
});

const SEND = (over: Record<string, unknown> = {}) => JSON.stringify({ wallet: ME, to: STRANGER, mint: null, amount: '1000000', ...over });

test('★ Send is blocked when TRADING is off: no transfer is built', async () => {
  const { d, calls } = deps({ trading: false });
  const r = await handle('POST', '/transfer', SEND(), d);
  assert.equal(body(r).refusal, 'trading_off');
  assert.deepEqual(calls, []);
});

test('★ a failed simulation blocks Send: the reason, and nothing to sign', async () => {
  const { d } = deps({ simulation: UNFUNDED_BUY });
  const r = await handle('POST', '/transfer', SEND(), d);
  assert.equal(r.status, 422);
  assert.equal(body(r).error, 'This wallet has no SOL yet. Fund it and try again.');
  assert.equal(r.body.includes('SEND_TX'), false);
});

test('Send: only from an allowlisted wallet, a SOL send capped like a buy when buys are, a coin send bounded by what is held', async () => {
  const { d } = deps({ policy: CAPPED });
  assert.equal(body(await handle('POST', '/transfer', SEND({ wallet: STRANGER, to: ME }), d)).refusal, 'not_allowed');
  assert.equal(body(await handle('POST', '/transfer', SEND({ amount: (capOf(CAPPED) + 1n).toString() }), d)).refusal, 'over_cap');
  assert.equal((await handle('POST', '/transfer', SEND({ mint: CURVE_COIN, amount: '999999999999999' }), d)).status, 200);
  assert.equal((await handle('POST', '/transfer', SEND({ to: 'not an address' }), d)).status, 400);
  assert.equal(body(await handle('POST', '/transfer', SEND(), d)).transaction, 'SEND_TX');
});

const LAUNCH = (over: Record<string, unknown> = {}) => JSON.stringify({ wallet: ME, name: 'Jimothy', symbol: '$JIM', devBuyLamports: '0', description: 'a raccoon', imageDataUrl: 'data:image/png;base64,AA==', links: {}, ...over });

test('★ TRADING off means no create path at all', async () => {
  const { d, calls } = deps({ trading: false });
  for (const [m, u] of [['GET', '/launch/rules'], ['POST', '/launch/preview'], ['POST', '/launch/build'], ['POST', '/launch/confirm']] as const) {
    assert.equal(body(await handle(m, u, LAUNCH(), d)).refusal, 'trading_off', u);
  }
  assert.deepEqual(calls, []);
});

test('★ paused launches are refused, before anything is built or stored', async () => {
  const { d, calls } = deps({ launch: { open: false } });
  const r = await handle('POST', '/launch/build', LAUNCH(), d);
  assert.equal(r.status, 409);
  assert.equal(body(r).error, 'pump.fun has new coins paused right now.');
  assert.deepEqual(calls, []);
});

test('★ a dev buy cap, when policy sets one, is enforced', async () => {
  const { d, calls } = deps({ policy: CAPPED });
  assert.equal(body(await handle('GET', '/launch/rules', null, d)).maxDevBuyLamports, '50000000');
  const over = (BigInt(Math.round(CAPPED.maxDevBuySol * 1e9)) + 1n).toString();
  assert.equal(body(await handle('POST', '/launch/preview', LAUNCH({ devBuyLamports: over }), d)).refusal, 'over_cap');
  assert.equal(body(await handle('POST', '/launch/build', LAUNCH({ devBuyLamports: over }), d)).refusal, 'over_cap');
  assert.deepEqual(calls, []);
  assert.equal((await handle('POST', '/launch/preview', LAUNCH({ devBuyLamports: String(BigInt(Math.round(CAPPED.maxDevBuySol * 1e9))) }), d)).status, 200);
});

test('★ a failed simulation blocks signing: the reason, and no transaction', async () => {
  const { d } = deps({ launch: { refuse: 'Not enough SOL in this wallet: it holds 0.0000 SOL.' } });
  const r = await handle('POST', '/launch/build', LAUNCH(), d);
  assert.equal(r.status, 422);
  assert.equal(body(r).error, 'Not enough SOL in this wallet: it holds 0.0000 SOL.');
  assert.equal('transaction' in body(r), false);
});

test('★ fees come from the chain, not constants: the preview passes through what was measured and read', async () => {
  const a = body(await handle('POST', '/launch/preview', LAUNCH(), deps({ launch: { creatorFeeBps: 30, rentLamports: 5_481_320 } }).d));
  const b = body(await handle('POST', '/launch/preview', LAUNCH(), deps({ launch: { creatorFeeBps: 55, rentLamports: 7_000_000 } }).d));
  assert.equal(a.creatorFeeBps, 30);
  assert.equal(b.creatorFeeBps, 55);
  assert.equal(a.costs[1].lamports, 5_481_320);
  assert.equal(b.costs[1].lamports, 7_000_000);
  assert.equal('transaction' in a, false, 'a preview is numbers only');
});

test('a build stores the metadata first and builds against it; the preview never stores anything', async () => {
  const { d, calls } = deps();
  await handle('POST', '/launch/preview', LAUNCH(), d);
  assert.deepEqual(calls, ['launch.build:https://insidor.app/launch-preview.json']);
  calls.length = 0;
  const r = body(await handle('POST', '/launch/build', LAUNCH(), d));
  assert.deepEqual(calls, ['launch.upload', 'launch.build:https://store/abc.json']);
  assert.equal(r.transaction, 'LAUNCH_TX');
});

test('★ a coin is recorded as created on Insidor only after its create landed, from this wallet', async () => {
  const sig = '5'.repeat(88);
  const mint = 'Mnt1111111111111111111111111111111111111pump';
  const ok = deps();
  assert.equal(body(await handle('POST', '/launch/confirm', JSON.stringify({ wallet: ME, signature: sig, mint, storyId: 'st_1' }), ok.d)).recorded, true);
  assert.equal(ok.registered.length, 1);
  const stranger = deps({ launch: { landed: { ok: true, payer: STRANGER, accounts: [STRANGER, mint] } } });
  assert.equal((await handle('POST', '/launch/confirm', JSON.stringify({ wallet: ME, signature: sig, mint }), stranger.d)).status, 422);
  const failed = deps({ launch: { landed: { ok: false, payer: ME, accounts: [ME, mint] } } });
  assert.equal((await handle('POST', '/launch/confirm', JSON.stringify({ wallet: ME, signature: sig, mint }), failed.d)).status, 422);
  const notYet = deps({ launch: { landed: null } });
  assert.equal((await handle('POST', '/launch/confirm', JSON.stringify({ wallet: ME, signature: sig, mint }), notYet.d)).status, 409);
  assert.equal(stranger.registered.length + failed.registered.length + notYet.registered.length, 0);
});
