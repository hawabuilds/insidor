/**
 * `PgObservationRepo.seriesForItems` holds each post's series and catches it up: after the first
 * read only the readings after the newest held cross the wire, and a post whose count in the
 * window disagrees with the table (post-slim's delete, a late reading) is read whole again. The
 * answer is the one the single statement gave.
 *
 * Against a fake `Db` holding readings in memory and answering the three statements by their text.
 * Also checked against the live store, read only: the same 32,949 readings for 400 posts on four
 * passes, ~15 KB a catch-up where the statement returned ~5.9 MB.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { ItemId } from '@insidor/contracts/ids.ts';

import type { Db } from '../client.ts';
import { PgObservationRepo } from './observations.ts';

interface Reading { item_id: string; kind: string; at: number }

function fakeDb(table: Reading[]): { db: Db; returned: () => number } {
  let returned = 0;
  const row = (r: Reading) => ({
    item_id: r.item_id, kind: r.kind, captured_at: new Date(r.at), value: 1, fidelity_kind: 'exact', fidelity_digits: null,
    observed_at: new Date(r.at), lag_ms: null, rate_per_min: null, censored: 'no_prior', rate_over_ms: null, rate_level: null, rate_last_level: null,
  });
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (sql.includes('unnest($1::text[], $2::float8[])')) {
        const ids = (params?.[0] ?? []) as string[];
        const after = (params?.[1] ?? []) as number[];
        const rows = table.filter((r) => ids.some((id, i) => id === r.item_id && r.at > (after[i] ?? 0))).map(row);
        returned += rows.length;
        return rows as R[];
      }
      if (sql.includes('count(*)::int as n')) {
        const ids = (params?.[0] ?? []) as string[];
        const since = new Date(params?.[1] as string).getTime();
        return ids.map((id) => ({ item_id: id, n: table.filter((r) => r.item_id === id && r.at >= since).length }) as R).filter((r) => (r as { n: number }).n > 0);
      }
      if (sql.includes('from public.observation') && sql.includes('item_id = any($1::text[]) and captured_at >= $2')) {
        const ids = (params?.[0] ?? []) as string[];
        const since = new Date(params?.[1] as string).getTime();
        const rows = table.filter((r) => ids.includes(r.item_id) && r.at >= since).sort((a, b) => a.item_id.localeCompare(b.item_id) || a.at - b.at).map(row);
        returned += rows.length;
        return rows as R[];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as Db;
  return { db, returned: () => returned };
}

const T = 1_800_000_000_000;
const flat = (m: ReadonlyMap<ItemId, readonly { kind: string; capturedAt: number }[]>) =>
  Object.fromEntries([...m].map(([k, v]) => [k, v.map((o) => `${o.kind}@${o.capturedAt - T}`)]));

test('a held series is caught up with new readings only, and re-read when its count disagrees', async () => {
  const table: Reading[] = [
    { item_id: 'x:1', kind: 'reach', at: T },
    { item_id: 'x:1', kind: 'approval', at: T },
    { item_id: 'x:1', kind: 'reach', at: T + 60_000 },
  ];
  const { db, returned } = fakeDb(table);
  const repo = new PgObservationRepo(db);
  const ids = ['x:1', 'x:2'] as ItemId[];

  assert.deepEqual(flat(await repo.seriesForItems(ids, T as Millis)), { 'x:1': ['reach@0', 'approval@0', 'reach@60000'] });
  assert.equal(returned(), 3);

  /* A new reading: only it crosses the wire; x:2's first reading arrives too. */
  table.push({ item_id: 'x:1', kind: 'reach', at: T + 120_000 }, { item_id: 'x:2', kind: 'reach', at: T + 120_000 });
  assert.deepEqual(flat(await repo.seriesForItems(ids, T as Millis)), { 'x:1': ['reach@0', 'approval@0', 'reach@60000', 'reach@120000'], 'x:2': ['reach@120000'] });
  assert.equal(returned(), 5);

  /* A later window is served from what is held. */
  assert.deepEqual(flat(await repo.seriesForItems(['x:1'] as ItemId[], (T + 60_000) as Millis)), { 'x:1': ['reach@60000', 'reach@120000'] });
  assert.equal(returned(), 5);

  /* A reading deleted (post-slim): the count disagrees and the post is read whole. */
  table.splice(2, 1);
  assert.deepEqual(flat(await repo.seriesForItems(['x:1'] as ItemId[], T as Millis)), { 'x:1': ['reach@0', 'approval@0', 'reach@120000'] });

  /* A late reading older than the newest held: the count disagrees and the post is read whole. */
  table.push({ item_id: 'x:1', kind: 'approval', at: T + 90_000 });
  assert.deepEqual(flat(await repo.seriesForItems(['x:1'] as ItemId[], T as Millis)), { 'x:1': ['reach@0', 'approval@0', 'approval@90000', 'reach@120000'] });

  /* An earlier window than held is read whole. */
  table.push({ item_id: 'x:1', kind: 'reach', at: T - 60_000 });
  assert.deepEqual(flat(await repo.seriesForItems(['x:1'] as ItemId[], (T - 60_000) as Millis))['x:1']?.[0], 'reach@-60000');
});
