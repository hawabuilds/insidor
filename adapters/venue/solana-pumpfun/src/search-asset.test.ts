/**
 * A search hit as a universe row: a candidate (`backfill`), never the source's picture, the
 * chain's launch time when read and the source's otherwise (bounded, never exact), and the
 * metadata link from the chain so the document is read by content id like any coin's.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Millis } from '@insidor/contracts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import { assetFromSearch } from './search-asset.ts';

const NOW = 1_800_000_000_000 as Millis;
const hit: CoinSearchHit = {
  address: 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP', name: 'Naps', ticker: '$NAPS', venue: 'curve',
  createdAt: NOW - 3_600_000, marketCapUsd: 4_387, imageUrl: 'https://cdn.example/naps.png', source: 'dexscreener',
};

test('★ a search hit is a candidate row: backfill origin, no borrowed picture, the metadata link from the chain', () => {
  const asset = assetFromSearch(hit, { firstSeenAt: NOW, metadataUri: 'https://ipfs.io/ipfs/bafkreiexampleexampleexampleexampleexampleexampleexample', chainCreatedAt: null });
  assert.equal(asset?.origin, 'backfill');
  assert.equal(asset?.imageUri, null, 'the source\'s picture is never the coin\'s');
  assert.equal(asset?.symbol, 'NAPS');
  assert.equal(asset?.declaredSocial['metadata'], 'https://ipfs.io/ipfs/bafkreiexampleexampleexampleexampleexampleexampleexample');
  assert.deepEqual(asset?.mintedAt, { at: NOW - 3_600_000, source: 'vendor_field', confidence: 'bounded', boundS: 300 });
});

test('the chain\'s launch time wins over the source\'s when it was read; a bad address is no row', () => {
  const asset = assetFromSearch(hit, { firstSeenAt: NOW, metadataUri: null, chainCreatedAt: (NOW - 3_000_000) as Millis });
  assert.equal(asset?.mintedAt.source, 'chain_rpc');
  assert.deepEqual(asset?.declaredSocial, {});
  assert.equal(assetFromSearch({ ...hit, address: 'not an address' }, { firstSeenAt: NOW, metadataUri: null, chainCreatedAt: null }), null);
});

test('the metadata link is read from the chain\'s asset record', async () => {
  const { chainClient } = await import('./client.ts');
  const fetch = (async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: { json_uri: 'https://ipfs.io/ipfs/bafkreiabc' } } }), { status: 200 })) as unknown as typeof globalThis.fetch;
  assert.equal(await chainClient({ launchpadBaseUrl: '', rpcUrl: 'https://rpc.invalid', fetch }).metadataUri('Mint1'), 'https://ipfs.io/ipfs/bafkreiabc');
});
