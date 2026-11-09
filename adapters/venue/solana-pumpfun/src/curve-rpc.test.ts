/**
 * `topHolders` reads the chain's largest accounts as whole tokens, and a failed call throws rather
 * than answering "no holders". Fake fetch; no network.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { topHolders } from './curve-rpc.ts';

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof globalThis.fetch;

test('whole tokens, largest first, as the chain lists them', async () => {
  const fetch = answer({ jsonrpc: '2.0', id: 1, result: { value: [
    { address: 'a', amount: '16019181123456', decimals: 6, uiAmountString: '16019181.123456' },
    { address: 'b', amount: '301080000000', decimals: 6, uiAmountString: '301080' },
    { address: 'c', amount: '0', decimals: 6, uiAmountString: '0' },
  ] } });
  assert.deepEqual(await topHolders({ rpcUrl: 'https://rpc.invalid', fetch, timeoutMs: 1_000 }, 'Mint'), ['16019181', '301080', '0']);
});

test('a refused call throws: unknown is never "no holders"', async () => {
  await assert.rejects(topHolders({ rpcUrl: 'https://rpc.invalid', fetch: answer({}, 429), timeoutMs: 1_000 }, 'Mint'));
});
