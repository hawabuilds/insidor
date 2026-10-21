/**
 * The launch listing, driven by plain functions: it pages until it meets the previous pass, adds
 * only what we do not hold, survives a chain read that fails, and keeps its place when a page does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import { createListing, type ChainDetails, type ListedLaunch, type ListingDeps } from './listing.ts';

const NOW = 1_800_000_000_000;
/** A cap no test but the cap's own reaches. */
const CREDITS = { accountsPerCall: 100, creditsPerCall: 1, dayCapCredits: 1_000, dayCapPages: 1_000, paceSlackPages: 1_000 };

function hit(address: string, ageS: number): CoinSearchHit {
  return { address, name: `name ${address}`, ticker: address.toUpperCase(), venue: 'curve', marketAddress: null, createdAt: NOW - ageS * 1_000, marketCapUsd: null, imageUrl: null, source: 'listing' };
}

interface Rig {
  readonly deps: ListingDeps;
  readonly pagesAsked: number[];
  readonly added: { address: string; details: ChainDetails | null }[];
  readonly notes: string[];
  pages: ListedLaunch[][];
  held: Set<string>;
  detailsFail: boolean;
}

function rig(pages: ListedLaunch[][]): Rig {
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
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000, ...CREDITS });
  const res = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2, 3]);
  assert.deepEqual(r.added.map((a) => a.address).sort(), ['a', 'c', 'd', 'e']);
  assert.equal(res.added, 4);
  assert.equal(res.behind, false, 'a first pass has no previous one to fall behind');
  assert.equal(r.added[0]?.details?.uri, 'https://ipfs.io/ipfs/a', "the chain's own metadata link is carried");
});

test('a later pass stops at the page that reaches the previous pass', async () => {
  const r = rig([[hit('a', 20), hit('b', 30)]]);
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000, ...CREDITS });
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
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000, ...CREDITS });
  await listing.pass();
  r.pages = [[hit('n1', 1), hit('n2', 2)], [hit('n3', 3), hit('n4', 4)]];
  const res = await listing.pass();
  assert.equal(res.behind, true);
  assert.equal(r.notes.some((n) => n.includes('fell behind')), true);
  assert.equal(res.added, 4, 'what it did read is still added');
});

test('a launch older than the age bar is not added', async () => {
  const r = rig([[hit('young', 60), hit('old', 3_600)]]);
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, ...CREDITS });
  await listing.pass();
  assert.deepEqual(r.added.map((a) => a.address), ['young']);
});

test('★ a chain read that fails still adds the coins, without a metadata link', async () => {
  const r = rig([[hit('a', 5)]]);
  r.detailsFail = true;
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, ...CREDITS });
  const res = await listing.pass();
  assert.equal(res.added, 1);
  assert.equal(res.withoutDetails, 1);
  assert.equal(r.added[0]?.details, null);
  assert.equal(r.notes.some((n) => n.includes('chain details unavailable')), true);
});

test('★ a page that fails keeps the place, so the next pass reads the same pools again', async () => {
  const r = rig([[hit('a', 50)]]);
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000, ...CREDITS });
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
  const listing = createListing(r.deps, { pagesPerPass: 2, maxAgeMs: 1_800_000, ...CREDITS });
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
  const res = await createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, ...CREDITS }).pass();
  assert.equal(asked, 0);
  assert.equal(res.added, 0);
});

test('★ the chain reads stop at the day\'s credit cap; coins are still added, without details, and the cap is said once', async () => {
  const r = rig([[hit('a', 5), hit('b', 10), hit('c', 15)]]);
  let asked = 0;
  const details = r.deps.details;
  (r.deps as { details: ListingDeps['details'] }).details = async (a) => {
    asked += 1;
    return details(a);
  };
  /* Two coins a read, a credit each, two credits a day: the three coins need two reads. */
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, accountsPerCall: 2, creditsPerCall: 1, dayCapCredits: 2, dayCapPages: 1_000, paceSlackPages: 1_000 });
  const first = await listing.pass();
  assert.equal(first.credits, 2);
  assert.equal(asked, 1);
  assert.equal(first.withoutDetails, 0);
  r.pages = [[hit('d', 1)]];
  const second = await listing.pass();
  assert.equal(second.credits, 0);
  assert.equal(asked, 1);
  assert.equal(second.added, 1);
  assert.equal(second.withoutDetails, 1);
  r.pages = [[hit('e', 1)]];
  await listing.pass();
  assert.equal(r.notes.filter((n) => n.includes('credits are spent')).length, 1);
});

