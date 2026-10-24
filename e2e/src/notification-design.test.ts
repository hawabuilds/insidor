/**
 * ★ THE OWNER'S NOTIFICATION DESIGN (2026-10-18) on the real schema (PGlite, every migration),
 * through each producer and the deliverer, with seeded people, devices and events: what each
 * producer writes to Notifications, the order it picks in, and that the first look after a deploy
 * writes nothing old. Since the one push (2026-10-20, notify launch.ts) none of these reaches a
 * phone: each is listed, never pushed (launch.test.ts has the one push). Nothing is fetched and
 * nothing is sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { ParsedTx } from '@insidor/chain-portfolio';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { checkBlowingUp } from '@insidor/notify/blowing-up.ts';
import { checkCreatorBuyers } from '@insidor/notify/creator-buyers.ts';
import { deliverGroups, deliverQueued, type Db } from '@insidor/notify/deliver.ts';
import { checkStarred } from '@insidor/notify/starred.ts';
import { checkWatched } from '@insidor/notify/watch.ts';

import { migratedDb } from './db.ts';
/* These cases were written for the matcher in shadow; the live cards and pushes have their own cases. */
const SHADOW_POLICY = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, mode: 'shadow' as const } };


const P = SHADOW_POLICY.notify;
const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
/** A wallet address the profile accepts (base58, 32 characters). */
const wallet = (i: number) => `W${i}`.padEnd(32, '1');

async function people(n: number) {
  const db = (await migratedDb()) as unknown as Db;
  const sent: { to: string; title: string; body: string }[] = [];
  const push: PushSender = { configured: true, publicKey: 'PUB', send: async (t, m) => (sent.push({ to: t.endpoint, title: m.title, body: m.body }), 'sent') };
  for (let i = 1; i <= n; i++) {
    await db.query('insert into people.profile (user_id, name, wallet) values ($1, $1, $2)', [`u${i}`, wallet(i)]);
    await db.query(`insert into people.push_subscription (endpoint, user_id, p256dh, auth) values ($1, $2, 'p', 'a')`, [`https://push.example/u${i}`, `u${i}`]);
  }
  const deliver = async () => (await deliverQueued({ db, push, pushOn: true, policy: P, now: () => NOW })).map((o) => o.outcome);
  const groups = async () => deliverGroups({ db, push, pushOn: true, policy: P, now: () => NOW });
  /* What Notifications shows, in order: each row's words. */
  const listed = async () => (await db.query<{ title: string; body: string }>('select title, body from people.alert order by alert_id')).map((r) => [r.title, r.body]);
  return { db, sent, deliver, groups, listed };
}

/** A For You card whose views a minute were `before` from 90 to 30 minutes ago and `now` since: a riser when now is well over. */
async function card(db: Db, id: string, o: { before: number; now: number; coins: unknown; author?: string }) {
  const readings: { atMs: number; value: number }[] = [];
  let v = 1_000;
  for (let m = 90; m >= 0; m -= 10) {
    readings.push({ atMs: NOW - m * MIN, value: v });
    v += (m > 30 ? o.before : o.now) * 10;
  }
  const payload = { authorLabel: o.author ?? `@${id}`, excerpt: `Post ${id} words`, reach: { v }, coins: o.coins, sheet: { counts: readings }, postedAt: { at: NOW - 2 * HOUR } };
  await db.query(
    `insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at) values ('fyp', $1, now() - interval '2 hours', now(), $2, now())
     on conflict (feed_id, item_id) do update set payload = excluded.payload`,
    [`x:${id}`, JSON.stringify(payload)],
  );
}

test('★ every new For You post and every coin found for one is listed, never pushed', async () => {
  const { db, sent, deliver } = await people(1);
  for (const kind of ['rising_post', 'fyp_coin', 'fyp_proven', 'narrative_promoted', 'watch_coin']) {
    await db.query(`insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ('u1', $1, 's', 0, '{}', '/#/')`, [kind]);
  }
  assert.deepEqual(await deliver(), ['list-only', 'list-only', 'list-only', 'list-only', 'list-only']);
  assert.equal(sent.length, 0);
});

test('★ blowing up: the first look lists nothing; then the coinless riser goes first, each post once — listed, never pushed', async () => {
  const { db, sent, deliver, listed } = await people(2);
  await card(db, 'old', { before: 1_000, now: 6_000, coins: { kind: 'none' } });
  assert.equal(await checkBlowingUp(db, SHADOW_POLICY, NOW), 0, 'the first look remembers what is already blowing up');

  await card(db, 'coined', { before: 1_000, now: 9_000, coins: { kind: 'one', coin: { address: 'Coin111', ticker: 'CN', marketCapUsd: { v: 12_000 } } } });
  await card(db, 'fresh', { before: 1_000, now: 5_000, coins: { kind: 'none' } });
  await card(db, 'slow', { before: 1_000, now: 1_200, coins: { kind: 'none' } });
  assert.equal(await checkBlowingUp(db, SHADOW_POLICY, NOW), 4, 'two picks to two people; the slow post and the already-seen one are not picks');
  const order = await db.query<{ subject: string }>(`select subject from people.alert_queue where user_id = 'u1' order by queue_id`);
  assert.deepEqual(order.map((r) => r.subject), ['x:fresh', 'x:coined'], 'no coin yet goes first, though the coined post is faster');

  assert.deepEqual(await deliver(), ['list-only', 'list-only', 'list-only', 'list-only'], 'in Notifications, not on the phone');
  assert.equal(sent.length, 0);
  const [first] = await listed();
  assert.equal(first?.[0], 'Rising fast, no coin yet');
  assert.match(first?.[1] ?? '', /^@fresh: Post fresh words .*views, \+150K in 30m$/);
  assert.equal(await checkBlowingUp(db, SHADOW_POLICY, NOW), 0, 'each post is a pick once, ever');
});

