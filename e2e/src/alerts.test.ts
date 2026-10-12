/**
 * ALERTS AGAINST THE REAL SCHEMA: the deliverer and the pipeline check on an in-process Postgres
 * with the people migrations applied, a recorded push service, and recorded projection frames.
 * Nothing is fetched and nothing is sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { ALERT_KINDS, defaultPrefs, type AlertKind } from '@insidor/core';
import { deliverQueued, queue, type Db } from '@insidor/notify/deliver.ts';
import { checkPipeline } from '@insidor/notify/pipeline.ts';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.notify;

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const sent: { endpoint: string; title: string }[] = [];
  const push: PushSender = { configured: true, publicKey: 'PUB', send: async (t, m) => (sent.push({ endpoint: t.endpoint, title: m.title }), 'sent') };
  for (const u of ['u1', 'u2']) {
    await db.query('insert into people.profile (user_id, name) values ($1, $1)', [u]);
    await db.query(`insert into people.push_subscription (endpoint, user_id, p256dh, auth) values ($1, $2, 'p', 'a')`, [`https://push.example/${u}`, u]);
  }
  const deps = { db, push, pushOn: true, policy: P, now: () => Date.UTC(2026, 9, 12, 12) };
  const prefs = (u: string, change: Record<string, unknown>) => db.query('insert into people.alert_prefs (user_id, prefs) values ($1, $2) on conflict (user_id) do update set prefs = excluded.prefs', [u, JSON.stringify({ ...defaultPrefs(P), ...change })]);
  const q = (userId: string, kind: AlertKind, subject: string, rung = 0) => queue(db, { userId, kind, subject, rung, facts: { symbol: 'FERRY', multiple: rung, title: 'Ferry horn' }, href: '/#/' });
  const run = async () => (await deliverQueued(deps)).map((o) => o.outcome);
  return { db, sent, prefs, q, run };
}

test('★ every alert type fires once per level: the same level again is dropped', async () => {
  const { prefs, q, run, db } = await setup();
  await prefs('u1', { on: { ...defaultPrefs(P).on, watchlist: true }, perHour: P.maxPerHour });
  for (const kind of ALERT_KINDS) {
    const rung = kind === 'holding_multiple' || kind === 'watchlist_multiple' ? 5 : 0;
    await q('u1', kind, `s-${kind}`, rung);
    await q('u1', kind, `s-${kind}`, rung);
  }
  const outcomes = await run();
  for (let i = 0; i < ALERT_KINDS.length; i += 1) {
    assert.notEqual(outcomes[i * 2], 'already', `${ALERT_KINDS[i]} fires the first time`);
    assert.equal(outcomes[i * 2 + 1], 'already', `${ALERT_KINDS[i]} does not fire twice`);
  }
  const [n] = await db.query<{ n: number }>('select count(*)::int as n from people.alert where user_id = $1', ['u1']);
  assert.equal(n?.n, ALERT_KINDS.length, 'one list row per alert');
});

test('a multiple spends the levels below it: 2x never fires after 5x', async () => {
  const { q, run } = await setup();
  await q('u1', 'holding_multiple', 'MINT', 5);
  await run();
  await q('u1', 'holding_multiple', 'MINT', 2);
  assert.deepEqual(await run(), ['already']);
});

test('★ switching an alert type off stops it — no list row, no push, and its level is not spent', async () => {
  const { prefs, q, run, db, sent } = await setup();
  await prefs('u1', { on: { ...defaultPrefs(P).on, rising: false } });
  await q('u1', 'rising_post', 'x:1');
  assert.deepEqual(await run(), ['off']);
  assert.equal(sent.length, 0);
  assert.equal((await db.query('select 1 from people.alert')).length, 0);
  await prefs('u1', {});
  await q('u1', 'rising_post', 'x:1');
  assert.deepEqual(await run(), ['push'], 'switched back on, the same post can still reach them');
});

test('★ the hourly limit holds: past it, alerts are listed and not pushed', async () => {
  const { prefs, q, run, sent } = await setup();
  await prefs('u1', { perHour: 2 });
  for (const s of ['a', 'b', 'c', 'd']) await q('u1', 'narrative_promoted', s);
  assert.deepEqual(await run(), ['push', 'push', 'hourly-limit', 'hourly-limit']);
  assert.equal(sent.length, 2);
});

test('a rank-up is listed only; mute stops everything', async () => {
  const { prefs, q, run } = await setup();
  await q('u1', 'rank_up', 'analyst', 1);
  await prefs('u2', { muted: true });
  await q('u2', 'follow', 'someone');
  assert.deepEqual(await run(), ['list-only', 'muted']);
});

test('★ pipeline alerts: the first look alerts on nothing; then a new rising post, a promoted narrative and its first coin go to everyone, the coin to its watchers too', async () => {
  const { db, run } = await setup();
  await db.query(`insert into public.board_view (view_id, tick, provenance) values ('default', 1, '{}')`);
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  const story = async (id: string, state: string, coins: unknown) => {
    await db.query(`insert into public.story (story_id, earliest_post_at, state, promoted_at, origin) values ($1, now(), $2, case when $2 = 'promoted' then now() end, 'observed')`, [id, state]);
    await db.query(`insert into public.story_view (story_id, payload) values ($1, $2)`, [id, JSON.stringify({ title: `Story ${id}`, coins })]);
    await db.query(`insert into public.board_row (view_id, story_id, position, payload) values ('default', $1, 0, '{}')`, [id]);
  };
  const rising = (id: string) => db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', $1, 0, $2)`, [id, JSON.stringify({ sourceLabel: 'X', authorLabel: '@a', reach: { v: 41_000 }, storyId: null })]);
  await story('st_old', 'promoted', { kind: 'none' });
  await rising('x:old');
  assert.equal(await checkPipeline(db), 0, 'the board as it already was is not news');

  await db.query(`insert into people.watch (user_id, story_id) values ('u2', 'st_new')`);
  await story('st_new', 'promoted', { kind: 'one', coin: { address: 'FerryHorn1111111111111111111111111111111pump', ticker: 'FERRY' } });
  await rising('x:new');
  assert.equal(await checkPipeline(db), 2 + 2 + 2 + 1, 'rising and promoted and first coin to both people, the match to the watcher');
  const kinds = (await db.query<{ userId: string; kind: string }>('select user_id as "userId", kind from people.alert_queue order by queue_id')).map((r) => `${r.userId}:${r.kind}`);
  assert.deepEqual(kinds.sort(), ['u1:narrative_coin', 'u1:narrative_promoted', 'u1:rising_post', 'u2:coin_matched', 'u2:narrative_coin', 'u2:narrative_promoted', 'u2:rising_post']);
  assert.equal(await checkPipeline(db), 0, 'and the next pass finds nothing new');
  assert.ok((await run()).every((o) => o === 'push'));
});
