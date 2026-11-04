/**
 * ★ POSTS AND THEIR AUTHORS WRITTEN IN BATCHES (store items.ts `upsert`, 2026-11-03): three to five
 * statements a post became three a batch. Real schema (PGlite): the end state must be the one the
 * post-by-post loop left — a post seen twice in one call inserted with its first sighting's fields and
 * updated with its last's, its fingerprints and template ids written once, its author created once with
 * the latest sighting as its last seen.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { PgItemRepo } from '@insidor/store';

import { migratedDb } from './db.ts';

const X = sourceId('x');
const T = Date.UTC(2026, 10, 3, 23);
const MIN = 60_000;

const post = (n: number, author: string, text: string, seenAt: number, extra: Partial<Item> = {}): Item => ({
  itemId: itemId(X, `${n}`), source: X, sourceItemId: `${n}`, origin: 'observed', authorKey: authorKey(X, author),
  postedAt: (T - 60 * MIN) as Millis, firstSeenAt: seenAt as Millis, lang: 'en', text, media: [],
  counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${n}`, ...extra,
});

test('★ the same post twice in one call: first sighting inserted, last sighting\'s fields kept; fingerprints and template ids once; one author', async () => {
  const db = await migratedDb();
  const repo = new PgItemRepo(db);
  const fp = [{ kind: 'textShingle', key: '0123456789abcdef', bits: 64 }] as unknown as Item['fingerprints'];
  const n = await repo.upsert([
    post(1, 'alice', 'first words', T - 10 * MIN, { fingerprints: fp, formatIds: ['sound:1'] }),
    post(2, 'bob', 'another post', T - 9 * MIN),
    post(1, 'alice', 'edited words', T - 5 * MIN, { fingerprints: fp, formatIds: ['sound:1', 'fx:2'], lang: 'fr' }),
  ]);
  assert.equal(n, 3, 'the count is what it always was: the posts handed in');
  const rows = await db.query<{ item_id: string; body: string; lang: string; first_seen_at: Date; counters_observed_at: Date; format_ids: string[] }>(
    `select item_id, body, lang, first_seen_at, counters_observed_at, format_ids from public.item order by item_id`,
  );
  assert.equal(rows.length, 2);
  const one = rows.find((r) => r.item_id === 'x:1')!;
  assert.equal(one.body, 'edited words');
  assert.equal(one.lang, 'fr');
  assert.equal(new Date(one.first_seen_at).getTime(), T - 10 * MIN, 'first sighting kept');
  assert.equal(new Date(one.counters_observed_at).getTime(), T - 5 * MIN, 'last sighting\'s counters time');
  assert.deepEqual(one.format_ids, ['sound:1', 'fx:2']);
  const fps = await db.query<{ n: string }>(`select count(*)::text as n from public.item_fingerprint where item_id = 'x:1'`);
  assert.equal(Number(fps[0]?.n), 1);
  const authors = await db.query<{ author_key: string; first_seen_at: Date; last_seen_at: Date }>(`select author_key, first_seen_at, last_seen_at from public.author order by author_key`);
  assert.deepEqual(authors.map((a) => a.author_key), ['x:alice', 'x:bob']);
  const alice = authors[0]!;
  assert.equal(new Date(alice.first_seen_at).getTime(), T - 10 * MIN);
  assert.equal(new Date(alice.last_seen_at).getTime(), T - 5 * MIN);

  /* A later call updates as before and never moves the first sighting. */
  await repo.upsert([post(1, 'alice', 'third words', T)]);
  const again = await db.query<{ body: string; first_seen_at: Date }>(`select body, first_seen_at from public.item where item_id = 'x:1'`);
  assert.equal(again[0]?.body, 'third words');
  assert.equal(new Date(again[0]!.first_seen_at).getTime(), T - 10 * MIN);
});

test('★ accounts in one call: each once, first seen at its first sighting, the latest handle, name, followers and picture a read carried, a read with none keeping the known one; each profile text once', async () => {
  const { PgAuthorRepo } = await import('@insidor/store');
  const db = await migratedDb();
  const repo = new PgAuthorRepo(db);
  const a = (seen: number, x: Partial<import('@insidor/contracts').Author>) => ({ authorKey: authorKey(X, 'carol'), source: X, firstSeenAt: seen as Millis, handle: null, ...x }) as never;
  await repo.upsert([
    a(T - 10 * MIN, { handle: 'carol_old', displayName: 'Carol', audience: { value: 100, fidelity: { kind: 'exact' }, observedAt: (T - 10 * MIN) as Millis }, pictureUri: 'https://p/1.jpg', bio: 'hello' }),
    a(T - 5 * MIN, { handle: 'carol_new', bio: 'hello' }),
    a(T - 2 * MIN, { handle: null, bio: 'bye' }),
  ]);
  const rows = await db.query<{ handle: string; display_name: string; follower_count: string; picture_url: string; first_seen_at: Date; last_seen_at: Date }>(
    `select handle, display_name, follower_count::text as follower_count, picture_url, first_seen_at, last_seen_at from public.author`,
  );
  assert.equal(rows.length, 1);
  const r = rows[0]!;
  assert.equal(r.handle, 'carol_new');
  assert.equal(r.display_name, 'Carol', 'a read with no name kept the known one');
  assert.equal(r.follower_count, '100');
  assert.equal(r.picture_url, 'https://p/1.jpg');
  assert.equal(new Date(r.first_seen_at).getTime(), T - 10 * MIN);
  assert.equal(new Date(r.last_seen_at).getTime(), T - 2 * MIN);
  const bios = await db.query<{ bio: string; first_read_at: Date; last_read_at: Date }>(`select bio, first_read_at, last_read_at from internal.author_bio_reading order by bio`);
  assert.deepEqual(bios.map((b) => [b.bio, new Date(b.first_read_at).getTime(), new Date(b.last_read_at).getTime()]), [['bye', T - 2 * MIN, T - 2 * MIN], ['hello', T - 10 * MIN, T - 5 * MIN]]);
});