test('★ a brand-new narrative taking off is a blowing-up pick, after coinless posts; not for those who starred it', async () => {
  const { db, deliver, sent, listed } = await people(2);
  const page = async (id: string, ageMs: number, posts: number, views: number) =>
    db.query(
      `insert into public.story_view (story_id, payload, found_at, views_total, dead) values ($1, $2, now(), 1, false) on conflict (story_id) do update set payload = excluded.payload`,
      [id, JSON.stringify({ title: `Narrative ${id}`, provenance: { kind: 'observed' }, firstSeenAt: { at: NOW - ageMs }, inWindow: [{ hours: 1, newPosts: posts, viewsGained: { v: views } }] })],
    );
  await checkBlowingUp(db, SHADOW_POLICY, NOW);
  await page('n-new', 2 * HOUR, 6, 2_100_000);
  await page('n-old', 30 * HOUR, 40, 9_000_000);
  await page('n-small', HOUR, 2, 2_000_000);
  await db.query(`insert into people.watch (user_id, story_id) values ('u2', 'n-new')`);
  assert.equal(await checkBlowingUp(db, SHADOW_POLICY, NOW), 1, 'only the new one over both bars, and not to its starrer');
  assert.deepEqual(await deliver(), ['list-only']);
  assert.equal(sent.length, 0);
  assert.deepEqual(await listed(), [['New narrative taking off: Narrative n-new', '6 new posts, +2.1M views in the last hour']]);
});

test('★ follows and likes are each listed, never pushed, and never held for a group', async () => {
  const { db, sent, deliver, groups, listed } = await people(1);
  for (const who of ['@ann', '@bob', '@cyd']) await db.query(`insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ('u1', 'follow', $1, 0, $2, '/#/u/x')`, [who, JSON.stringify({ who })]);
  for (let n = 1; n <= 2; n++) await db.query(`insert into people.alert_queue (user_id, kind, subject, rung, facts, href) values ('u1', 'comment_useful', '7', $1, $2, '/#/story/s')`, [n, JSON.stringify({ count: n, excerpt: 'Pancake' })]);
  assert.deepEqual(await deliver(), ['list-only', 'list-only', 'list-only', 'list-only', 'list-only']);
  await db.query(`update people.alert set at = now() - interval '2 hours'`);
  assert.deepEqual(await groups(), [], 'nothing is held, so no group push');
  assert.equal(sent.length, 0);
  assert.deepEqual((await listed()).slice(0, 3), [['New follower', '@ann followed you'], ['New follower', '@bob followed you'], ['New follower', '@cyd followed you']]);
});

test('★ shadow mode: a saved post\'s first settled coin is pushed at once (2026-10-24, a saved post always pushes); a post that showed a coin when saved, or an unsure one, is not', async () => {
  const { db, sent, deliver, listed } = await people(2);
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  const line = (id: string, coins: unknown) =>
    db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', $1, 0, $2) on conflict (feed_id, item_id) do update set payload = excluded.payload`, [id, JSON.stringify({ authorLabel: '@SpaceX', excerpt: 'Falcon 9 lands again', coins })]);
  await line('x:1', { kind: 'none' });
  await line('x:2', { kind: 'one', coin: { address: 'Had111', ticker: 'HAD' }, evidence: { linksPost: true } });
  await db.query(`insert into people.post_watch (user_id, item_id) values ('u1', 'x:1'), ('u2', 'x:2')`);
  const state = { cursor: new Date(NOW).toISOString() };
  assert.equal(await checkWatched(db, { policy: P, now: () => NOW, onPick: false }, state), 1, 'the first look: u2\'s post already had its coin, which is listed as before, never a first');
  assert.deepEqual(await deliver(), ['list-only']);

  await line('x:1', { kind: 'unsure', claimCount: 3 });
  assert.equal(await checkWatched(db, { policy: P, now: () => NOW, onPick: false }, state), 0, 'unsure is not a coin');
  await line('x:1', { kind: 'one', coin: { address: 'Fal111', ticker: 'FALCON', marketCapUsd: { v: 3_000 } }, evidence: { linksPost: true } });
  assert.equal(await checkWatched(db, { policy: P, now: () => NOW, onPick: false }, state), 1);
  assert.deepEqual(await deliver(), ['push'], 'a saved post\'s coin reaches the phone');
  assert.equal(sent.length, 1);
  assert.deepEqual((await listed()).at(-1), ['$FALCON is the first coin for a post you saved', '"Falcon 9 lands again" (@SpaceX). $3K MC.']);
  await line('x:1', { kind: 'one', coin: { address: 'Two111', ticker: 'TWO' }, evidence: { linksPost: true } });
  await checkWatched(db, { policy: P, now: () => NOW, onPick: false }, state);
  assert.deepEqual(await deliver(), ['list-only'], 'a later coin is listed, not pushed');
});

