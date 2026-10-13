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
