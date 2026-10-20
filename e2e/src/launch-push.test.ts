/**
 * ★ THE ONE PUSH (notify launch.ts, the owner 2026-10-20) on the real schema (PGlite, every
 * migration), through the launch check and the deliverer: a busy pass meets the daily cap and the
 * biggest coins get through; a narrative picking a coin a post already pushed is not pushed again; a
 * coin older than the post's first showing on For You is not pushed, and nor is that post's later
 * coin. Nothing is fetched and nothing is sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { deliverQueued, type Db } from '@insidor/notify/deliver.ts';
import { checkLaunches } from '@insidor/notify/launch.ts';

import { migratedDb } from './db.ts';

const P = DEFAULT_POLICY.notify;
const MIN = 60_000;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const mint = (i: number) => `Coin${i}`.padEnd(40, '1');

async function setup() {
  const db = (await migratedDb()) as unknown as Db;
  const sent: string[] = [];
  const push: PushSender = { configured: true, publicKey: 'PUB', send: async (_t, m) => (sent.push(m.title), 'sent') };
  await db.query(`insert into people.profile (user_id, name) values ('u1', 'u1')`);
  await db.query(`insert into people.push_subscription (endpoint, user_id, p256dh, auth) values ('https://push.example/u1', 'u1', 'p', 'a')`);
  /* A post first on For You an hour ago; its card's coin as the projector writes a pick. */
  const post = async (id: string, coin: { address: string; ticker: string; cap: number; launchedAgoMin: number } | null) => {
    const coins = coin === null ? { kind: 'none' } : { kind: 'matched', coin: { address: coin.address, ticker: coin.ticker, marketCapUsd: { v: coin.cap }, mintedAt: { at: NOW - coin.launchedAgoMin * MIN } }, evidence: { picked: true } };
    await db.query(
      `insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at) values ('fyp', $1, $2, $3, $4, $3)
       on conflict (feed_id, item_id) do update set payload = excluded.payload`,
      [id, iso(NOW - 60 * MIN), iso(NOW), JSON.stringify({ authorLabel: `@${id}`, excerpt: `Post ${id}`, coins })],
    );
  };
  const launches = () => checkLaunches(db, { policy: P, now: () => NOW, onPick: true });
  const deliver = async () => (await deliverQueued({ db, push, pushOn: true, policy: P, now: () => NOW })).map((o) => o.outcome);
  return { db, sent, post, launches, deliver };
}

test('★ a busy pass meets the daily cap: the biggest coins are pushed, the rest listed', async () => {
  const { db, sent, post, launches, deliver } = await setup();
  /* The hourly limit (six by default) is the person's own; raised here so the day's cap is what is tested. */
  await db.query(`insert into people.alert_prefs (user_id, prefs) values ('u1', '{"perHour": 60}')`);
  assert.equal(await launches(), 0, 'the first look');
  const n = P.launch.perDay + 1;
  for (let i = 1; i <= n; i++) await post(`x:${i}`, { address: mint(i), ticker: `C${i}`, cap: i * 10_000, launchedAgoMin: 10 });
  assert.equal(await launches(), n);
  const out = await deliver();
  assert.deepEqual(out, [...Array(P.launch.perDay).fill('push'), 'daily-limit']);
  assert.equal(sent[0], `$C${n} launched for a post you may have seen`, 'the biggest first');
  assert.ok(!sent.includes('$C1 launched for a post you may have seen'), 'the smallest is the one listed');
});

test('★ a coin older than the post on For You is not pushed, nor that post\'s later coin; a narrative\'s coin a post already pushed is not pushed again', async () => {
  const { db, sent, post, launches, deliver } = await setup();
  await post('x:a', null);
  await post('x:b', null);
  assert.equal(await launches(), 0);
  await post('x:a', { address: mint(1), ticker: 'OLD', cap: 900_000, launchedAgoMin: 90 });
  await post('x:b', { address: mint(2), ticker: 'NEW', cap: 20_000, launchedAgoMin: 5 });
  assert.equal(await launches(), 1, 'only the coin launched after For You showed its post');
  await post('x:a', { address: mint(3), ticker: 'LATER', cap: 50_000, launchedAgoMin: 2 });
  assert.equal(await launches(), 0, 'x:a had its first pick: a later coin is a hand-over');

  /* The narrative of x:b picks the same coin: already pushed. Its launch is known, so only the coin rule holds it back. */
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'NEW', 'New', '{}'::jsonb, $3, 'live_stream')`,
    [mint(2), `solana:${mint(2)}`, iso(NOW - 5 * MIN)],
  );
  await db.query(`insert into internal.narrative (narrative_id, state, anchor_item, member_count, title) values ('n-x:b', 'open', 'x:b', 1, 'B')`);
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:bee', 'x', 'bee', 'bee')`);
  await db.query(`insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ('x:b', 'x', 'b', 'x:bee', now(), now(), 'b', 'r', 'observed')`);
  await db.query(`insert into internal.narrative_member (narrative_id, item_id) values ('n-x:b', 'x:b')`);
  await db.query(`insert into public.story_view (story_id, payload, found_at, views_total, dead) values ('n-x:b', $1, now(), 1, false)`, [JSON.stringify({ title: 'B', provenance: { kind: 'observed' }, coins: { kind: 'one', coin: { address: mint(2), ticker: 'NEW' } } })]);
  assert.equal(await launches(), 0, 'one coin, one push');
  assert.deepEqual(await deliver(), ['push']);
  assert.deepEqual(sent, ['$NEW launched for a post you may have seen']);
});
