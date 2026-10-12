/**
 * Reading an address's oldest transaction from one oldest-first RPC reply: the block time,
 * null for an address with none, and an RPC error as unavailable — never as "no history".
 * The reply below is hand-written in the provider's documented shape; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chainClient, readOldestBlockTime } from './client.ts';

const REPLY = {
  jsonrpc: '2.0',
  id: 1,
  result: {
    data: [{ signature: '5xSampleSignatureNotReal', slot: 434606473, transactionIndex: 1159, err: null, memo: null, blockTime: 1784764183, confirmationStatus: 'finalized' }],
    paginationToken: '434606473:1159',
  },
};

test('★ the oldest transaction\'s block time, in seconds', () => {
  assert.equal(readOldestBlockTime(REPLY), 1784764183);
  assert.equal(readOldestBlockTime({ jsonrpc: '2.0', id: 1, result: { data: [] } }), null, 'no history is null');
});

test('★ an RPC error is unavailable, never an address with no history', () => {
  assert.throws(() => readOldestBlockTime({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }), /rpc error/);
});

test('the call asks for one row, oldest first', async () => {
  let body: { method?: string; params?: unknown[] } = {};
  const fetch = (async (_url: string, init: { body: string }) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify(REPLY), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const chain = chainClient({ launchpadBaseUrl: 'https://launchpad.invalid', rpcUrl: 'https://rpc.invalid', fetch });
  assert.equal(await chain.oldestSignatureBlockTime('Mint111'), 1784764183);
  assert.equal(body.method, 'getTransactionsForAddress');
  assert.deepEqual(body.params, ['Mint111', { sortOrder: 'asc', limit: 1, transactionDetails: 'signatures' }]);
});
