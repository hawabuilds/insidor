/**
 * `PgChartRepo.listed` holds the window's watch and pick rows and catches them up: it answers what
 * the single statement over both tables did (watched since, or picked and written since, two days
 * before now), while after the first read only the rows stamped since the newest held cross the wire.
 *
 * Against a fake `Db` holding both tables in memory and answering by the bound given.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgChartRepo } from './coin-chart.ts';

const DAY = 86_400_000;
const T = 1_800_000_000_000;

test('listed answers like the whole read, and after the first read sends only the newly stamped rows', async () => {
  const watch: { address: string; since: number }[] = [
    { address: 'W1', since: T - 3 * DAY },
    ...Array.from({ length: 50 }, (_, i) => ({ address: `old${i}`, since: T - DAY - (i + 10) * 60_000 })),
    { address: 'W2', since: T - DAY },
  ];
  const picks: { item_id: string; address: string | null; outcome: string; updated: number }[] = [
    { item_id: 'p1', address: 'P1', outcome: 'picked', updated: T - 1_000 },
    { item_id: 'p2', address: 'P2', outcome: 'waiting', updated: T - 1_000 },
    { item_id: 'p3', address: 'P3', outcome: 'picked', updated: T - 3 * DAY },
  ];
  let sent = 0;
  const db = {
    query: async <R>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
      const after = new Date(params[0] as string).getTime();
      const rows = sql.includes('internal.coin_watch')
        ? watch.filter((w) => w.since >= after).map((w) => ({ address: w.address, at: w.since }))
        : picks.filter((p) => p.updated >= after).map((p) => ({ item_id: p.item_id, address: p.address, picked: p.outcome === 'picked', at: p.updated }));
      sent += rows.length;
      return rows as R[];
    },
  } as unknown as Db;
  /* The statement it replaces, over the same tables. */
  const whole = (now: number) =>
    new Set([...watch.filter((w) => w.since >= now - 2 * DAY).map((w) => w.address), ...picks.filter((p) => p.outcome === 'picked' && p.updated >= now - 2 * DAY).map((p) => p.address as string)]);

  const repo = new PgChartRepo(db);
  assert.deepEqual(await repo.listed(T), whole(T));
  assert.equal(sent, 53);
  /* Nothing new: only each table's newest rows (those within the overlap) again. */
  sent = 0;
  assert.deepEqual(await repo.listed(T + 60_000), whole(T + 60_000));
  assert.equal(sent, 3);
  /* A new watch, a pick that stops being picked, and one that starts. */
  watch.push({ address: 'W3', since: T + 100_000 });
  picks[0] = { ...picks[0]!, outcome: 'dropped', updated: T + 100_000 };
  picks[1] = { ...picks[1]!, outcome: 'picked', updated: T + 100_000 };
  assert.deepEqual(await repo.listed(T + 120_000), whole(T + 120_000));
  /* A day and a half later W2 has aged out, as the whole read says. */
  assert.deepEqual(await repo.listed(T + 1.5 * DAY), whole(T + 1.5 * DAY));
  assert.ok(!(await repo.listed(T + 1.5 * DAY)).has('W2'));
});
