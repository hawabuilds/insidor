/**
 * The launch listing, driven by plain functions: it pages until it meets the previous pass, adds
 * only what we do not hold, survives a chain read that fails, and keeps its place when a page does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import { createListing, type ChainDetails, type ListingDeps } from './listing.ts';

const NOW = 1_800_000_000_000;

function hit(address: string, ageS: number): CoinSearchHit {
  return { address, name: `name ${address}`, ticker: address.toUpperCase(), venue: 'curve', marketAddress: null, createdAt: NOW - ageS * 1_000, marketCapUsd: null, imageUrl: null, source: 'listing' };
}

interface Rig {
  readonly deps: ListingDeps;
  readonly pagesAsked: number[];
  readonly added: { address: string; details: ChainDetails | null }[];
  readonly notes: string[];
  pages: CoinSearchHit[][];
  held: Set<string>;
  detailsFail: boolean;
}

function rig(pages: CoinSearchHit[][]): Rig {
  const r: Rig = {
    pages,
    held: new Set(),
    detailsFail: false,
    pagesAsked: [],
    added: [],
    notes: [],
    deps: undefined as unknown as ListingDeps,
  };
  (r as { deps: ListingDeps }).deps = {
    page: async (n) => {
      r.pagesAsked.push(n);
      return r.pages[n - 1] ?? [];
    },
    known: async (addresses) => new Set(addresses.filter((a) => r.held.has(a))),
    details: async (addresses) => {
      if (r.detailsFail) throw new Error('rpc responded 429');
      return new Map(addresses.map((a) => [a, { name: `chain ${a}`, symbol: a, uri: `https://ipfs.io/ipfs/${a}` }]));
    },
    add: async (launches) => {
      const out: string[] = [];
      for (const l of launches) {
        if (r.held.has(l.hit.address)) continue;
        r.held.add(l.hit.address);
        r.added.push({ address: l.hit.address, details: l.details });
        out.push(l.hit.address);
      }
      return out;
    },
    now: () => NOW as Millis,
    note: (msg) => r.notes.push(msg),
  };
  return r;
}

test('the first pass reads every page it may, and adds only the coins we do not hold', async () => {
  const r = rig([[hit('a', 5), hit('b', 10)], [hit('c', 20), hit('d', 30)], [hit('e', 40)]]);
  r.held.add('b');
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000 });
  const res = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2, 3]);
  assert.deepEqual(r.added.map((a) => a.address).sort(), ['a', 'c', 'd', 'e']);
  assert.equal(res.added, 4);
  assert.equal(res.behind, false, 'a first pass has no previous one to fall behind');
  assert.equal(r.added[0]?.details?.uri, 'https://ipfs.io/ipfs/a', "the chain's own metadata link is carried");
});

test('a later pass stops at the page that reaches the previous pass', async () => {
  const r = rig([[hit('a', 20), hit('b', 30)]]);
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000 });
  await listing.pass();
  r.pagesAsked.length = 0;
  r.pages = [[hit('x', 1), hit('a', 20)], [hit('y', 60)], [hit('z', 90)]];
  const res = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2], 'page 1 overlaps the previous pass; one page more is read for the cache skew');
  assert.equal(res.added, 2);
  assert.equal(res.behind, false);
});

test('a pass that runs out of pages before the previous one says it fell behind', async () => {
  const r = rig([[hit('a', 100)]]);
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000 });
  await listing.pass();
  r.pages = [[hit('n1', 1), hit('n2', 2)], [hit('n3', 3), hit('n4', 4)]];
  const res = await listing.pass();
  assert.equal(res.behind, true);
  assert.equal(r.notes.some((n) => n.includes('fell behind')), true);
  assert.equal(res.added, 4, 'what it did read is still added');
});

test('a launch older than the age bar is not added', async () => {
  const r = rig([[hit('young', 60), hit('old', 3_600)]]);
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000 });
  await listing.pass();
  assert.deepEqual(r.added.map((a) => a.address), ['young']);
});

test('★ a chain read that fails still adds the coins, without a metadata link', async () => {
  const r = rig([[hit('a', 5)]]);
  r.detailsFail = true;
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000 });
  const res = await listing.pass();
  assert.equal(res.added, 1);
  assert.equal(res.withoutDetails, 1);
  assert.equal(r.added[0]?.details, null);
  assert.equal(r.notes.some((n) => n.includes('chain details unavailable')), true);
});

test('★ a page that fails keeps the place, so the next pass reads the same pools again', async () => {
  const r = rig([[hit('a', 50)]]);
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000 });
  await listing.pass();
  const failing = r.deps.page;
  (r.deps as { page: ListingDeps['page'] }).page = async () => {
    throw new Error('listing responded 429');
  };
  await assert.rejects(listing.pass());
  (r.deps as { page: ListingDeps['page'] }).page = failing;
  // Two pages of launches newer than the last good pass; the second reaches it.
  r.pages = [[hit('b', 10), hit('c', 20)], [hit('d', 40), hit('a', 50)]];
  r.pagesAsked.length = 0;
  const res = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2], 'page 2 reaches the last good pass and is the last allowed');
  assert.equal(res.behind, false);
  assert.deepEqual(r.added.map((x) => x.address).sort(), ['a', 'b', 'c', 'd']);
});

test('★ a pass whose write fails keeps the place too', async () => {
  const r = rig([[hit('a', 50)]]);
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000 });
  await listing.pass();
  const add = r.deps.add;
  (r.deps as { add: ListingDeps['add'] }).add = async () => {
    throw new Error('database went away');
  };
  r.pages = [[hit('b', 10)], [hit('c', 30)], [hit('a', 50)]];
  await assert.rejects(listing.pass());
  (r.deps as { add: ListingDeps['add'] }).add = add;
  r.pages = [[hit('d', 5), hit('b', 10)], [hit('c', 30), hit('a', 50)]];
  const res = await listing.pass();
  assert.equal(res.behind, false);
  assert.deepEqual(r.added.map((x) => x.address).sort(), ['a', 'b', 'c', 'd']);
});

test('nothing new is no chain read and no write', async () => {
  const r = rig([[hit('a', 5)]]);
  r.held.add('a');
  let asked = 0;
  const details = r.deps.details;
  (r.deps as { details: ListingDeps['details'] }).details = async (a) => {
    asked += 1;
    return details(a);
  };
  const res = await createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000 }).pass();
  assert.equal(asked, 0);
  assert.equal(res.added, 0);
});
