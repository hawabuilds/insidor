/**
 * `heldPostVectors`: a post vector crosses the wire once per `embedded_at`, a re-embed is read
 * again, and a post with no row is absent. Against a fake `Db` answering by statement text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { forgetHeldPostVectors, heldPostVectors } from './post-vectors.ts';

test('post vectors are read once per embedded_at', async () => {
  forgetHeldPostVectors();
  const table = new Map([
    ['x:1', { at: 't1', v: [1, 0] }],
    ['x:2', { at: 't1', v: [0, 1] }],
  ]);
  let read = 0;
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      const ids = ((params?.[0] ?? []) as string[]).filter((id) => table.has(id));
      if (sql.includes('embedding::text')) {
        read += ids.length;
        return ids.map((id) => ({ item_id: id, v: `[${table.get(id)?.v.join(',')}]`, at: table.get(id)?.at }) as R);
      }
      return ids.map((id) => ({ item_id: id, at: table.get(id)?.at }) as R);
    },
  };
  const get = async (ids: string[]) => Object.fromEntries([...(await heldPostVectors(db, ids, 's'))].map(([k, v]) => [k, Array.from(v)]));

  assert.deepEqual(await get(['x:1', 'x:2', 'x:none']), { 'x:1': [1, 0], 'x:2': [0, 1] });
  assert.equal(read, 2);
  assert.deepEqual(await get(['x:1', 'x:2']), { 'x:1': [1, 0], 'x:2': [0, 1] });
  assert.equal(read, 2);
  table.set('x:2', { at: 't2', v: [0.5, 0.5] });
  assert.deepEqual(await get(['x:2']), { 'x:2': [0.5, 0.5] });
  assert.equal(read, 3);
  forgetHeldPostVectors();
});
