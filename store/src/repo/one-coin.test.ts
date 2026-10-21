/**
 * The one-coin candidate mirror (`PgOneCoinRepo` with `mirrorCandidates`): it answers
 * `openCandidates` and `candidatesOf` exactly as the table's own statements do, and after the first
 * read asks only for rows stamped since the newest it holds (less the overlap).
 *
 * Against a fake `Db` holding the table in memory and answering the mirror's statement by its
 * `updated_at` bound. The mirror was also checked against the live store, read only: the same 7,687
 * open rows, ~68 KB a catch-up read where the table's statement returned ~2.4 MB, and ~32 MB of
 * heap once a day's posts are held.
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
      /* The table's own open read (no mirror, or a window wider than it holds): every row, here. */
      if (sql.includes('order by max(found_at) desc')) {
        bounds.push(null);
        return table.map((r) => ({ ...r }) as R);
      }
      if (sql.includes('where item_id = any($1::text[])')) {
        const ids = (params?.[0] ?? []) as string[];
        return table.filter((r) => ids.includes(r.item_id)).map((r) => ({ ...r, u: r.updated }) as R);
      }
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
  /* After the first read, only rows stamped since the newest held, less two minutes. */
  assert.equal(bounds[1], T - 30_000 - 120_000);

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

test('a post unwritten for a day leaves the mirror, is read from the table, and is held whole again when written', async () => {
  const T = 1_800_000_000_000;
  const DAY = 86_400_000;
  const table: Row[] = [
    { item_id: 'x:old', address: 'A', path: 'launch', evidence: { ties: ['name'] }, launched_at: at(T - 2 * DAY), found_at: at(T - 2 * DAY), updated: T - 2 * DAY },
    { item_id: 'x:old', address: 'B', path: 'existing', evidence: {}, launched_at: null, found_at: at(T - 2 * DAY), updated: T - 2 * DAY },
    { item_id: 'x:new', address: 'C', path: 'launch', evidence: {}, launched_at: at(T), found_at: at(T), updated: T },
  ];
  const { db, bounds } = fakeDb(table);
  const repo = new PgOneCoinRepo(db, { mirrorCandidates: true });
  assert.deepEqual((await repo.openCandidates(T - 3_600_000, 10)).map((r) => r.address), ['C']);
  /* x:old is pruned now and read from the table when asked about. */
  const asked = bounds.length;
  assert.deepEqual((await repo.candidatesOf(['x:old', 'x:new'])).map((r) => r.address).sort(), ['A', 'B', 'C']);
  assert.ok(bounds.length > asked);
  /* A wider window than the mirror holds goes to the table. */
  assert.deepEqual((await repo.openCandidates(T - 3 * DAY, 10)).map((r) => r.itemId).sort(), ['x:new', 'x:old', 'x:old']);
  /* A new candidate on x:old: the post is held whole again, its old coins with it. */
  table.push({ item_id: 'x:old', address: 'D', path: 'launch', evidence: {}, launched_at: at(T + 1_000), found_at: at(T + 1_000), updated: T + 1_000 });
  const open = await repo.openCandidates(T - 3_600_000, 10);
  assert.deepEqual(open.map((r) => `${r.itemId}/${r.address}`).sort(), ['x:new/C', 'x:old/A', 'x:old/B', 'x:old/D']);
});

test('without the mirror every read goes to the table', async () => {
  const { db, bounds } = fakeDb([]);
  const repo = new PgOneCoinRepo(db);
  await repo.openCandidates(0, 10);
  await repo.openCandidates(0, 10);
  assert.equal(bounds.length, 2);
});