test('★ a starred narrative picking up speed: once per window; a big account posting in it: listed; nothing old on the first look', async () => {
  const { db, sent, deliver, listed } = await people(1);
  const page = (posts: number, views: number) =>
    db.query(`insert into public.story_view (story_id, payload, found_at, views_total, dead) values ('n-p', $1, now(), 1, false) on conflict (story_id) do update set payload = excluded.payload`, [
      JSON.stringify({ title: 'Pancake the cat', provenance: { kind: 'observed' }, inWindow: [{ hours: 1, newPosts: posts, viewsGained: { v: views } }], viewsPerMinute: { now: 900, before: 300 } }),
    ]);
  await page(6, 2_100_000);
  await db.query(`insert into public.author (author_key, source, source_author_id, handle, follower_count) values ('x:big', 'x', 'big', 'bigone', 48000000), ('x:small', 'x', 'small', 'small', 900)`);
  await db.query(`insert into internal.narrative (narrative_id, state, anchor_item, member_count, title) values ('n-p', 'open', 'x:a', 3, 'Pancake the cat')`);
  const item = async (id: string, author: string, postedAgoMs: number) => {
    const at = new Date(NOW - postedAgoMs).toISOString();
    await db.query(`insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ($1, 'x', $1, $2, $3, $3, 'Pancake drinks from the fountain', 'r', 'observed')`, [id, author, at]);
    await db.query(`insert into internal.narrative_member (narrative_id, item_id) values ('n-p', $1)`, [id]);
  };
  await item('x:a', 'x:big', 30 * MIN);
  await db.query(`insert into people.watch (user_id, story_id) values ('u1', 'n-p')`);
  assert.equal(await checkStarred(db, P, NOW), 0, 'the first look: no speed push, the big account\'s post already there is remembered');

  assert.equal(await checkStarred(db, P, NOW), 1);
  assert.equal(await checkStarred(db, P, NOW), 0, 'not queued again inside its window');
  await item('x:b', 'x:big', 5 * MIN);
  await item('x:c', 'x:small', 5 * MIN);
  await item('x:old', 'x:big', 3 * 24 * HOUR);
  assert.equal(await checkStarred(db, P, NOW), 1, 'the new big-account post; not the small account, not the old post the regroup added');
  assert.deepEqual(await deliver(), ['list-only', 'list-only']);
  assert.equal(sent.length, 0);
  assert.deepEqual(await listed(), [
    ['Pancake the cat is taking off', '6 new posts, +2.1M views in the last hour'],
    ['@bigone posted in Pancake the cat', '48M followers: Pancake drinks from the fountain'],
  ]);
});

test('★ a coin you made gets its first buyers: listed once for its creator; the creator\'s own buys and coins made before the deploy are not', async () => {
  const { db, sent, deliver, listed } = await people(1);
  await db.query(`insert into public.created_coin (address, creator, signature, created_at) values ('Old111', $1, 's0', now() - interval '1 day')`, [wallet(1)]);
  const txs = new Map<string, ParsedTx[]>();
  /* A buy as the parser shows it: the payer's SOL down, its token account up by the coin. */
  const buy = (signature: string, payer: string, mint: string): ParsedTx => ({
    signature, timestamp: 0, fee: 5_000, feePayer: payer,
    accountData: [{ account: payer, nativeBalanceChange: -100_005_000, tokenBalanceChanges: [{ userAccount: payer, tokenAccount: `${payer}-ata`, mint, rawTokenAmount: { tokenAmount: '1000000000', decimals: 6 } }] }],
  });
  const ports = { recentTxs: async (a: string) => txs.get(a) ?? [] };
  assert.equal(await checkCreatorBuyers(db, ports, P), 0, 'the first look remembers the coins already made');
  await db.query(`insert into public.created_coin (address, creator, signature, created_at) values ('New111', $1, 's1', now())`, [wallet(1)]);
  txs.set('New111', [buy('s1', wallet(1), 'New111')]);
  txs.set('Old111', [buy('s9', 'Other', 'Old111')]);
  assert.equal(await checkCreatorBuyers(db, ports, P), 0, 'only the creator bought');
  txs.set('New111', [buy('s1', wallet(1), 'New111'), buy('s2', 'Buyer1', 'New111'), buy('s3', 'Buyer2', 'New111')]);
  assert.equal(await checkCreatorBuyers(db, ports, P), 1);
  assert.equal(await checkCreatorBuyers(db, ports, P), 0, 'once per coin');
  assert.deepEqual(await deliver(), ['list-only']);
  assert.equal(sent.length, 0);
  assert.deepEqual(await listed(), [['$COIN has its first buyers', '2 wallets bought the coin you made.']]);
});
