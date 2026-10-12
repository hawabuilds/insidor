/**
 * Pictures for many coins in one call: read from a recorded reply, and anything that is not a
 * plain https link left out rather than shown.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSET_BATCH_REPLY } from './__fixtures__/asset-batch.ts';
import { chainClient, readImageUris } from './client.ts';

test('★ each coin\'s picture by address; an address the chain does not know is simply missing', () => {
  const images = readImageUris(ASSET_BATCH_REPLY);
  assert.equal(images.size, 2);
  assert.equal(images.get('Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump'), 'https://ipfs.io/ipfs/bafybeielkr3sq6eg2hrbp2ysds4zo4diikbb53d4orjgyzohxgrhelx7ia');
  assert.equal(images.has('11111111111111111111111111111111'), false);
});

test('a link a creator typed that is not plain https is never shown', () => {
  const images = readImageUris({ result: [{ id: 'A', content: { links: { image: 'javascript:alert(1)' } } }, { id: 'B', content: { links: { image: 'https://user:pw@evil.example/x.png' } } }] });
  assert.equal(images.size, 0);
});

test('no coins, no call', async () => {
  let calls = 0;
  const chain = chainClient({ launchpadBaseUrl: '', rpcUrl: 'https://rpc.example', fetch: (async () => { calls += 1; return new Response('{}'); }) as typeof fetch });
  assert.equal((await chain.imageUris([])).size, 0);
  assert.equal(calls, 0);
});
