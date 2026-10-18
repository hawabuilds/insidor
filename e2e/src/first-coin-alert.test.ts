/**
 * A STARRED NARRATIVE'S FIRST COIN on the real schema (PGlite, every migration), through the
 * pipeline pass and the deliverer: one push to each starrer, once, never for a coin it already had
 * when they starred it, never for an unsure one, the switch respected, and not doubled by the
 * board's own coin alerts. Nothing is fetched and nothing is sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { deliverQueued, type Db } from '@insidor/notify/deliver.ts';
import { checkPipeline } from '@insidor/notify/pipeline.ts';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.notify;
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

test('★ a starred narrative\'s first coin: one push to each starrer, once; not for a coin it already had, not for an unsure one', async () => {
  const db = await setup();
  const sent: string[] = [];
  const push: PushSender = { configured: true, publicKey: 'PUB', send: async (_t, m) => (sent.push(m.title), 'sent') };
  for (const u of ['u1', 'u2', 'u3']) {
    await db.query('insert into people.profile (user_id, name) values ($1, $1)', [u]);
    await db.query(`insert into people.push_subscription (endpoint, user_id, p256dh, auth) values ($1, $2, 'p', 'a')`, [`https://push.example/${u}`, u]);
  }
  await page(db, 'pancake', { coins: { kind: 'pending' } });
  await page(db, 'old', { coins: { kind: 'one', coin: { address: 'Old111', ticker: 'OLD' } } });
  await page(db, 'shady', { coins: { kind: 'none' } });
  assert.equal(await checkPipeline(db, { policy: P }), 0, 'the first look remembers and sends nothing');

  /* u1 and u2 star Pancake; u3 stars a narrative whose coin it already had, and one that gets only unsure coins. */
  await db.query(`insert into people.watch (user_id, story_id) values ('u1', 'pancake'), ('u2', 'pancake'), ('u3', 'old'), ('u3', 'shady')`);
  assert.equal(await checkPipeline(db, { policy: P }), 0, 'starring a narrative that already has its coin is not its first coin');

  await page(db, 'shady', { coins: { kind: 'unsure', claimCount: 2 }, topCoin: { address: 'Shady1' } });
  await page(db, 'pancake', { coins: { kind: 'one', coin: { address: MINT, ticker: 'PANCAKE' } } });
  assert.equal(await checkPipeline(db, { policy: P }), 2, 'the two starrers of Pancake; nothing for unsure coins');
  const queued = await db.query<{ userId: string; kind: string; href: string }>('select user_id as "userId", kind, href from people.alert_queue order by user_id');
  assert.deepEqual(queued, [
    { userId: 'u1', kind: 'starred_first_coin', href: '/#/story/pancake' },
    { userId: 'u2', kind: 'starred_first_coin', href: '/#/story/pancake' },
  ]);

  /* The coin goes away and comes back, and a second coin lands: neither is a first coin again. */
  await page(db, 'pancake', { coins: { kind: 'unsure', claimCount: 1 } });
  assert.equal(await checkPipeline(db, { policy: P }), 0);
  await page(db, 'pancake', { coins: { kind: 'several', coins: [{ address: MINT, ticker: 'PANCAKE' }, { address: 'Two111', ticker: 'TWO' }] } });
  assert.equal(await checkPipeline(db, { policy: P }), 0);

  const out = (await deliverQueued({ db, push, pushOn: true, policy: P, now: () => NOW })).map((o) => o.outcome);
  assert.deepEqual(out, ['push', 'push']);
  assert.deepEqual(sent, ['Narrative pancake has its first coin: $PANCAKE', 'Narrative pancake has its first coin: $PANCAKE']);
});

test('the switch is respected: off, the first coin is neither listed nor pushed', async () => {
  const db = await setup();
  await db.query(`insert into people.profile (user_id, name) values ('u1', 'u1')`);
  await db.query(`insert into people.alert_prefs (user_id, prefs) values ('u1', $1)`, [JSON.stringify({ on: { starredFirstCoin: false } })]);
  await page(db, 'pancake', { coins: { kind: 'none' } });
  await checkPipeline(db, { policy: P });
  await db.query(`insert into people.watch (user_id, story_id) values ('u1', 'pancake')`);
  await page(db, 'pancake', { coins: { kind: 'one', coin: { address: MINT, ticker: 'PANCAKE' } } });
  assert.equal(await checkPipeline(db, { policy: P }), 1);
  assert.deepEqual((await deliverQueued({ db, push: { configured: false, publicKey: null, send: async () => 'sent' as const }, pushOn: false, policy: P, now: () => NOW })).map((o) => o.outcome), ['off']);
});

test('★ on the board, the starrer hears of the first coin once: the board\'s own coin alerts leave them out', async () => {
  const db = await setup();
  for (const u of ['u1', 'u2']) await db.query('insert into people.profile (user_id, name) values ($1, $1)', [u]);
  const board = async (id: string, coins: unknown) => {
    await db.query(`insert into public.story (story_id, earliest_post_at, state, promoted_at, origin) values ($1, now(), 'promoted', now(), 'observed') on conflict (story_id) do nothing`, [id]);
    await page(db, id, { coins });
    await db.query(`insert into public.board_row (view_id, story_id, position, payload) values ('default', $1, 0, '{}') on conflict do nothing`, [id]);
  };
  await board('pancake', { kind: 'none' });
  await checkPipeline(db, { policy: P });
  await db.query(`insert into people.watch (user_id, story_id) values ('u1', 'pancake')`);
  await board('pancake', { kind: 'one', coin: { address: MINT, ticker: 'PANCAKE' } });
  await checkPipeline(db, { policy: P });
  const kinds = (await db.query<{ userId: string; kind: string }>('select user_id as "userId", kind from people.alert_queue')).map((r) => `${r.userId}:${r.kind}`).sort();
  assert.deepEqual(kinds, ['u1:starred_first_coin', 'u2:narrative_coin']);
});
