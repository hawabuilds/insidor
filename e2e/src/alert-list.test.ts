/**
 * THE ALERT LIST'S PAGES AGAINST THE REAL SCHEMA: GET /alerts driven through the notify routes on
 * an in-process Postgres with every migration applied and a stand-in sign-in. It proves the two
 * sides (Feed and Notifications) page apart, a page never repeats a row, the cursor is null only
 * at the end, and the bell counts every unread notification whatever page is on screen.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Person } from '@insidor/contracts/ports/people.ts';
import { handle } from '@insidor/notify/routes.ts';
import type { Db } from '@insidor/notify/deliver.ts';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.notify;
const ME: Person = { userId: 'did:privy:me', handle: 'me', name: 'Me', pictureUrl: null, wallets: [] };
const BASE = Date.UTC(2026, 9, 12, 12);

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const deps = {
    db,
    identity: { verify: async (t: string) => (t === ME.userId ? ME : null) },
    push: { configured: false, publicKey: null, send: async () => 'sent' as const },
    pushOn: false,
    policy: P,
    now: () => BASE,
    pace: () => true,
  };
  const get = async (q: string) => {
    const r = await handle({ method: 'GET', url: `/alerts${q}`, body: null, token: ME.userId, client: 't' }, deps as never);
    return { status: r.status, body: JSON.parse(r.body) as { unread: number; bell: number; seenAt: number; cursor: string | null; alerts: { id: number; kind: string; at: number }[] } };
  };
  await db.query('insert into people.profile (user_id, name) values ($1, $2)', [ME.userId, 'Me']);
  const add = (kind: string, minute: number, href = '/#/', subject = `s${minute}`) =>
    db.query(`insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery, at) values ($1, $2, $3, 0, 't', 'b', $4, '{}', 'push', $5)`, [ME.userId, kind, subject, href, new Date(BASE - minute * 60_000).toISOString()]);
  return { db, get, add };
}

test('★ Notifications page twenty at a time, with no row twice and no empty last page', async () => {
  const { get, add } = await setup();
  for (let i = 0; i < 45; i += 1) await add(i % 3 === 0 ? 'follow' : 'graduated', i);
  for (let i = 0; i < 5; i += 1) await add('rising_post', 100 + i);
  const seen = new Set<number>();
  let cursor: string | null = null;
  const sizes: number[] = [];
  do {
    const r = await get(`?list=notifications${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    assert.equal(r.status, 200);
    for (const a of r.body.alerts) {
      assert.ok(!seen.has(a.id), 'no row twice');
      assert.notEqual(a.kind, 'rising_post', 'a Feed row is not a notification');
      seen.add(a.id);
    }
    assert.equal(r.body.bell, 45, 'the bell counts every unread notification, not the page');
    sizes.push(r.body.alerts.length);
    cursor = r.body.cursor;
  } while (cursor !== null);
  assert.deepEqual(sizes, [20, 20, 5]);
});

test('the Feed pages its own side, by tab: Rising takes rising posts inside its window, Watching the starred narratives', async () => {
  const { db, get, add } = await setup();
  await add('rising_post', 1, '/#/story/st_a');
  await add('rising_post', 60 * 24 * 9, '/#/');
  await add('narrative_promoted', 2, '/#/story/st_a', 'st_a');
  await add('narrative_promoted', 3, '/#/story/st_b', 'st_b');
  await add('coin_matched', 4, '/#/story/st_c', 'st_c|MINT');
  await add('graduated', 5);
  await db.query('insert into people.watch (user_id, story_id) values ($1, $2)', [ME.userId, 'st_a']);
  const kinds = async (q: string) => (await get(q)).body.alerts.map((a) => a.kind);
  assert.deepEqual(await kinds('?list=feed&tab=latest'), ['rising_post', 'narrative_promoted', 'narrative_promoted', 'coin_matched', 'rising_post']);
  assert.deepEqual(await kinds(`?list=feed&tab=rising&since=${BASE - 7 * 86_400_000}`), ['rising_post'], 'the week leaves out the older post');
  assert.deepEqual(await kinds('?list=feed&tab=rising'), ['rising_post', 'rising_post']);
  assert.deepEqual(await kinds('?list=feed&tab=watching'), ['rising_post', 'narrative_promoted', 'coin_matched']);
  const all = await get('');
  assert.equal(all.body.cursor, null, 'the old list has no pages');
  assert.equal(all.body.alerts.length, 6);
  assert.equal(all.body.bell, 1);
  assert.equal((await get('?list=feed&tab=nope')).status, 400);
  assert.equal((await get('?list=notifications&cursor=junk')).status, 400);
});
