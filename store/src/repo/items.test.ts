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
