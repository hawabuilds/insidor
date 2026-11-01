/**
 * `bestMatches` with `onlyWithVector` (Policy.group.image.matchOnlyWithVector): the same answer as
 * without it for a post with a vector and for one without, and the story list is never sent for a
 * post with none. Against a fake `Db` that answers the match query only when the post's vector is
 * in its table, as Postgres does (the query starts from the post's own row).
 *
 * Why it exists: the switch is a cost cut that must change nothing. If the probe's predicate ever
 * drifts from the match query's `a` row (another space, another subject kind), a post with a vector
 * would be answered "no matches" — this test is where that shows.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ItemId, StoryId } from '@insidor/contracts/ids.ts';

import type { Db } from '../client.ts';
import { PgImageEmbeddingRepo } from './image-embeddings.ts';

const SPACE = 's1';
/** Vectors on file: (subject id, space). */
const vectors = new Set(['x:with|s1', 'x:other-space|s2']);

function fakeDb() {
  const sent: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = {
    query: async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      sent.push({ sql, params });
      const has = vectors.has(`${String(params[0])}|${String(sql.includes('m.story_id = any') ? params[2] : params[1])}`);
      if (sql.includes('select 1 as one')) return (has ? [{ one: 1 }] : []) as R[];
      if (sql.includes('m.story_id = any')) {
        if (!has) return [];
        return (params[1] as string[]).filter((id) => id !== 'story:empty').map((id) => ({ story_id: id, similarity: 0.9, item_uri: 'https://i/a.jpg', member_uri: `https://i/${id}.jpg` })) as R[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  };
  return { db, sent };
}

const block = ['story:a', 'story:b', 'story:empty'] as StoryId[];
const answer = async (item: string, space: string, onlyWithVector?: boolean) => {
  const { db, sent } = fakeDb();
  const map = await new PgImageEmbeddingRepo(db).bestMatches(item as ItemId, block, space, onlyWithVector === undefined ? {} : { onlyWithVector });
  return { map: Object.fromEntries(map), sent };
};

test('the same answer with the probe on and off, for a post with a vector and one without', async () => {
  for (const [item, space] of [['x:with', SPACE], ['x:without', SPACE], ['x:other-space', SPACE], ['x:other-space', 's2']] as const) {
    const before = await answer(item, space);
    const after = await answer(item, space, true);
    assert.deepEqual(after.map, before.map, `${item} in ${space}`);
  }
  assert.equal(Object.keys((await answer('x:with', SPACE, true)).map).length, 2, 'a post with a vector is still matched');
});

test('the story list is sent only for a post with a vector in the space', async () => {
  const without = await answer('x:without', SPACE, true);
  assert.equal(without.sent.length, 1);
  assert.equal(without.sent.some((s) => s.params.some((p) => Array.isArray(p))), false, 'no story id leaves for a post with no vector');
  assert.deepEqual(without.sent[0]?.params, ['x:without', SPACE]);

  const other = await answer('x:other-space', SPACE, true);
  assert.equal(other.sent.length, 1, 'a vector in another space is not a vector in this one');

  const withVector = await answer('x:with', SPACE, true);
  assert.equal(withVector.sent.length, 2);
  assert.deepEqual(withVector.sent[1]?.params, ['x:with', block, SPACE], 'the match query is sent unchanged');

  const off = await answer('x:without', SPACE);
  assert.equal(off.sent.length, 1);
  assert.deepEqual(off.sent[0]?.params, ['x:without', block, SPACE], 'off: the list is sent as before');
});

test('an empty block asks nothing, probe or not', async () => {
  const { db, sent } = fakeDb();
  const map = await new PgImageEmbeddingRepo(db).bestMatches('x:with' as ItemId, [], SPACE, { onlyWithVector: true });
  assert.equal(map.size, 0);
  assert.equal(sent.length, 0);
});
