/**
 * A coin the owner named by address is added only from a hit with exactly that address, and one
 * no source lists waits rather than being added with no name. Plain fakes; no network, no database.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { Asset } from '@insidor/contracts/asset.ts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import type { Logger } from '../log.ts';
import { addOwnerCoins, RETRY_MS } from './owner-coins.ts';

const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => log };
const NOW = 1_800_000_000_000;
const MINT = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';
const OTHER = 'Ez92P7sb4vQ3hxk5SiwP3YRrNeZcBs3FAaLLdi2Hpump';

const hit = (address: string, name: string): CoinSearchHit => ({
  address, name, ticker: name.toUpperCase(), venue: 'pool', marketAddress: null, createdAt: NOW - 3_600_000, marketCapUsd: 40_000, imageUrl: null, source: 'fake',
});

test('★ only the hit with the exact address is added, with the chain launch time when read', async () => {
  const added: Asset[] = [];
  const n = await addOwnerCoins({
    learning: { ownerCoinsNotHeld: async () => [MINT] },
    assets: { upsert: async (a) => { added.push(...a); return a.length; } },
    sources: [{ search: async () => ({ hits: [hit(OTHER, 'HomeView by Apple'), hit(MINT, 'HomeView')], capped: false }) }],
    chain: { metadataUri: async () => 'https://ipfs.io/ipfs/bafkreiabc', oldestSignatureBlockTime: async () => (NOW - 7_200_000) / 1_000 },
    log,
    now: () => NOW as Millis,
  });
  assert.equal(n, 1);
  assert.equal(added[0]?.ref.address, MINT);
  assert.equal(added[0]?.name, 'HomeView');
  assert.equal(added[0]?.origin, 'backfill', 'a coin named by hand is still a search-found coin');
  assert.equal(added[0]?.mintedAt.at, NOW - 7_200_000);
});

test('an address no source lists adds nothing, and is not asked again until the wait is over', async () => {
  let asked = 0;
  const run = (at: number) =>
    addOwnerCoins({
      learning: { ownerCoinsNotHeld: async () => ['So11111111111111111111111111111111111111113'] },
      assets: { upsert: async () => 0 },
      sources: [{ search: async () => { asked += 1; return { hits: [hit(OTHER, 'Other')], capped: false }; } }],
      chain: null,
      log,
      now: () => at as Millis,
    });
  assert.equal(await run(NOW), 0);
  assert.equal(await run(NOW + 1_000), 0);
  assert.equal(asked, 1, 'held back inside the wait');
  await run(NOW + RETRY_MS);
  assert.equal(asked, 2);
});
