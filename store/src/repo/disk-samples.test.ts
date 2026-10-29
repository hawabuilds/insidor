/**
 * `PgDiskSampleRepo.sample` stores the rows read since its previous sample (0153): per statement,
 * writes left out, only positive differences counted (a reset or an evicted statement never lowers
 * the hour), unknown (NULL) on the first sample and without access, and the size alone before 0153.
 *
 * Against a fake `Db` answering the statements by their text.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgDiskSampleRepo } from './disk-samples.ts';

function fakeDb(stats: { id: string; q: string | null; n: number }[], opts: { noColumn?: boolean; noStats?: boolean } = {}): { db: Db; written: unknown[][] } {
  const written: unknown[][] = [];
  const db = {
    query: async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      if (sql.includes('pg_database_size')) return [{ at: new Date(Date.UTC(2026, 9, 29, 10)), db: '1000' }] as R[];
      if (sql.includes('storage.objects')) return [{ bytes: '0' }] as R[];
      if (sql.includes('pg_stat_statements')) {
        if (opts.noStats === true) throw Object.assign(new Error('permission denied'), { code: '42501' });
        return stats.map((s) => ({ id: s.id, q: s.q, n: String(s.n) })) as R[];
      }
      if (sql.includes('insert into internal.disk_sample')) {
        if (opts.noColumn === true && sql.includes('read_rows')) throw Object.assign(new Error('no column'), { code: '42703' });
        written.push([...params]);
        return [];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as unknown as Db;
  return { db, written };
}

test('the hour\'s read rows are the per-statement growth of the reads since the last sample', async () => {
  const stats = [
    { id: 'a', q: 'select item_id from public.item', n: 100 },
    { id: 'b', q: 'insert into internal.decisions', n: 500 },
    { id: 'c', q: null, n: 10 },
  ];
  const { db, written } = fakeDb(stats);
  const repo = new PgDiskSampleRepo(db);
  assert.equal((await repo.sample()).readRows, null);
  stats[0]!.n = 160;
  stats[1]!.n = 900;
  /* `c` evicted and back with fewer rows than before: never negative (its few rows since are not counted). */
  stats[2]!.n = 4;
  stats.push({ id: 'd', q: '  WITH x as (select 1) select * from x', n: 7 });
  assert.equal((await repo.sample()).readRows, 60 + 0 + 0 + 7);
  assert.deepEqual(written.map((w) => w[3]), [null, 67]);
});

test('without access to the statistics the hour is unknown; before 0153 the size alone is written', async () => {
  const blind = fakeDb([], { noStats: true });
  const repo = new PgDiskSampleRepo(blind.db);
  await repo.sample();
  assert.equal((await repo.sample()).readRows, null);
  const old = fakeDb([{ id: 'a', q: 'select 1', n: 1 }], { noColumn: true });
  await new PgDiskSampleRepo(old.db).sample();
  assert.deepEqual(old.written, [[new Date(Date.UTC(2026, 9, 29, 10)), '1000', '0']]);
});
