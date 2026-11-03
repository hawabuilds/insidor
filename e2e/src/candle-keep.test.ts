/**
 * ★ A MINUTE CANDLE LEAVES THE DATABASE ONLY ONCE ITS DAY IS COPIED (0163; the owner, 2026-11-03: "i want
 * to keep candles never delete"). Real schema (PGlite), the real repo: chainwatch's weekly prune deletes
 * an old minute row only when its UTC day is in internal.candle_archive_day; a day not copied stays
 * however old, and recent rows stay whatever is copied.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import { PgChartRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-03T01:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const COIN = `KEEP${'1'.repeat(36)}pump`;

let db: Db;

before(async () => {
  db = await migratedDb();
  await db.query(`insert into internal.chart_coin (address, recorded_from, from_launch, last_trade_at, pool) values ($1, $2, true, $3, 'pump')`, [COIN, iso(NOW - 20 * DAY), iso(NOW)]);
  /* Three minutes on each of four days: 12 and 11 days old (old), 10 days old (old), today (recent). */
  for (const daysAgo of [12, 11, 10, 0]) {
    const dayStart = Date.parse(new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10) + 'T00:00:00Z');
    for (const m of [0, 1, 2]) {
      await db.query(
        `insert into internal.coin_candle_1m (coin_id, bucket, o, h, l, c, volume_usd, buys, sells, o_ms, c_ms)
         select id, $2, 1, 2, 0.5, 1.5, 10, 1, 1, 0, 59000 from internal.chart_coin where address = $1`,
        [COIN, iso(dayStart + m * 60_000)],
      );
    }
  }
});

const days = async (): Promise<string[]> =>
  (await db.query<{ d: string }>(`select distinct to_char(bucket at time zone 'UTC', 'YYYY-MM-DD') as d from internal.coin_candle_1m order by 1`)).map((r) => r.d);

test('★ nothing is deleted while no day is copied, however old', async () => {
  const repo = new PgChartRepo(db);
  assert.equal(await repo.prune(NOW - 7 * DAY, 1_000), 0);
  assert.deepEqual(await days(), ['2026-10-22', '2026-10-23', '2026-10-24', '2026-11-03']);
});

test('★ only the copied old day leaves; an old day not copied and a recent copied day stay', async () => {
  await db.query(`insert into internal.candle_archive_day (day, rows, parts, bytes, folder) values ('2026-10-23', 3, 1, 100, 'x'), ('2026-11-03', 3, 1, 100, 'x')`);
  const repo = new PgChartRepo(db);
  assert.equal(await repo.prune(NOW - 7 * DAY, 1_000), 3);
  assert.deepEqual(await days(), ['2026-10-22', '2026-10-24', '2026-11-03']);
});
