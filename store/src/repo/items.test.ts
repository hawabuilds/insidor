/**
 * `PgItemRepo.trackingFacts` reads each promoted story's members once, not once per asked post in
 * it (the product that made it the largest row count the database served). These tests hold the
 * assembly: the asked posts' stories, every member of each, and the judgements read for all.
 *
 * Against a fake `Db` that answers by statement text, as everywhere in this package. The SQL itself
 * was checked against the live store, read only: the same story and member pairs, 55,774 rows
 * before and 3,627 after for one day's posts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ItemId } from '@insidor/contracts/ids.ts';

import type { Db } from '../client.ts';
import { PgItemRepo } from './items.ts';

test('admittedSince and byIds read a post whole only when its version changed', async () => {
  /* Checked against the live store, read only: the same 3,000 posts in the same order with the
     same words, counters, media and fingerprints, ~138 KB a read once held where it was ~3.2 MB. */
  const table = new Map([
    ['x:1', { v: '10/1', body: 'one' }],
    ['x:2', { v: '11/0', body: 'two' }],
  ]);
  const whole: string[][] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('as v from public.item where first_seen_at')) return [...table].map(([item_id, r]) => ({ item_id, v: r.v }) as R);
      if (sql.includes('as v from public.item where item_id = any($1::text[])') && !sql.includes('body')) {
        const ids = (params?.[0] ?? []) as string[];
        return ids.flatMap((id) => (table.has(id) ? [{ item_id: id, v: table.get(id)?.v } as R] : []));
      }
      if (sql.includes('body')) {
        const ids = (params?.[0] ?? []) as string[];
        whole.push(ids);
        return ids.map((id) => ({
          item_id: id, source: 'x', source_item_id: id.slice(2), origin: 'live', author_key: 'x:a', posted_at: null, first_seen_at: new Date(1000),
          lang: null, body: table.get(id)?.body, media: [], counters: {}, rebroadcast_of: null, reproduction_of: null, format_ids: [], raw_ref: 'r', v: table.get(id)?.v,
        }) as R);
      }
      if (sql.includes('from public.item_fingerprint')) return [{ item_id: 'x:1', kind: 'textShingle', key: 'k1' }] as R[];
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as Db;
  const repo = new PgItemRepo(db);
  const page = async () => (await repo.admittedSince(0 as never, 10)).map((i) => `${i.itemId}:${i.text}:${i.fingerprints.length}`);

  assert.deepEqual(await page(), ['x:1:one:1', 'x:2:two:0']);
  assert.deepEqual(whole, [['x:1', 'x:2']]);
  assert.deepEqual(await page(), ['x:1:one:1', 'x:2:two:0']);
  assert.equal(whole.length, 1, 'nothing changed, nothing read whole');
  table.set('x:2', { v: '12/0', body: 'two, edited' });
  assert.deepEqual(await page(), ['x:1:one:1', 'x:2:two, edited:0']);
  assert.deepEqual(whole[1], ['x:2']);
  const byIds = await repo.byIds(['x:2', 'x:gone'] as ItemId[]);
  assert.deepEqual([...byIds.values()].map((i) => i.text), ['two, edited']);
  assert.equal(whole.length, 2, 'byIds served the held post');
});

test('trackingFacts: stories of the asked posts and every member, each once', async () => {
  let judgedFor: readonly string[] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('from unnest($1::text[]) as i(id)')) return [];
      if (sql.includes("'own' as kind")) {
        /* x:1 and x:2 are both in st_a (members x:1, x:2, x:3); x:2 is also in st_b (x:2, x:9). */
        return [
          { kind: 'own', story_id: 'st_a', item_id: 'x:1' },
          { kind: 'own', story_id: 'st_a', item_id: 'x:2' },
          { kind: 'own', story_id: 'st_b', item_id: 'x:2' },
          { kind: 'member', story_id: 'st_a', item_id: 'x:1' },
          { kind: 'member', story_id: 'st_a', item_id: 'x:2' },
          { kind: 'member', story_id: 'st_a', item_id: 'x:3' },
          { kind: 'member', story_id: 'st_b', item_id: 'x:2' },
          { kind: 'member', story_id: 'st_b', item_id: 'x:9' },
        ] as R[];
      }
      if (sql.includes('from internal.post_judgement')) {
        judgedFor = (params?.[0] ?? []) as string[];
        return [];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as Db;
  const facts = await new PgItemRepo(db).trackingFacts(['x:1', 'x:2', 'x:7'] as ItemId[]);
  assert.deepEqual(Object.fromEntries(facts.storiesOf), { 'x:1': ['st_a'], 'x:2': ['st_a', 'st_b'] });
  assert.deepEqual(Object.fromEntries(facts.membersOf), { st_a: ['x:1', 'x:2', 'x:3'], st_b: ['x:2', 'x:9'] });
  assert.deepEqual([...judgedFor].sort(), ['x:1', 'x:2', 'x:3', 'x:7', 'x:9']);
});

test('trackingFacts: the post question\'s answer, the kind that holds it and the owner\'s call, each kept apart', async () => {
  let asked = '';
  const db: Db = {
    query: async <R>(sql: string): Promise<R[]> => {
      if (sql.includes('from unnest($1::text[]) as i(id)')) return [];
      if (sql.includes("'own' as kind")) return [];
      if (sql.includes('from internal.post_judgement')) {
        asked = sql;
        return [
          /* A yes, then the close-match hold filed after it (x:1); a plain no (x:2); never judged, called a meme (x:3); nothing (x:4). */
          { item_id: 'x:1', coinable: true, confidence: '0.85', looked_at: 'picture', proposed_name: 'CAT', kind_label: 'NOT_MEME_MATCH', owner_call: null },
          { item_id: 'x:2', coinable: false, confidence: '0.9', looked_at: 'text', proposed_name: null, kind_label: null, owner_call: null },
          { item_id: 'x:3', coinable: null, confidence: null, looked_at: null, proposed_name: null, kind_label: null, owner_call: 'meme' },
          { item_id: 'x:4', coinable: null, confidence: null, looked_at: null, proposed_name: null, kind_label: null, owner_call: null },
        ] as R[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as Db;
  const facts = await new PgItemRepo(db).trackingFacts(['x:1', 'x:2', 'x:3', 'x:4'] as ItemId[]);
  assert.match(asked, /prompt_id not like 'post-kind%'/, 'the answer is never a kind answer');
  assert.deepEqual(facts.judged.get('x:1'), { coinable: true, confidence: 0.85, lookedAt: 'picture', proposedName: 'CAT' }, 'the yes stands beside its hold');
  assert.equal(facts.kindOf.get('x:1'), 'NOT_MEME_MATCH');
  assert.equal(facts.judged.get('x:2')?.coinable, false);
  assert.equal(facts.judged.has('x:3'), false, 'never judged is absent, not a no');
  assert.equal(facts.ownerCall.get('x:3'), 'meme');
  assert.equal(facts.judged.has('x:4') || facts.kindOf.has('x:4') || facts.ownerCall.has('x:4'), false);
});
