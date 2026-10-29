/**
 * `seenKeys` (seen.ts): a stream's seen set is read whole once, then only from the newest `seen_at`
 * held less two minutes, and always answers the table's whole set; each caller gets its own copy.
 *
 * Against a fake `Db` holding people.pipeline_seen in memory.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from './deliver.ts';
import { seenKeys } from './seen.ts';

test('a stream is read whole once, then only its newly stamped keys', async () => {
  const table: { stream: string; key: string; at: number }[] = [
    { stream: 'launch', key: '#seeded', at: 1_000_000 },
    { stream: 'launch', key: 'a', at: 2_000_000 },
    { stream: 'other', key: 'z', at: 2_000_000 },
  ];
  const sent: number[] = [];
  const db = {
    query: async <R>(_sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      const [stream, after] = params as [string, number | null];
      const rows = table.filter((r) => r.stream === stream && (after === null || r.at >= after)).map((r) => ({ key: r.key, at: r.at }));
      sent.push(rows.length);
      return rows as R[];
    },
  } as unknown as Db;
  const first = await seenKeys(db, 'launch');
  assert.deepEqual([...first].sort(), ['#seeded', 'a']);
  first.delete('#seeded');
  assert.deepEqual([...(await seenKeys(db, 'launch'))].sort(), ['#seeded', 'a']);
  table.push({ stream: 'launch', key: 'b', at: 2_500_000 });
  assert.deepEqual([...(await seenKeys(db, 'launch'))].sort(), ['#seeded', 'a', 'b']);
  /* Whole, then the newest held and anything within the overlap, then the same again with the new key. */
  assert.deepEqual(sent, [2, 1, 2]);
  /* Another database holds its own sets. */
  const other = { query: async () => [] } as unknown as Db;
  assert.equal((await seenKeys(other, 'launch')).size, 0);
});
