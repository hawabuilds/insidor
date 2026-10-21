/**
 * `PgLabelEmbeddingRepo.all` reads the labels whole and a vector only when its row was written
 * since this repo read it (`updated_at`), so a relabel or a new vector shows and an unchanged one
 * does not cross the wire again. Against a fake `Db` answering by statement text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgLabelEmbeddingRepo } from './label-embeddings.ts';

test('a label vector is read once per updated_at', async () => {
  const table = new Map([
    ['x:1', { label: 'meme', at: 't1', v: [1, 0] }],
    ['x:2', { label: 'not', at: 't1', v: [0, 1] }],
  ]);
  let vectors = 0;
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('embedding::text')) {
        const ids = (params?.[1] ?? []) as string[];
        vectors += ids.length;
        return ids.map((id) => ({ item_id: id, embedding: `[${table.get(id)?.v.join(',')}]`, updated_at: table.get(id)?.at }) as R);
      }
      return [...table].map(([item_id, r]) => ({ item_id, label: r.label, label_kind: 'tap', text: '', why: null, picture: null, updated_at: r.at }) as R);
    },
  };
  const repo = new PgLabelEmbeddingRepo(db);
  const read = async () => (await repo.all('s')).map((l) => `${l.itemId}:${l.label}:${Array.from(l.values).join(',')}`);

  assert.deepEqual(await read(), ['x:1:meme:1,0', 'x:2:not:0,1']);
  assert.equal(vectors, 2);
  assert.deepEqual(await read(), ['x:1:meme:1,0', 'x:2:not:0,1']);
  assert.equal(vectors, 2);
  table.set('x:2', { label: 'meme', at: 't2', v: [0.6, 0.8] });
  assert.deepEqual(await read(), ['x:1:meme:1,0', 'x:2:meme:0.6000000238418579,0.800000011920929']);
  assert.equal(vectors, 3);
  table.delete('x:1');
  assert.deepEqual(await read(), ['x:2:meme:0.6000000238418579,0.800000011920929']);
});
