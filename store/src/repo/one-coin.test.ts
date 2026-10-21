/**
 * The one-coin candidate mirror (`PgOneCoinRepo` with `mirrorCandidates`): it answers
 * `openCandidates` and `candidatesOf` exactly as the table's own statements do, and after the first
 * read asks only for rows stamped since the newest it holds (less the overlap).
 *
 * Against a fake `Db` holding the table in memory and answering the mirror's statement by its
 * `updated_at` bound. The mirror was also checked against the live store, read only: the same 6,536
 * open rows, ~94 KB a catch-up read where the table's statement returned ~2 MB.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgOneCoinRepo } from './one-coin.ts';

interface Row { item_id: string; address: string; path: 'launch' | 'existing'; evidence: Record<string, unknown>; launched_at: string | null; found_at: string; updated: number }

function fakeDb(table: Row[]): { db: Db; bounds: (number | null)[] } {
  const bounds: (number | null)[] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (!sql.includes('from internal.one_coin_candidate')) throw new Error(`unexpected statement: ${sql}`);
      const bound = (params?.[0] ?? null) as number | null;
      bounds.push(bound);
      return table.filter((r) => bound === null || r.updated >= bound).map((r) => ({ ...r, u: r.updated }) as R);
    },
  } as Db;
  return { db, bounds };
}

const at = (ms: number): string => new Date(ms).toISOString();

test('the mirror answers like the table and catches up by updated_at', async () => {
  const T = 1_800_000_000_000;
  const table: Row[] = [
    { item_id: 'x:old', address: 'A', path: 'launch', evidence: { ties: ['name'] }, launched_at: at(T - 7_200_000), found_at: at(T - 7_200_000), updated: T - 7_200_000 },
    { item_id: 'x:1', address: 'B', path: 'launch', evidence: { ties: ['link'] }, launched_at: at(T - 60_000), found_at: at(T - 60_000), updated: T - 60_000 },
    { item_id: 'x:1', address: 'C', path: 'existing', evidence: { ties: ['existing'] }, launched_at: null, found_at: at(T - 7_000_000), updated: T - 7_000_000 },
    { item_id: 'x:2', address: 'D', path: 'launch', evidence: { ties: ['picture'] }, launched_at: at(T - 30_000), found_at: at(T - 30_000), updated: T - 30_000 },
  ];
  const { db, bounds } = fakeDb(table);
  const repo = new PgOneCoinRepo(db, { mirrorCandidates: true });

  const since = T - 3_600_000;
  const open = await repo.openCandidates(since, 10);
  /* Newest find first; x:1 brings its older coin too; x:old has nothing open. */
  assert.deepEqual(open.map((r) => `${r.itemId}/${r.address}`), ['x:2/D', 'x:1/B', 'x:1/C']);
  assert.deepEqual((await repo.openCandidates(since, 1)).map((r) => r.itemId), ['x:2']);
  assert.equal(bounds[0], null);
  /* After the first read, only rows stamped since the newest held, less ten minutes. */
  assert.equal(bounds[1], T - 30_000 - 600_000);

  /* A widened row and a new post arrive; both are seen. */
  const one = table[1];
  if (one !== undefined) {
    one.evidence = { ties: ['link', 'picture'] };
    one.updated = T + 1_000;
  }
  table.push({ item_id: 'x:3', address: 'E', path: 'launch', evidence: {}, launched_at: at(T + 2_000), found_at: at(T + 2_000), updated: T + 2_000 });
  const again = await repo.openCandidates(since, 10);
  assert.deepEqual(again.map((r) => `${r.itemId}/${r.address}`), ['x:3/E', 'x:2/D', 'x:1/B', 'x:1/C']);
  assert.deepEqual(again.find((r) => r.address === 'B')?.evidence, { ties: ['link', 'picture'] });

  assert.deepEqual((await repo.candidatesOf(['x:old', 'x:none'])).map((r) => r.address), ['A']);
});

test('without the mirror every read goes to the table', async () => {
  const { db, bounds } = fakeDb([]);
  const repo = new PgOneCoinRepo(db);
  await repo.openCandidates(0, 10);
  await repo.openCandidates(0, 10);
  assert.equal(bounds.length, 2);
});
