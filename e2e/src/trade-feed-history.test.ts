/**
 * The trade record (0064) and the hourly feed history (0065) on the real schema: a trade's row
 * moves built → sent → confirmed and never back; a bad address writes nothing; the feed history
 * keeps an hour's first position and best position, and prunes by age. PGlite, real migrations.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { recordFeedHistory } from '@insidor/store';

import { migratedDb } from './db.ts';

const ID = 'a'.repeat(64);
const ME = 'Me11111111111111111111111111111111111111111';
const COIN = 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP';
const SIG = '5'.repeat(88);

test('a trade is recorded at build, send and landing, and a settled row never moves back', async () => {
  const db = await migratedDb();
  await db.query(`select public.record_trade_built($1,$2,'buy','curve',$3,null,1000000,248401937865,1030000,300,0,null,true,null)`, [ID, ME, COIN]);
  await db.query(`select public.record_trade_built($1,'not-a-wallet','buy','curve',$2,null,1,1,1,300,0,null,true,null)`, ['b'.repeat(64), COIN]);
  await db.query(`select public.record_trade_sent($1,$2,$3,null)`, [ID, ME, SIG]);
  await db.query(`select public.record_trade_settled($1,$2,true,null)`, [ID, SIG]);
  await db.query(`select public.record_trade_sent($1,$2,$3,null)`, [ID, ME, SIG]);
  const rows = await db.query<{ status: string; kind: string; in_amount: string; out_amount: string; signature: string }>(
    `select status, kind, in_amount::text, out_amount::text, signature from public.trade`,
  );
  assert.deepEqual(rows, [{ status: 'confirmed', kind: 'buy', in_amount: '1000000', out_amount: '248401937865', signature: SIG }]);
});

test('a send the service never built still gets a row; a refused send says why', async () => {
  const db = await migratedDb();
  await db.query(`select public.record_trade_sent($1,$2,null,'blockhash not found')`, [ID, ME]);
  const rows = await db.query<{ status: string; kind: string | null; error: string }>(`select status, kind, error from public.trade`);
  assert.deepEqual(rows, [{ status: 'send_fail', kind: null, error: 'blockhash not found' }]);
});

test('the feed history keeps each hour\'s first and best position, and prunes old hours', async () => {
  const db = await migratedDb();
  const hour = Date.parse('2026-10-13T14:00:00Z');
  /* The projector calls it inside its frame's transaction; so does this. */
  const inFrame = async (nowMs: number) => {
    await db.query('begin');
    const out = await recordFeedHistory(db, nowMs);
    await db.query('commit');
    return out;
  };
  await db.query(`insert into public.rising_view (feed_id, tick, projected_at) values ('fyp', 1, now())`);
  await db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', 'x:1', 3, '{}'), ('fyp', 'x:2', 0, '{}')`);
  assert.equal((await inFrame(hour + 60_000)).kind, 'recorded');
  await db.query(`update public.rising_row set position = 0 where item_id = 'x:1'`);
  await db.query(`update public.rising_row set position = 5 where item_id = 'x:2'`);
  await inFrame(hour + 120_000);
  const rows = await db.query<{ item_id: string; first_position: number; best_position: number; first_seen_at: string }>(
    `select item_id, first_position, best_position, to_char(first_seen_at at time zone 'UTC', 'HH24:MI') as first_seen_at from internal.feed_history order by item_id`,
  );
  assert.deepEqual(rows, [
    { item_id: 'x:1', first_position: 3, best_position: 0, first_seen_at: '14:01' },
    { item_id: 'x:2', first_position: 0, best_position: 0, first_seen_at: '14:01' },
  ]);
  await inFrame(hour + 15 * 24 * 3_600_000);
  const hours = await db.query<{ n: string }>(`select count(distinct hour)::text as n from internal.feed_history`);
  assert.equal(hours[0]?.n, '1', 'the old hour is pruned, the new one kept');
});
