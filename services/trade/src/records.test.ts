/**
 * The trade record's rules, one a test: the signed and unsigned copies of a transaction share a
 * key; a build, a send and a landing each write; a failed simulation is recorded as refused; a
 * record that cannot be written never stops a trade; and a transaction never seen landed is
 * left `sent`, never called failed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';

import { handle, type TradeDeps } from './routes.ts';
import { messageKey, pgRecords, watchSettlement, type BuiltRecord, type TradeRecords } from './records.ts';

const ME = 'Me11111111111111111111111111111111111111111';
const COIN = 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP';
const SIG = '5'.repeat(88);

/** A transaction as bytes: one signature slot, then a message. */
const tx = (signature: number, message: number[]) => Buffer.from([1, ...new Array<number>(64).fill(signature), ...message]).toString('base64');
const UNSIGNED = tx(0, [9, 8, 7, 6]);
const SIGNED = tx(42, [9, 8, 7, 6]);

function recorder() {
  const log: string[] = [];
  const built: BuiltRecord[] = [];
  const records: TradeRecords = {
    built: async (r) => { built.push(r); log.push(`built:${r.kind}:${r.simulatedOk ? 'ok' : 'refused'}`); },
    sent: async (_id, _w, signature, error) => { log.push(signature === null ? `send_fail:${error}` : `sent:${signature}`); },
    settled: async (_id, _s, ok) => { log.push(ok ? 'confirmed' : 'failed'); },
  };
  return { records, log, built };
}

function deps(records: TradeRecords, over: { simulateOk?: boolean; sendThrows?: boolean } = {}): TradeDeps & { settled: string[] } {
  const settled: string[] = [];
  return {
    settled,
    cfg: { trading: true, allowlist: new Set([ME]), rpcUrl: 'https://rpc.example' },
    policy: DEFAULT_POLICY.trade,
    curve: {
      state: async () => 'open',
      quote: async () => { throw new Error('not used'); },
      build: async () => ({ transactionBase64: UNSIGNED, lastValidBlockHeight: 1 }),
    },
    pool: { quote: async () => { throw new Error('no route'); }, build: async () => { throw new Error('not used'); } },
    chain: {
      simulate: async () => (over.simulateOk === false ? { ok: false, message: 'insufficient funds', logs: [] } : { ok: true }),
      send: async () => { if (over.sendThrows === true) throw new Error('blockhash not found'); return SIG; },
      tokenBalance: async () => ({ amount: '0', decimals: 6 }),
    },
    transfer: { build: async () => ({ transactionBase64: UNSIGNED, lastValidBlockHeight: 1 }) },
    launch: null,
    payerOf: () => ME,
    records,
    settle: (id, signature) => { settled.push(`${id}:${signature}`); },
    log: { info: () => undefined, error: () => undefined },
  };
}

const QUOTE = { venue: 'curve', side: 'buy', mint: COIN, inAmount: '1000000', outAmount: '248401937865', bound: '1030000', slippageBps: 300 };

test('★ the unsigned and the signed copy of a transaction have one key; something that is not a transaction has none', () => {
  const key = messageKey(UNSIGNED);
  assert.match(key ?? '', /^[0-9a-f]{64}$/);
  assert.equal(messageKey(SIGNED), key);
  assert.notEqual(messageKey(tx(0, [1, 2, 3])), key);
  assert.equal(messageKey('CURVE_TX'), null);
  assert.equal(messageKey(''), null);
});

test('a build is recorded with its quote in base units, and a send with its signature, under the same key', async () => {
  const { records, log, built } = recorder();
  const d = deps(records);
  assert.equal((await handle('POST', '/build', JSON.stringify({ wallet: ME, quote: QUOTE }), d)).status, 200);
  assert.deepEqual(built.map((b) => [b.kind, b.mint, b.inAmount, b.outAmount, b.bound, b.slippageBps, b.venue]), [['buy', COIN, '1000000', '248401937865', '1030000', 300, 'curve']]);
  assert.equal((await handle('POST', '/send', JSON.stringify({ transaction: SIGNED }), d)).status, 200);
  assert.deepEqual(log, ['built:buy:ok', `sent:${SIG}`]);
  assert.deepEqual(d.settled, [`${built[0]?.id}:${SIG}`]);
});

test('★ a failed simulation is recorded as refused, and still returns nothing to sign', async () => {
  const { records, log } = recorder();
  const r = await handle('POST', '/build', JSON.stringify({ wallet: ME, quote: QUOTE }), deps(records, { simulateOk: false }));
  assert.equal(r.status, 422);
  assert.equal(JSON.parse(r.body).transaction, undefined);
  assert.deepEqual(log, ['built:buy:refused']);
});

test('a send the chain refuses is recorded with why, and nothing is watched', async () => {
  const { records, log } = recorder();
  const d = deps(records, { sendThrows: true });
  assert.equal((await handle('POST', '/send', JSON.stringify({ transaction: SIGNED }), d)).status, 502);
  assert.deepEqual(log, ['send_fail:blockhash not found']);
  assert.deepEqual(d.settled, []);
});

test('★ a record that cannot be written is logged and the trade goes on', async () => {
  const errors: string[] = [];
  const records = pgRecords({ query: async () => { throw new Error('relation "public.trade" does not exist'); } }, { error: (m) => errors.push(m) });
  const r = await handle('POST', '/build', JSON.stringify({ wallet: ME, quote: QUOTE }), deps(records));
  assert.equal(r.status, 200);
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(errors, ['trade record not written']);
});

test('★ landed and succeeded is confirmed, landed and failed is failed, never found stays sent', async () => {
  const sleep = async () => undefined;
  const run = (answers: ({ ok: boolean } | null | 'throw')[]) => {
    const { records, log } = recorder();
    let i = 0;
    const landed = async () => { const a = answers[i++] ?? null; if (a === 'throw') throw new Error('rpc down'); return a; };
    return watchSettlement('a'.repeat(64), SIG, { landed, records, sleep, checksMs: [1, 2, 3] }).then((out) => ({ out, log }));
  };
  assert.deepEqual(await run([null, { ok: true }]), { out: 'confirmed', log: ['confirmed'] });
  assert.deepEqual(await run(['throw', { ok: false }]), { out: 'failed', log: ['failed'] });
  assert.deepEqual(await run([null, null, null]), { out: 'unseen', log: [] });
});