test('★ a page refused after the first keeps what was read, and the place, so the next pass reads back to it', async () => {
  const r = rig([[hit('a', 100)]]);
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000, ...CREDITS });
  await listing.pass();
  r.pages = [[hit('b', 10), hit('c', 20)], [hit('d', 40)], [hit('e', 60), hit('a', 100)]];
  const page = r.deps.page;
  (r.deps as { page: ListingDeps['page'] }).page = async (n) => {
    if (n === 2) throw new Error('listing responded 429');
    return page(n);
  };
  const refused = await listing.pass();
  assert.equal(refused.refused, 'listing responded 429');
  assert.equal(refused.behind, false, 'a refusal is said as one, not as falling behind');
  assert.equal(refused.added, 2, "page 1's launches are added");
  (r.deps as { page: ListingDeps['page'] }).page = page;
  r.pagesAsked.length = 0;
  const res = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2, 3], 'the place did not move: the pass reads back to the last good one');
  assert.equal(res.behind, false);
  assert.deepEqual(r.added.map((x) => x.address).sort(), ['a', 'b', 'c', 'd', 'e']);
});

test('★ the listing pages stop at the day\'s cap and the cap is said once', async () => {
  const r = rig([[hit('a', 5)], [hit('b', 10)], [hit('c', 15)]]);
  const listing = createListing(r.deps, { pagesPerPass: 3, maxAgeMs: 1_800_000, ...CREDITS, dayCapPages: 2, paceSlackPages: 10 });
  const first = await listing.pass();
  assert.deepEqual(r.pagesAsked, [1, 2], 'the cap stops a pass part way');
  assert.equal(first.added, 2);
  const second = await listing.pass();
  await listing.pass();
  assert.equal(second.held, 'cap');
  assert.equal(second.pagesRead, 0);
  assert.deepEqual(r.pagesAsked, [1, 2]);
  assert.equal(r.notes.filter((n) => n.includes('listing pages are spent')).length, 1);
});

test('★ a pass ahead of the day\'s even pace is held, and reads again once the day catches up', async () => {
  let now = Date.UTC(2027, 0, 1, 0, 0, 0);
  const r = rig([[hit('a', 5)]]);
  (r.deps as { now: ListingDeps['now'] }).now = () => now as Millis;
  /* 2,880 pages a day is one a 30 s; with a slack of 1 the second page in the first 30 s waits. */
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: Number.POSITIVE_INFINITY, ...CREDITS, dayCapPages: 2_880, paceSlackPages: 1 });
  assert.equal((await listing.pass()).held, null);
  assert.equal((await listing.pass()).held, 'pace');
  now += 30_000;
  assert.equal((await listing.pass()).held, null);
  assert.deepEqual(r.pagesAsked, [1, 1]);
});

/* ── tokens launches are paired against ─────────────────────────────────── */

const MSTRX = { address: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', symbol: 'MSTRx', name: 'MicroStrategy xStock' };
const LAURA = { address: 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump', symbol: 'Laura', name: 'Laura' };

test('★ a launch paired against a stock adds the coin, and the stock is marked as not a launch, once', async () => {
  const lauracat = { ...hit('lauracat', 5), pairedWith: LAURA };
  const laura = { ...hit(LAURA.address, 10), pairedWith: MSTRX };
  const sol = { ...hit('solcoin', 15), pairedWith: null };
  const r = rig([[lauracat, laura, sol]]);
  const asked: string[][] = [];
  /* The chain: MSTRx has no curve; Laura, a coin another coin is paired against, has one. */
  (r.deps as { markPaired: ListingDeps['markPaired'] }).markPaired = async (tokens) => {
    asked.push(tokens.map((t) => t.address));
    const noCurve = tokens.filter((t) => t.address === MSTRX.address).map((t) => t.address);
    return { marked: noCurve, settled: tokens.map((t) => t.address), calls: 1 };
  };
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, ...CREDITS });
  const res = await listing.pass();
  assert.deepEqual(r.added.map((a) => a.address).sort(), [LAURA.address, 'lauracat', 'solcoin'], 'every launch is its own coin');
  assert.deepEqual(asked, [[LAURA.address, MSTRX.address]], 'only the paired tokens are asked about; a SOL launch adds none');
  assert.equal(res.pairedMarked, 1);
  assert.equal(res.credits, 2, 'the paired check is counted against the day like any chain read');
  await listing.pass();
  assert.equal(asked.length, 1, 'a settled token is not asked about again');
});

test('a paired check that fails never fails the pass, and is asked again next pass', async () => {
  const r = rig([[{ ...hit(LAURA.address, 5), pairedWith: MSTRX }]]);
  let calls = 0;
  (r.deps as { markPaired: ListingDeps['markPaired'] }).markPaired = async () => {
    calls += 1;
    throw new Error('rpc responded 429');
  };
  const listing = createListing(r.deps, { pagesPerPass: 1, maxAgeMs: 1_800_000, ...CREDITS });
  const res = await listing.pass();
  assert.equal(res.added, 1);
  assert.equal(res.pairedMarked, 0);
  assert.ok(r.notes.some((n) => n.startsWith('paired tokens could not be checked')));
  await listing.pass();
  assert.equal(calls, 2);
});
