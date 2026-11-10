import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { RelayCreate } from '@insidor/venue-solana-pumpfun/relay-trade-socket.ts';

import { createListing } from './listing.ts';
import { createRelayLaunches } from './relay-launches.ts';

const create = (address: string, createdAt: number, details = true): RelayCreate => ({
  address, name: `N${address}`, ticker: `T${address}`, marketAddress: `curve-${address}`, createdAt, marketCapUsd: 2_500, pairedWith: null,
  details: details ? { name: `N${address}`, symbol: `T${address}`, uri: `https://ipfs.io/ipfs/${address}` } : null,
});

test('★ held newest first, for `maxAgeMs`; a coin sent twice is held once; details as the relay sent them', () => {
  let t = 1_000_000;
  const r = createRelayLaunches(60_000, () => t as Millis);
  r.hooks.onCreate(create('A', t));
  t += 10_000;
  r.hooks.onCreate(create('B', t, false));
  r.hooks.onCreate(create('B', t));
  assert.deepEqual(r.page().map((l) => l.address), ['B', 'A']);
  assert.equal(r.page()[0]?.venue, 'curve');
  assert.deepEqual([...r.details(['A', 'B', 'C']).keys()], ['A'], 'B arrived first without its link; C was never sent');
  t += 55_000;
  assert.deepEqual(r.page().map((l) => l.address), ['B'], 'A is past the age');
});

test('fresh while creates keep arriving; quiet past `freshMs` and the backup listing pages again', async () => {
  let t = 1_000_000;
  const r = createRelayLaunches(600_000, () => t as Millis);
  assert.equal(r.fresh(120_000), false, 'nothing yet');
  r.hooks.onCreate(create('A', t));
  assert.ok(r.fresh(120_000));
  t += 120_001;
  assert.equal(r.fresh(120_000), false);
  let pages = 0;
  const backup = createListing(
    { page: async () => (pages++, []), known: async () => new Set(), details: async () => new Map(), add: async () => [], now: () => t as Millis, note: () => undefined, skip: () => r.fresh(120_000) },
    { pagesPerPass: 1, maxAgeMs: 600_000, accountsPerCall: 100, creditsPerCall: 1, dayCapCredits: 1_000, dayCapPages: 1_000, paceSlackPages: 1_000 },
  );
  await backup.pass();
  assert.equal(pages, 1, 'the relay is quiet: the backup reads');
  r.hooks.onCreate(create('B', t));
  assert.equal((await backup.pass()).held, 'relay', 'the relay is delivering: the backup reads nothing');
  assert.equal(pages, 1);
});

test('★ through the listing: a relay launch we do not hold is added with its own details and no chain read', async () => {
  const t = 1_000_000;
  const r = createRelayLaunches(600_000, () => t as Millis);
  r.hooks.onCreate(create('NEW', t - 5_000));
  r.hooks.onCreate(create('HELD', t - 4_000));
  const added: string[] = [];
  const listing = createListing(
    {
      page: async (n) => (n === 1 ? r.page() : []),
      known: async (as) => new Set(as.filter((a) => a === 'HELD')),
      details: async (as) => r.details(as),
      add: async (ls) => (ls.forEach(({ hit, details }) => added.push(`${hit.address}:${details?.uri ?? 'none'}`)), ls.map((l) => l.hit.address)),
      now: () => t as Millis,
      note: () => undefined,
    },
    { pagesPerPass: 2, maxAgeMs: 600_000, accountsPerCall: 100, creditsPerCall: 0, dayCapCredits: Number.POSITIVE_INFINITY, dayCapPages: Number.POSITIVE_INFINITY, paceSlackPages: Number.POSITIVE_INFINITY },
  );
  const res = await listing.pass();
  assert.deepEqual(added, ['NEW:https://ipfs.io/ipfs/NEW']);
  assert.equal(res.added, 1);
});
