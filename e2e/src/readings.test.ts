/**
 * VIEW READINGS AGAINST THE REAL SCHEMA (0090): an opened sheet recorded by the social service only
 * for a post a feed holds and at most once a minute per post; the runner's list of For You's posts
 * and opened posts, each with the time of its newest reading; the newest reading of each counter;
 * and an open cleared only by a read that came after it.
 *
 * The pass that decides and reads is tested with stand-ins in services/runner/src/work/readings.test.ts;
 * this is the SQL under it, which those stand-ins cannot check.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { observationsFrom } from '@insidor/core';
import { handle, type Db as SocialDb } from '@insidor/social';
import { PgObservationRepo, PgReadingsRepo, type Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const T0 = Date.UTC(2026, 9, 16, 12);
const MIN = 60_000;

async function setup() {
  const db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:1', 'x', '1', 'poster')`);
  for (const id of ['fyp', 'scroll', 'gone']) {
    await db.query(`insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, raw_ref, origin) values ($1, 'x', $2, 'x:1', $3, $3, 'r', 'observed')`, [`x:${id}`, id, new Date(T0 - 30 * MIN)]);
  }
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  await db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', 'x:fyp', 0, '{}')`);
  await db.query(`insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at) values ('fyp', 'x:scroll', $1, $1, '{}', $1)`, [new Date(T0 - 60 * MIN)]);
  let clock = T0;
  const deps = {
    db: db as unknown as SocialDb,
    identity: { verify: async () => null },
    chain: null,
    policy: DEFAULT_POLICY.social,
    now: () => clock,
    pace: () => true,
  };
  const open = async (itemId: string) => {
    const r = await handle({ method: 'POST', url: `/post/${encodeURIComponent(itemId)}/reading`, body: null, token: null, client: 'test' }, deps);
    return { status: r.status, body: JSON.parse(r.body) as Record<string, unknown> };
  };
  return { db, open, tick: (ms: number) => void (clock += ms) };
}

const read = async (db: Db, itemId: string, at: number, views: number) =>
  new PgObservationRepo(db).append(
    observationsFrom(itemId as never, { reach: { value: views, fidelity: { kind: 'exact' }, observedAt: at as Millis }, approval: { value: views / 10, fidelity: { kind: 'exact' }, observedAt: at as Millis } }, {}, at as Millis, DEFAULT_POLICY.kinetics),
  );

test('★ an open is recorded signed out, only for a post a feed holds, and once a minute per post', async () => {
  const { db, open, tick } = await setup();
  assert.deepEqual(await open('x:fyp'), { status: 202, body: { asked: true } });
  assert.deepEqual(await open('x:scroll'), { status: 202, body: { asked: true } }, 'a post on the infinite scroll is on a feed');
  assert.deepEqual(await open('x:gone'), { status: 202, body: { asked: false } }, 'on no feed: nothing written');
  assert.equal((await open('not an id')).status, 400);

  tick(30_000);
  assert.deepEqual((await open('x:fyp')).body, { asked: false }, 'a second open inside the minute is the same ask');
  tick(DEFAULT_POLICY.feed.readings.openReadMinGapMs);
  assert.deepEqual((await open('x:fyp')).body, { asked: true });
  const rows = await db.query<{ item_id: string; asked_at: Date }>(`select item_id, asked_at from internal.reading_ask order by item_id`);
  assert.deepEqual(rows.map((r) => [r.item_id, new Date(r.asked_at).getTime()]), [
    ['x:fyp', T0 + 30_000 + DEFAULT_POLICY.feed.readings.openReadMinGapMs],
    ['x:scroll', T0],
  ]);
});

test('★ the runner lists For You and the opened posts, each with its newest reading of any counter', async () => {
  const { db, open } = await setup();
  await read(db, 'x:fyp', T0 - 5 * MIN, 1_000);
  await read(db, 'x:fyp', T0 - 2 * MIN, 3_000);
  await open('x:scroll');
  const repo = new PgReadingsRepo(db);
  const list = await repo.candidates(new Date(T0 - MIN));
  const byId = new Map(list.map((c) => [c.itemId, c]));
  assert.deepEqual([...byId.keys()].sort(), ['x:fyp', 'x:scroll']);
  assert.deepEqual(byId.get('x:fyp'), { itemId: 'x:fyp', source: 'x', sourceItemId: 'fyp', handle: 'poster', postedAt: T0 - 30 * MIN, lastReadAt: T0 - 2 * MIN, onForYou: true, openedAt: null });
  assert.equal(byId.get('x:scroll')?.onForYou, false);
  assert.equal(byId.get('x:scroll')?.lastReadAt, null, 'never read is null, never zero');
  assert.equal(byId.get('x:scroll')?.openedAt, T0);
  assert.deepEqual((await repo.candidates(new Date(T0 + MIN))).map((c) => c.itemId), ['x:fyp'], 'an open older than the window is not listed');
  assert.deepEqual((await repo.candidates(new Date(T0), true)).map((c) => c.itemId), ['x:fyp']);

  const latest = await new PgObservationRepo(db).latestForItems(['x:fyp' as never, 'x:scroll' as never]);
  assert.deepEqual(
    (latest.get('x:fyp' as never) ?? []).map((o) => [o.kind, o.counter.value]).sort(),
    [['approval', 300], ['reach', 3_000]],
  );
  assert.equal(latest.has('x:scroll' as never), false);
});

test('★ a read clears only the opens asked before it; old opens expire', async () => {
  const { db, open, tick } = await setup();
  await open('x:fyp');
  const repo = new PgReadingsRepo(db);
  assert.equal(await repo.answered(['x:fyp'], new Date(T0 - 1)), 0, 'asked after the read went out: still owed');
  assert.equal(await repo.answered(['x:fyp'], new Date(T0)), 1);
  await open('x:scroll');
  tick(5 * MIN);
  assert.equal(await repo.expire(new Date(T0 + MIN)), 1);
  assert.equal((await db.query(`select 1 from internal.reading_ask`)).length, 0);
});
