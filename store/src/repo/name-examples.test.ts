/**
 * The namer's example read (`PgNameExampleRepo.all`) keeps vectors and words between reads: each vector
 * crosses the wire once per `embedded_at`, each example's words once per digest, and what the caller
 * gets is the same as a full read.
 *
 * Against a fake `Db` holding the two tables in memory, which is this package's posture: no test
 * here asks a runner for a database. The fake tells the statements apart by their text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgNameExampleRepo } from './name-examples.ts';

interface Tables {
  examples: { item_id: string; text: string; name: string; ticker: string; rejected: boolean }[];
  vectors: Map<string, { at: string; v: number[] }>;
}

function fakeDb(t: Tables): { db: Db; vectorRows: () => number; wordRows: () => number } {
  let vectorRows = 0;
  let wordRows = 0;
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('from internal.name_example e')) {
        /* The digest read gives each example's digest; the whole read, `$2`'s examples with theirs. */
        const only = sql.includes('any($2::text[])') ? new Set((params?.[1] ?? []) as string[]) : null;
        const items = [...new Set(t.examples.map((e) => e.item_id))].filter((id) => t.vectors.has(id) && (only === null || only.has(id)));
        const rows = items.map((id) => {
          const mine = t.examples.filter((e) => e.item_id === id);
          return {
            item_id: id,
            text: mine[0]?.text ?? '',
            seen: null,
            coins: mine.filter((e) => !e.rejected).map((e) => ({ name: e.name, ticker: e.ticker })),
            not_coins: mine.some((e) => e.rejected) ? mine.filter((e) => e.rejected).map((e) => ({ name: e.name, ticker: e.ticker })) : null,
            posted_at: null,
            embedded_at: t.vectors.get(id)?.at,
          };
        });
        const withDigest = rows.map((r) => ({ ...r, d: JSON.stringify(r) }));
        if (only === null) return withDigest.map(({ item_id, d }) => ({ item_id, d }) as R);
        wordRows += withDigest.length;
        return withDigest as R[];
      }
      if (sql.includes('from internal.name_example_embedding where space')) {
        const ids = (params?.[1] ?? []) as string[];
        const rows = ids.flatMap((id) => {
          const v = t.vectors.get(id);
          return v === undefined ? [] : [{ item_id: id, embedding: `[${v.v.join(',')}]`, embedded_at: v.at } as R];
        });
        vectorRows += rows.length;
        return rows;
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as Db;
  return { db, vectorRows: () => vectorRows, wordRows: () => wordRows };
}

test('a vector is read once per embedded_at, and a re-embed is read again', async () => {
  const t: Tables = {
    examples: [
      { item_id: 'x:1', text: 'one', name: 'One', ticker: 'ONE', rejected: false },
      { item_id: 'x:2', text: 'two', name: 'Two', ticker: 'TWO', rejected: false },
    ],
    vectors: new Map([
      ['x:1', { at: 't1', v: [1, 0] }],
      ['x:2', { at: 't1', v: [0, 1] }],
    ]),
  };
  const { db, vectorRows, wordRows } = fakeDb(t);
  const repo = new PgNameExampleRepo(db);

  const first = await repo.all('s');
  assert.equal(wordRows(), 2);
  assert.equal(vectorRows(), 2);
  assert.deepEqual([...first.map((e) => [e.itemId, Array.from(e.values)])], [['x:1', [1, 0]], ['x:2', [0, 1]]]);

  /* A new example and a flipped "no": only the new post's vector is read, and only those two posts' words. */
  t.examples.push({ item_id: 'x:3', text: 'three', name: 'Three', ticker: 'THR', rejected: false });
  t.vectors.set('x:3', { at: 't2', v: [1, 1] });
  const e2 = t.examples[1];
  if (e2 !== undefined) e2.rejected = true;
  const second = await repo.all('s');
  assert.equal(vectorRows(), 3);
  assert.equal(wordRows(), 4, 'x:2 (flipped) and x:3 (new) read whole; x:1 from its digest');
  assert.deepEqual(second.map((e) => e.itemId), ['x:1', 'x:2', 'x:3']);
  assert.deepEqual(second[1]?.notCoins, [{ name: 'Two', ticker: 'TWO' }]);
  assert.deepEqual(second[1]?.coins, []);

  /* Re-embedded: a new embedded_at, so the new vector is read and served. */
  t.vectors.set('x:1', { at: 't3', v: [0.5, 0.5] });
  const third = await repo.all('s');
  assert.equal(vectorRows(), 4);
  assert.deepEqual(Array.from(third[0]?.values ?? []), [0.5, 0.5]);

  /* Nothing changed: no vector and no words cross the wire, only digests. */
  const words = wordRows();
  await repo.all('s');
  assert.equal(vectorRows(), 4);
  assert.equal(wordRows(), words);
});

test('a post whose vector is gone is no longer an example', async () => {
  const t: Tables = {
    examples: [{ item_id: 'x:1', text: 'one', name: 'One', ticker: 'ONE', rejected: false }],
    vectors: new Map([['x:1', { at: 't1', v: [1] }]]),
  };
  const { db } = fakeDb(t);
  const repo = new PgNameExampleRepo(db);
  assert.equal((await repo.all('s')).length, 1);
  t.vectors.delete('x:1');
  assert.equal((await repo.all('s')).length, 0);
});
