/**
 * The coin lookup's choice of names, and the unread coins' fields, against a fake connection.
 *
 * Why this file exists: the post half of `lookupTerms` once tested a feed row's coins with
 * `payload -> 'coins' is null or payload ->> 'coins' = 'null'`, which no JSON null satisfies, so
 * no For You post was ever searched and nothing said so. Asserting the statement's text is the
 * only check that runs without Postgres; the live count was measured when the line was fixed.
 * What breaks if changed carelessly: a filter that misses a "no coin" spelling stops the search
 * for every post silently again. An unread coin's address and launch are read with it: without
 * them the universe loop could not hand its read to the coin-link step, and a coin it read first
 * would again get no link.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgCoinUniverseRepo } from './coin-universe.ts';

function fakeDb(): { db: Db; sent: string[] } {
  const sent: string[] = [];
  const db = {
    query: async (sql: string) => {
      sent.push(sql);
      return [];
    },
  } as unknown as Db;
  return { db, sent };
}

test('★ a feed row with no coin is read by its kind, the same way for posts and narratives', async () => {
  const { db, sent } = fakeDb();
  await new PgCoinUniverseRepo(db).lookupTerms(0 as Millis, 3, 5);
  const sql = sent[0] ?? '';
  assert.ok(sql.includes(`coalesce(r.payload -> 'coins' ->> 'kind', 'none') in ('none', 'pending', 'unchecked')`), 'posts: JSON null, none, pending and unchecked are "no coin"');
  assert.ok(sql.includes(`coalesce(v.payload -> 'coins' ->> 'kind', 'none') in ('none', 'pending')`), 'narratives: the same test');
  assert.ok(!sql.includes(`->> 'coins' = 'null'`), 'the spelling no JSON null ever matched is gone');
});

test('★ an unread coin comes with its address and launch, so its read can be handed to the coin-link step', async () => {
  const db = { query: async () => [{ asset_key: 'nug', metadata_uri: 'ipfs://nug', address: 'DW4u', minted_at: '2026-10-25T18:53:52Z' }] } as unknown as Db;
  const [coin] = await new PgCoinUniverseRepo(db).unread(0 as Millis, 3, 80);
  assert.deepEqual(coin, { assetKey: 'nug', metadataUri: 'ipfs://nug', address: 'DW4u', mintedAt: Date.parse('2026-10-25T18:53:52Z') });
});
