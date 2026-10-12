/**
 * A coin created here is a plain SOL-priced pump.fun coin: the create instruction, built offline
 * by the launchpad's own SDK, carries no quote mint, no quote vault and no quote-control account.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Keypair, PublicKey } from '@solana/web3.js';

import { readLanded } from './client.ts';
import { createInstruction } from './launch.ts';

const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const QUOTE_CONTROL = PublicKey.findProgramAddressSync([Buffer.from('quote-control')], PUMP_PROGRAM)[0];
/* Stocks pump.fun has accepted as quote mints (Trador's registry): none may appear. */
const STOCK_LIKE = ['Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'];

test('★ no stock quote mint in a created coin: the create is the SDK own one, with nothing appended', async () => {
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const ix = await createInstruction({ mint, creator, name: 'Jimothy', symbol: 'JIM', uri: 'https://store/abc.json' });
  assert.ok(ix.programId.equals(PUMP_PROGRAM));
  const keys = ix.keys.map((k) => k.pubkey.toBase58());
  assert.equal(keys.includes(QUOTE_CONTROL.toBase58()), false, 'no quote-control account');
  for (const stock of STOCK_LIKE) assert.equal(keys.includes(stock), false);
  assert.ok(keys.includes(mint.toBase58()));
  /* The same call twice gives the same accounts: nothing is added after the SDK's list. */
  const again = await createInstruction({ mint, creator, name: 'Jimothy', symbol: 'JIM', uri: 'https://store/abc.json' });
  assert.equal(again.keys.length, ix.keys.length);
});

test('a landed transaction: whether it succeeded, who paid, which accounts it named; not found is null', () => {
  const reply = { jsonrpc: '2.0', id: 1, result: { meta: { err: null }, transaction: { message: { accountKeys: [{ pubkey: 'Payer' }, { pubkey: 'Mint' }] } } } };
  assert.deepEqual(readLanded(reply), { ok: true, payer: 'Payer', accounts: ['Payer', 'Mint'] });
  assert.equal(readLanded({ jsonrpc: '2.0', id: 1, result: null }), null);
  assert.equal(readLanded({ ...reply, result: { ...reply.result, meta: { err: { InstructionError: [0, 'x'] } } } })?.ok, false);
});
