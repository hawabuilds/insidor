/**
 * The launchpad's pool listing, read from a recorded page: each pool's coin, bonded, with its
 * market cap, through the same reader as search.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PUMPSWAP_POOLS } from './__fixtures__/pools-page.ts';
import { geckoterminal, LISTING_PAGES } from './index.ts';

test('★ a page of bonded pools: each coin, bonded, with its market cap; the path asks by volume', async () => {
  const asked: string[] = [];
  const g = geckoterminal({
    baseUrl: 'https://gt.example', timeoutMs: 1_000, now: () => 0,
    fetch: (async (url: string) => { asked.push(url); return new Response(JSON.stringify(PUMPSWAP_POOLS)); }) as unknown as typeof fetch,
  });
  const hits = await g.launchpadPools('pool', 1);
  assert.equal(hits.length, 3);
  for (const h of hits) {
    assert.equal(h.venue, 'pool');
    assert.ok((h.marketCapUsd ?? 0) > 1_000_000);
  }
  assert.equal(asked[0], 'https://gt.example/networks/solana/dexes/pumpswap/pools?page=1&sort=h24_volume_usd_desc');
  await assert.rejects(g.launchpadPools('curve', LISTING_PAGES + 1), RangeError);
});
