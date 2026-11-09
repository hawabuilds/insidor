/**
 * The coin lookup searches EVERY name the judge gave a subject (2026-10-13), each keeping its
 * own newest hits, and an outage on every name is a failed search, never "nothing found".
 * Store and sources are plain fakes; no network, no database.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { LookupTerm } from '@insidor/store';

import type { Logger } from '../log.ts';
import { lookUpCoins, searchNames, type LookupDeps } from './coin-lookup.ts';

const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => log };
const NOW = 1_800_000_000_000 as Millis;

const hit = (address: string, name: string, agoMs: number): CoinSearchHit => ({
  address, name, ticker: name.toUpperCase(), venue: 'curve', marketAddress: null, createdAt: NOW - agoMs, marketCapUsd: null, imageUrl: null, source: 'fake',
});

function deps(term: LookupTerm, sources: CoinSearch[]) {
  const recorded: { hits: readonly string[]; more: boolean }[] = [];
  const failed: string[] = [];
  const d: LookupDeps = {
    coins: {
      queueLookups: async () => 0,
      lookupTerms: async () => [term],
      recordLookup: async (_t, kept) => {
        recorded.push(kept);
      },
      recordFailedLookup: async (t) => {
        failed.push(t.term);
      },
      searchesSince: async () => 0,
      knownAssets: async (keys) => new Set(keys),
    },
    assets: { upsert: async () => 0 },
    sources,
    chain: null,
    policy: DEFAULT_POLICY,
    log,
    now: () => NOW,
  };
  return { d, recorded, failed };
}

test('names are searched once each, case and punctuation aside, at most the policy number', () => {
  assert.deepEqual(searchNames({ term: 'Moo Deng', names: ['Moo Deng', 'MOODENG', 'Hippo', 'baby hippo', 'pygmy'] }, 4), ['Moo Deng', 'Hippo', 'baby hippo', 'pygmy']);
  assert.deepEqual(searchNames({ term: 'Moo Deng', names: ['Moo Deng', 'Hippo', 'baby hippo', 'pygmy', 'extra'] }, 3), ['Moo Deng', 'Hippo', 'baby hippo']);
});

test('★ every name is searched and the coins of each are kept, not only the proposed name\'s', async () => {
  const asked: string[] = [];
  const source: CoinSearch = {
    search: async (t) => {
      asked.push(t);
      return { hits: t === 'Hippo' ? [hit('B', 'Hippo', 60_000)] : [hit('A', 'Moo Deng', 120_000)], capped: false };
    },
  };
  const { d, recorded } = deps({ kind: 'post', id: 'x:1', term: 'Moo Deng', names: ['Moo Deng', 'Hippo'], attempts: 0 }, [source]);
  const r = await lookUpCoins(d);
  assert.deepEqual(asked.sort(), ['Hippo', 'Moo Deng']);
  assert.equal(r.searched, 1);
  assert.deepEqual(recorded[0]?.hits, ['B', 'A'], 'the union, newest launch first');
});

test('★ a search is failed only when every name failed on every source', async () => {
  const down: CoinSearch = { search: async () => Promise.reject(new Error('down')) };
  const { d, recorded, failed } = deps({ kind: 'post', id: 'x:1', term: 'Moo Deng', names: ['Moo Deng', 'Hippo'], attempts: 0 }, [down]);
  const r = await lookUpCoins(d);
  assert.equal(r.failed, 1);
  assert.deepEqual(failed, ['Moo Deng']);
  assert.equal(recorded.length, 0, 'an outage is not "searched, nothing found"');

  const half: CoinSearch = { search: async (t) => (t === 'Hippo' ? { hits: [], capped: false } : Promise.reject(new Error('down'))) };
  const two = deps({ kind: 'post', id: 'x:1', term: 'Moo Deng', names: ['Moo Deng', 'Hippo'], attempts: 0 }, [half]);
  assert.equal((await lookUpCoins(two.d)).searched, 1);
});

test("★ the namer's guesses are searched after the judge's names, only names not already searched, up to their own cap", () => {
  const term = { term: 'Attack', names: ['Attack', 'Pumpfun'], guesses: ['Attack On Pumpfun', 'AOP', 'attack', 'First Target', 'TARGET'] };
  assert.deepEqual(searchNames(term, 4, 3), ['Attack', 'Pumpfun', 'Attack On Pumpfun', 'AOP', 'First Target']);
  assert.deepEqual(searchNames(term, 4), ['Attack', 'Pumpfun'], 'no guesses while the switch is off');
});

test('★ the narrative pages\' posts are searched after the feed, on the free sources only, a shared name once a pass', async () => {
  const paid: string[] = [];
  const free: string[] = [];
  const paidSource: CoinSearch = { search: async (t) => (paid.push(t), { hits: [], capped: false }) };
  const freeSource: CoinSearch = { search: async (t) => (free.push(t), { hits: [hit('C', t, 60_000)], capped: false }) };
  const feed: LookupTerm = { kind: 'post', id: 'x:feed', term: 'Moo Deng', names: ['Moo Deng'], attempts: 0 };
  const siblings: LookupTerm[] = [
    { kind: 'post', id: 'x:a', term: 'Gordão', names: ['Gordão'], attempts: 0, via: 'narrative', postedAtMs: NOW },
    { kind: 'post', id: 'x:b', term: 'gordão', names: ['gordão', 'Fat Cat'], attempts: 0, via: 'narrative', postedAtMs: NOW },
  ];
  const { d, recorded } = deps(feed, [paidSource]);
  const asked: number[] = [];
  const r = await lookUpCoins({
    ...d,
    freeSources: [freeSource],
    coins: { ...d.coins, narrativePostTerms: async (_live, _dead, _retries, limit) => (asked.push(limit), siblings) },
  });
  assert.deepEqual(paid, ['Moo Deng'], 'the paid source is asked for the feed post alone');
  assert.deepEqual(free.sort(), ['Fat Cat', 'Gordão'], 'the free source: each distinct name of the siblings once');
  assert.equal(r.searched, 3);
  assert.equal(recorded.length, 3);
  assert.equal(asked[0], DEFAULT_POLICY.universe.lookup.narrativePosts.perPass, 'at most perPass a pass');
});

test('★ narrative posts wait while only the feed\'s reserve is left of the day, and are never searched with no free source', async () => {
  const feed: LookupTerm = { kind: 'post', id: 'x:feed', term: 'Moo Deng', names: ['Moo Deng'], attempts: 0 };
  const source: CoinSearch = { search: async () => ({ hits: [], capped: false }) };
  const l = DEFAULT_POLICY.universe.lookup;
  const names = l.namesPerSubject + (DEFAULT_POLICY.names.on ? l.guessNamesPerSubject : 0);
  let asked = 0;
  const narrativePostTerms = async () => (asked += 1, []);
  const { d } = deps(feed, [source]);
  const late = Math.ceil((l.perDay - l.narrativePosts.feedReserve) / names);
  await lookUpCoins({ ...d, freeSources: [source], coins: { ...d.coins, narrativePostTerms, searchesSince: async (at) => (at === NOW - 60_000 ? 0 : late) } });
  assert.equal(asked, 0, 'the reserve is the feed\'s');
  await lookUpCoins({ ...d, coins: { ...d.coins, narrativePostTerms } });
  assert.equal(asked, 0, 'no free source: not searched');
  await lookUpCoins({ ...d, freeSources: [source], coins: { ...d.coins, narrativePostTerms } });
  assert.equal(asked, 1);
});

test('★ a narrative post searched days after it went up keeps the coins launched after it', async () => {
  const posted = NOW - 10 * 86_400_000;
  const source: CoinSearch = { search: async () => ({ hits: [hit('OLD', 'Gordão', 9 * 86_400_000), hit('BEFORE', 'Gordão', 30 * 86_400_000)], capped: false }) };
  const feed: LookupTerm = { kind: 'post', id: 'x:feed', term: 'Moo Deng', names: ['Moo Deng'], attempts: 0 };
  const { d, recorded } = deps(feed, [{ search: async () => ({ hits: [], capped: false }) }]);
  await lookUpCoins({
    ...d,
    freeSources: [source],
    coins: { ...d.coins, narrativePostTerms: async () => [{ kind: 'post', id: 'x:a', term: 'Gordão', names: ['Gordão'], attempts: 0, via: 'narrative', postedAtMs: posted as Millis }] },
  });
  assert.deepEqual(recorded[1]?.hits, ['OLD'], 'launched a day after the post: kept; three weeks before it: not');
});

test("★ the narrative posts' chain reads stop at the day's cap, and a coin past it is added from what the search gave", async () => {
  const cap = DEFAULT_POLICY.universe.lookup.narrativePosts.chainReadsPerDay;
  const reads: string[] = [];
  const chain = {
    metadataUri: async (m: string) => (reads.push(`meta:${m}`), `https://example.org/${m}.json`),
    oldestSignatureBlockTime: async (m: string) => (reads.push(`oldest:${m}`), 1_799_000_000),
    curveAccount: async (c: string) => (reads.push(`curve:${c}`), {}),
  };
  const upserted: { metadata: unknown; source: string }[] = [];
  const source: CoinSearch = { search: async () => ({ hits: [hit('So11111111111111111111111111111111111111112', 'Gordão', 60_000), hit('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 'Gordão', 120_000)], capped: false }) };
  const feed: LookupTerm = { kind: 'post', id: 'x:feed', term: 'Moo Deng', names: ['Moo Deng'], attempts: 0 };
  const { d } = deps(feed, [{ search: async () => ({ hits: [], capped: false }) }]);
  const tally = { day: Math.floor(NOW / 86_400_000), reads: cap - 2 };
  await lookUpCoins({
    ...d,
    chain,
    freeSources: [source],
    chainReads: tally,
    assets: {
      upsert: async (xs) => {
        for (const a of xs) upserted.push({ metadata: a.declaredSocial['metadata'], source: a.mintedAt.source });
        return xs.length;
      },
    },
    coins: {
      ...d.coins,
      knownAssets: async () => new Set(),
      narrativeCoinsAddedSince: async () => 0,
      narrativePostTerms: async () => [{ kind: 'post', id: 'x:a', term: 'Gordão', names: ['Gordão'], attempts: 0, via: 'narrative', postedAtMs: NOW }],
    },
  });
  assert.equal(reads.length, 2, "room for one coin's two reads, no more");
  assert.equal(tally.reads, cap);
  assert.equal(upserted.length, 2, 'both coins are added and listed');
  assert.deepEqual(upserted.map((u) => [u.metadata === undefined ? 'no link' : 'link', u.source]), [['link', 'chain_rpc'], ['no link', 'vendor_field']]);
});

test('★ a pool hit is added only when the chain holds its launchpad curve; no curve or a failed read adds nothing', async () => {
  const PROVEN = 'Er4LgAaev5h9hXkmvJxCzZb7xA9a9VhRM1XMTj5Fpump';
  const BARE = 'Ez92P7sb4vQ3hxk5SiwP3YRrNeZcBs3FAaLLdi2Hpump';
  const pool = (address: string, name: string): CoinSearchHit => ({ ...hit(address, name, 60_000), venue: 'pool' });
  const source: CoinSearch = { search: async () => ({ hits: [pool(PROVEN, 'Jensen'), pool(BARE, 'Jensen')], capped: false }) };
  const term: LookupTerm = { kind: 'post', id: 'x:jensen', term: 'Jensen', names: ['Jensen'], attempts: 0 };
  const run = async (curveAccount: (c: string) => Promise<unknown>) => {
    const { d } = deps(term, [source]);
    const added: string[] = [];
    const reads: string[] = [];
    await lookUpCoins({
      ...d,
      chain: { metadataUri: async (m) => (reads.push(`meta:${m}`), null), oldestSignatureBlockTime: async () => null, curveAccount },
      assets: { upsert: async (xs) => (added.push(...xs.map((a) => a.ref.address)), xs.length) },
      coins: { ...d.coins, knownAssets: async () => new Set() },
    });
    return { added, reads };
  };
  const { curveAddress } = await import('@insidor/venue-solana-pumpfun');
  const one = await run(async (c) => (c === curveAddress(PROVEN) ? {} : null));
  assert.deepEqual(one.added, [PROVEN]);
  assert.deepEqual(one.reads, [`meta:${PROVEN}`], 'a coin with no curve spends no further reads');
  const down = await run(async () => { throw new Error('rpc down'); });
  assert.deepEqual(down.added, [], 'unknown is never yes');
  const { d } = deps(term, [source]);
  const added: string[] = [];
  await lookUpCoins({ ...d, assets: { upsert: async (xs) => (added.push(...xs.map((a) => a.ref.address)), xs.length) }, coins: { ...d.coins, knownAssets: async () => new Set() } });
  assert.deepEqual(added, [], 'no chain to ask: no pool hit is added');
});

test("★ the store's count of today's coins holds the cap after a restart", async () => {
  const reads: string[] = [];
  const chain = { metadataUri: async () => (reads.push('m'), null), oldestSignatureBlockTime: async () => (reads.push('o'), null), curveAccount: async () => (reads.push('c'), null) };
  const source: CoinSearch = { search: async () => ({ hits: [hit('So11111111111111111111111111111111111111112', 'Gordão', 60_000)], capped: false }) };
  const { d } = deps({ kind: 'post', id: 'x:feed', term: 'Moo Deng', names: ['Moo Deng'], attempts: 0 }, [{ search: async () => ({ hits: [], capped: false }) }]);
  await lookUpCoins({
    ...d,
    chain,
    freeSources: [source],
    chainReads: { day: 0, reads: 0 },
    coins: {
      ...d.coins,
      knownAssets: async () => new Set(),
      narrativeCoinsAddedSince: async () => DEFAULT_POLICY.universe.lookup.narrativePosts.chainReadsPerDay / 2,
      narrativePostTerms: async () => [{ kind: 'post', id: 'x:a', term: 'Gordão', names: ['Gordão'], attempts: 0, via: 'narrative', postedAtMs: NOW }],
    },
  });
  assert.equal(reads.length, 0);
});

test("★ the namer's guesses fill in only when the judge's names found no coin (the owner, 2026-10-26: Dandy, not Hazel)", async () => {
  const source: CoinSearch = { search: async (q: string) => ({ hits: q === 'DANDY' ? [hit('DANDY1', 'Dandy', 60_000)] : q === 'Hazel' ? [hit('HAZEL1', 'Hazel', 60_000)] : [], capped: false }) };
  const term: LookupTerm = { kind: 'post', id: 'x:dandy', term: 'DANDY', names: ['DANDY'], guesses: ['Hazel'], attempts: 0 };
  const { d, recorded } = deps(term, [source]);
  await lookUpCoins(d);
  assert.deepEqual(recorded[0]?.hits, ['DANDY1'], 'the judge found DANDY: no $HAZEL from the guess');
  const none: CoinSearch = { search: async (q: string) => ({ hits: q === 'Hazel' ? [hit('HAZEL1', 'Hazel', 60_000)] : [], capped: false }) };
  const r2 = deps(term, [none]);
  await lookUpCoins(r2.d);
  assert.deepEqual(r2.recorded[0]?.hits, DEFAULT_POLICY.names.on ? ['HAZEL1'] : [], 'the judge found nothing: the guess fills in');
});
