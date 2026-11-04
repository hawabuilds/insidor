/**
 * Storing a page: a reskinned account's posts are not stored and the hold is logged; every other
 * post on the page is stored exactly as before, and an account with no history given holds nothing.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Author, Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PgAuthorRepo, PgItemRepo, PgObservationRepo } from '@insidor/store';
import { storeArrivals } from './arrivals.ts';

const NOW = Date.parse('2026-11-04T23:00:00Z') as Millis;

function fakes() {
  const upserted: string[] = [];
  const found: string[] = [];
  const authorRows: string[] = [];
  const repos = {
    authors: { upsert: async (a: readonly Author[]) => { authorRows.push(...a.map((x) => String(x.authorKey))); return a.length; } } as unknown as PgAuthorRepo,
    items: {
      upsert: async (items: readonly Item[]) => { upserted.push(...items.map((i) => String(i.itemId))); return items.length; },
      markFoundBy: async (ids: readonly string[]) => { found.push(...ids); },
    } as unknown as PgItemRepo,
    observations: { seriesForItems: async () => new Map(), append: async () => {} } as unknown as PgObservationRepo,
  };
  return { repos, upserted, found, authorRows };
}

const author = (key: string, history: Author['history']): Author => ({ authorKey: key, source: 'x', firstSeenAt: NOW, handle: key, audience: null, rosterTier: null, history }) as unknown as Author;
const item = (id: string, by: string): Item => ({ itemId: id, authorKey: by, counters: {}, postedAt: NOW, fingerprints: [] }) as unknown as Item;

test('★ a reskinned account\'s posts are not stored and the hold is logged; the rest are stored as before (2026-11-04)', async () => {
  const { repos, upserted, found, authorRows } = fakes();
  const logged: unknown[] = [];
  const store = storeArrivals(repos, DEFAULT_POLICY, () => NOW, { info: (_m, f) => logged.push(f) });
  const zoo = author('x:24979446', { createdAt: Date.parse('2009-03-17T23:24:23Z') as Millis, postsEver: 60, approvalsGiven: 0 });
  const real = author('x:1', { createdAt: Date.parse('2012-01-01T00:00:00Z') as Millis, postsEver: 40_000, approvalsGiven: 9_000 });
  const unknown = author('x:2', undefined);
  await store([item('x:p1', 'x:24979446'), item('x:p2', 'x:1'), item('x:p3', 'x:2')], [zoo, real, unknown], 'all');
  assert.deepEqual(upserted, ['x:p2', 'x:p3']);
  assert.deepEqual(found, ['x:p2', 'x:p3']);
  assert.deepEqual(authorRows, ['x:24979446', 'x:1', 'x:2'], 'the account row is written as before');
  assert.equal(logged.length, 1);
  assert.deepEqual((logged[0] as { posts: string[] }).posts, ['x:p1']);
});

test('switched off, every post is stored', async () => {
  const { repos, upserted } = fakes();
  const off = { ...DEFAULT_POLICY, ingest: { ...DEFAULT_POLICY.ingest, reskin: { ...DEFAULT_POLICY.ingest.reskin, on: false } } };
  const zoo = author('x:24979446', { createdAt: Date.parse('2009-03-17T23:24:23Z') as Millis, postsEver: 60, approvalsGiven: 0 });
  await storeArrivals(repos, off, () => NOW)([item('x:p1', 'x:24979446')], [zoo], 'all');
  assert.deepEqual(upserted, ['x:p1']);
});
