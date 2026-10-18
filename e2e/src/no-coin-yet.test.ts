/**
 * THE NARRATIVES TAB'S "NO COIN YET" PILL on the real schema (PGlite, every migration), through the
 * read route: only narratives searched and found with no coin (never one still being checked, never
 * one with unsure coins or a top coin), on New, Most viewed and the ranked sorts, with the site pill.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from '@insidor/notify/deliver.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { handle } from '@insidor/read/src/routes.ts';

import { migratedDb } from './db.ts';

const NOW = Date.now();
const MINT = 'Pan1111111111111111111111111111111111pump';

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  await db.query(`insert into public.board_view (view_id, tick, provenance) values ('default', 1, '{}')`);
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  return db;
}

/** A narrative's page as the projector writes it: observed, its site, its coins and top coin. */
async function page(db: Db, id: string, o: { coins: unknown; topCoin?: unknown; site?: string; views?: number; minutesAgo?: number; day?: number }) {
  const payload = {
    id,
    title: `Narrative ${id}`,
    provenance: { kind: 'observed' },
    evidence: [{ sourceLabel: o.site ?? 'X' }],
    coins: o.coins,
    topCoin: o.topCoin ?? null,
    viewsGainedDay: o.day === undefined ? null : { v: o.day },
  };
  await db.query(
    `insert into public.story_view (story_id, payload, found_at, views_total, dead) values ($1, $2, $3, $4, false)
     on conflict (story_id) do update set payload = excluded.payload`,
    [id, JSON.stringify(payload), new Date(NOW - (o.minutesAgo ?? 1) * 60_000).toISOString(), o.views ?? 100],
  );
}

const read = async (db: Db, path: string) => {
  const r = await handle('GET', path, { db: { query: (s: string, p: readonly unknown[]) => db.query(s, p) }, log: SILENT } as never);
  return { status: r.status, ids: ((JSON.parse(r.body) as { stories?: { id: string }[] }).stories ?? []).map((s) => s.id) };
};

test('★ No coin yet: only narratives searched and found with none, on every sort, with the site pill', async () => {
  const db = await setup();
  await page(db, 'none-x', { coins: { kind: 'none' }, minutesAgo: 1, views: 50, day: 5 });
  await page(db, 'none-tiktok', { coins: { kind: 'none' }, site: 'TikTok', minutesAgo: 2, views: 900, day: 9 });
  await page(db, 'checking', { coins: { kind: 'pending' }, day: 7 });
  await page(db, 'unsure', { coins: { kind: 'unsure', claimCount: 3 }, topCoin: { address: MINT }, day: 8 });
  await page(db, 'top-only', { coins: { kind: 'none' }, topCoin: { address: MINT }, day: 6 });
  await page(db, 'coined', { coins: { kind: 'one', coin: { address: MINT, ticker: 'PANCAKE' } }, day: 10 });

  assert.deepEqual((await read(db, '/narratives/default/all?sort=new&coin=none')).ids, ['none-x', 'none-tiktok']);
  assert.deepEqual((await read(db, '/narratives/default/all?sort=viewed&coin=none')).ids, ['none-tiktok', 'none-x']);
  assert.deepEqual((await read(db, '/narratives/default/all?sort=today&coin=none')).ids, ['none-tiktok', 'none-x']);
  assert.deepEqual((await read(db, '/narratives/default/all?sort=new&on=tiktok&coin=none')).ids, ['none-tiktok']);
  assert.deepEqual((await read(db, '/narratives/default/all?sort=today&on=x&coin=none')).ids, ['none-x']);
  assert.equal((await read(db, '/narratives/default/all?sort=new')).ids.length, 6, 'without the pill, every narrative');
  assert.equal((await read(db, '/narratives/default/all?sort=new&coin=unsure')).status, 400);
});
