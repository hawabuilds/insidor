/**
 * Deposits from other chains (deposits.ts): the address asked of Aurora and kept, the refusals
 * turned into reasons, arrivals paired in order, and the key never reaching a log line.
 * Against a fake fetch; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coinsOn, createDeposits, pairArrivals, scaled } from './deposits.ts';
import { handle } from './routes.ts';
import { SILENT } from './log.ts';

const KEY = 'secret-key-123';
const WALLET = 'BH7BLTpRspEgCuFyL41eSXg2R4QtVJTzutzUiMibx6cb';

function fakeFetch(answer: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    const a = answer(url, init);
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const TOKENS = [
  { assetId: 'nep141:tron-usdt.omft.near', blockchain: 'tron', symbol: 'USDT' },
  { assetId: 'nep141:tron.omft.near', blockchain: 'tron', symbol: 'TRX' },
  { assetId: 'nep141:eth.omft.near', blockchain: 'eth', symbol: 'ETH' },
  { assetId: 'nep141:base-usdc.omft.near', blockchain: 'base', symbol: 'USDC' },
  { assetId: 'nep141:sol.omft.near', blockchain: 'sol', symbol: 'SOL' },
];

test('asks Aurora once for a wallet and chain, paying out SOL to that same wallet, and keeps the answer', async () => {
  const { fetch, calls } = fakeFetch((url) => (url.includes('/tokens/') ? { status: 200, body: { asset_stats: [], tokens: TOKENS } } : { status: 200, body: { depositAddress: 'TQx7tronAddr', alreadyExists: false } }));
  const d = createDeposits({ apiKey: KEY, fetch, now: () => 0, log: SILENT, perMinute: 100 });
  const a = await d.address(WALLET, 'tron');
  assert.deepEqual(a, { kind: 'ready', chain: 'tron', address: 'TQx7tronAddr', coins: ['USDT', 'TRX'] });
  const mint = calls.find((c) => c.url.includes('persistent-deposit-address'));
  assert.deepEqual(mint?.body, { recipient: WALLET, sender: WALLET, depositChain: 'tron', destinationChain: 'sol', destinationAsset: 'nep141:sol.omft.near' });
  const before = calls.length;
  assert.deepEqual(await d.address(WALLET, 'tron'), a);
  assert.equal(calls.length, before);
});

test('a key Aurora has not approved is a reason, never an address', async () => {
  const { fetch } = fakeFetch(() => ({ status: 403, body: { message: 'no', statusCode: 403 } }));
  const d = createDeposits({ apiKey: KEY, fetch, now: () => 0, log: SILENT, perMinute: 100 });
  assert.deepEqual(await d.address(WALLET, 'btc'), { kind: 'missing', why: 'not_approved' });
});

test('no key: nothing is asked and both answers say not configured', async () => {
  const { fetch, calls } = fakeFetch(() => ({ status: 200, body: {} }));
  const d = createDeposits({ apiKey: null, fetch, now: () => 0, log: SILENT, perMinute: 100 });
  assert.deepEqual(await d.address(WALLET, 'evm'), { kind: 'missing', why: 'not_configured' });
  assert.deepEqual(await d.arrivals('TQx7tronAddrxxxxxxxxxxx'), { kind: 'missing', why: 'not_configured' });
  assert.equal(calls.length, 0);
});

test('the key never reaches a log line, even when Aurora fails', async () => {
  const lines: string[] = [];
  const log = { info: (m: string, f?: Record<string, unknown>) => { lines.push(m + JSON.stringify(f ?? {})); } };
  const fetch = (async () => { throw new TypeError(`fetch failed for https://intents-api.aurora.dev/api/x/${KEY}`); }) as typeof globalThis.fetch;
  const d = createDeposits({ apiKey: KEY, fetch, now: () => 0, log, perMinute: 100 });
  assert.deepEqual(await d.address(WALLET, 'ton'), { kind: 'missing', why: 'upstream_error' });
  assert.deepEqual(await d.arrivals('TQx7tronAddrxxxxxxxxxxx'), { kind: 'missing', why: 'upstream_error' });
  assert.ok(lines.length > 0);
  for (const l of lines) assert.ok(!l.includes(KEY), l);
});

test('arrivals pair in order: settled ones arrived or failed, the rest still swapping, newest first', () => {
  const sym = (id: string | null) => (id === 'u' ? 'USDT' : null);
  const out = pairArrivals(
    [{ at: 1, assetId: 'u', amount: 50, txHash: 'a' }, { at: 2, assetId: 'u', amount: 20, txHash: 'b' }, { at: 3, assetId: 'u', amount: 5, txHash: 'c' }],
    [{ at: 10, assetId: 'sol', amount: 0.31, txHash: 'x' }],
    [{ at: 11, assetId: 'sol', amount: 0.12, txHash: 'y' }],
    sym,
  );
  assert.deepEqual(out.map((a) => [a.txHash, a.state, a.gotSol, a.sentCoin]), [['c', 'swapping', null, 'USDT'], ['b', 'failed', null, 'USDT'], ['a', 'arrived', 0.31, 'USDT']]);
});

test('amounts scale by their decimals; unreadable parts are null, never 0', () => {
  assert.equal(scaled('50000000', 6), 50);
  assert.equal(scaled('abc', 6), null);
  assert.equal(scaled('5', null), null);
});

test('EVM is one entry covering every EVM chain the token list names', () => {
  assert.deepEqual(coinsOn('evm', TOKENS.map((t) => ({ chain: t.blockchain, symbol: t.symbol }))), ['ETH', 'USDC']);
});

test('a bridged twin like BTC(OMNI) is not named beside the coin itself', () => {
  assert.deepEqual(coinsOn('btc', [{ chain: 'btc', symbol: 'BTC(OMNI)' }, { chain: 'btc', symbol: 'BTC' }]), ['BTC']);
});

test('the routes check the wallet and chain before anything is asked', async () => {
  const d = createDeposits({ apiKey: null, fetch: globalThis.fetch, now: () => 0, log: SILENT, perMinute: 1 });
  const deps = { db: (async () => []) as never, log: SILENT, deposits: d } as never;
  assert.equal((await handle('GET', `/deposit/${WALLET}/address?chain=mars`, deps)).status, 400);
  assert.equal((await handle('GET', `/deposit/not-a-wallet/address?chain=btc`, deps)).status, 404);
  const ok = await handle('GET', `/deposit/${WALLET}/address?chain=btc`, deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { kind: 'missing', why: 'not_configured' });
});
