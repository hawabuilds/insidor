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
  const add = (kind: string, minute: number, href = '/#/', subject = `s${minute}`, delivery = 'push') =>
    db.query(`insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery, at) values ($1, $2, $3, 0, 't', 'b', $4, '{}', $5, $6)`, [ME.userId, kind, subject, href, delivery, new Date(BASE - minute * 60_000).toISOString()]);
  return { db, get, add };
}

test('★ Notifications page twenty at a time, with no row twice and no empty last page', async () => {
  const { get, add } = await setup();
  for (let i = 0; i < 45; i += 1) await add(i % 3 === 0 ? 'follow' : 'graduated', i);
  for (let i = 0; i < 5; i += 1) await add('rising_post', 100 + i, '/#/', `r${i}`, 'hourly-limit');
  const seen = new Set<number>();
  let cursor: string | null = null;
  const sizes: number[] = [];
  do {
    const r = await get(`?list=notifications${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    assert.equal(r.status, 200);
    for (const a of r.body.alerts) {
      assert.ok(!seen.has(a.id), 'no row twice');
      seen.add(a.id);
    }
    assert.equal(r.body.bell, 45, 'the bell counts every unread notification, not the page');
    sizes.push(r.body.alerts.length);
    cursor = r.body.cursor;
  } while (cursor !== null);
  assert.deepEqual(sizes, [20, 20, 10], '★ the old Feed rows are in Notifications too, as in-app rows; the bell leaves them out');
});

test('the Feed pages its own side, by tab: Rising takes rising posts inside its window, Watching the starred narratives', async () => {
  const { db, get, add } = await setup();
  /* Listed, not pushed: a Feed row that reached the phone is a notification too (tested below). */
  await add('rising_post', 1, '/#/story/st_a', 's1', 'no-device');
  await add('rising_post', 60 * 24 * 9, '/#/', 's9', 'no-device');
  await add('narrative_promoted', 2, '/#/story/st_a', 'st_a', 'no-device');
  await add('narrative_promoted', 3, '/#/story/st_b', 'st_b', 'no-device');
  await add('coin_matched', 4, '/#/story/st_c', 'st_c|MINT', 'no-device');
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

test('★ every row carries its face: the person, the poster and the coin, saved or looked up', async () => {
  const { db, get, add } = await setup();
  const pic = 'https://pictures.example/jonas.jpg';
  await db.query(`insert into people.profile (user_id, handle, name, picture_url) values ('did:privy:j', 'jonas', 'Jonas', $1)`, [pic]);
  await db.query(`insert into public.author (author_key, source, source_author_id, handle, picture_url) values ('x:1', 'x', '1', '@poster', 'https://pictures.example/poster.jpg')`);
  await db.query(`update public.author set picture_copy = $1 where author_key = 'x:1'`, ['a'.repeat(32)]);
  await db.query(`insert into public.item (item_id, source, source_item_id, author_key, first_seen_at, raw_ref, origin) values ('x:post', 'x', 'post', 'x:1', now(), 'r', 'observed')`);
  const mint = 'FerryHorn1111111111111111111111111111111pump';
  await add('follow', 1, '/#/u/jonas', 'jonas');
  await add('rising_post', 2, '/#/', 'x:post');
  await add('coin_matched', 3, '/#/story/st', `st|${mint}`);
  await add('graduated', 4, `/#/token/${encodeURIComponent(`solana:${mint}`)}`, mint);
  await db.query(`insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery) values ($1, 'reply', '77', 0, 'x replied', 'b', '/#/', $2, 'push')`, [ME.userId, JSON.stringify({ picture: 'https://pictures.example/saved.jpg', userId: 'did:privy:j' })]);
  const faces = new Map((await get('')).body.alerts.map((a) => [a.kind, a as unknown as { picture: string | null; pictureFile: string | null; coin: string | null }]));
  assert.equal(faces.get('follow')?.picture, pic, "a follow from before pictures were saved gets the follower's picture");
  assert.equal(faces.get('rising_post')?.picture, 'https://pictures.example/poster.jpg', "and a rising post its poster's");
  assert.equal(faces.get('rising_post')?.pictureFile, 'a'.repeat(32), "with our stored copy of it, tried first");
  assert.equal(faces.get('follow')?.pictureFile, null, 'a person has no stored copy');
  assert.equal(faces.get('reply')?.picture, 'https://pictures.example/saved.jpg', 'a saved picture is used as saved');
  assert.equal(faces.get('coin_matched')?.coin, mint);
  assert.equal(faces.get('graduated')?.coin, mint);
  assert.equal(faces.get('follow')?.coin, null);
});

test('★ a follow row says who followed and whether I follow them back', async () => {
  const { db, get, add } = await setup();
  await db.query(`insert into people.profile (user_id, handle, name) values ('did:privy:j', 'jonas', 'Jonas'), ('did:privy:k', 'kim', 'Kim')`);
  await db.query(`insert into people.follow (follower_id, followee_id) values ($1, 'did:privy:k')`, [ME.userId]);
  await add('follow', 1, '/#/u/jonas', 'jonas');
  await add('follow', 2, '/#/u/kim', 'did:privy:k');
  await add('graduated', 3);
  const rows = (await get('?list=notifications')).body.alerts as unknown as { kind: string; actor: { userId: string; iFollow: boolean } | null }[];
  assert.deepEqual(rows.map((r) => r.actor), [{ userId: 'did:privy:j', handle: 'jonas', name: 'Jonas', iFollow: false }, { userId: 'did:privy:k', handle: 'kim', name: 'Kim', iFollow: true }, null]);
});

test('one row per comment found useful, the newest count, in the list and on the bell', async () => {
  const { db, get } = await setup();
  const useful = (subject: string, count: number, minute: number) =>
    db.query(`insert into people.alert (user_id, kind, subject, rung, title, body, href, facts, delivery, at) values ($1, 'comment_useful', $2, $3, $4, 'c', '/#/', '{}', 'push', $5)`, [ME.userId, subject, count, count === 1 ? 'Someone found your comment useful' : `${count} people found your comment useful`, new Date(BASE - minute * 60_000).toISOString()]);
  await useful('7', 1, 30);
  await useful('7', 2, 20);
  await useful('8', 1, 10);
  await useful('7', 3, 5);
  const r = await get('?list=notifications');
  assert.deepEqual(r.body.alerts.map((a) => (a as unknown as { title: string }).title), ['3 people found your comment useful', 'Someone found your comment useful']);
  assert.equal(r.body.bell, 2);
});

test('★ a New on FYP post is an in-app row in Notifications; only one that reached the phone is on the bell', async () => {
  const { get, add } = await setup();
  await add('rising_post', 1, '/#/post/x%3A1', 'x:1', 'push');
  await add('rising_post', 2, '/#/post/x%3A2', 'x:2', 'hourly-limit');
  const r = await get('?list=notifications');
  assert.deepEqual(r.body.alerts.map((a) => (a as unknown as { kind: string; pushed: boolean }).pushed), [true, false]);
  assert.equal(r.body.bell, 1);
});

test('★ a saved post (2026-10-24): the first coin tied after the save to start running is pushed, the pick once if another, never a third', async () => {
  const { db } = await setup();
  const { checkWatched } = await import('@insidor/notify/watch.ts');
  const as = async (method: string, path: string) => {
    const deps = { db, identity: { verify: async () => ME }, push: { configured: false, publicKey: null, send: async () => 'sent' as const }, pushOn: false, policy: P, now: () => BASE, pace: () => true };
    const r = await handle({ method, url: path, body: null, token: ME.userId, client: 't' }, deps as never);
    return JSON.parse(r.body) as { watching?: boolean; posts?: { itemId: string }[] };
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const t0 = Date.now();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:ferry', 'x', 'ferry', 'ferrycat')`);
  for (const id of ['new', 'old']) await db.query(`insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ($1, 'x', $2, 'x:ferry', $3, $3, 'the ferry cat', 'r', 'observed')`, [`x:${id}`, id, iso(t0 - 3_600_000)]);
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  const line = (id: string, coins: unknown) => db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', $1, 0, $2) on conflict (feed_id, item_id) do update set payload = excluded.payload`, [id, JSON.stringify({ authorLabel: '@ferrycat', excerpt: 'the ferry cat', coins })]);
  const coin = (address: string, symbol: string, launchedMs: number) =>
    db.query(`insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
              values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, $4, $4, '{}'::jsonb, $3, 'live_stream')`, [address, `solana:${address}`, iso(launchedMs), symbol]);
  const tied = (address: string, ties: string[], launchedMs: number) =>
    db.query(`insert into internal.one_coin_candidate (item_id, address, path, evidence, launched_at, found_at, updated_at) values ('x:new', $1, 'launch', $2, $3, $4, $4)`, [address, JSON.stringify({ ties }), iso(launchedMs), iso(launchedMs + 7_000)]);
  const pick = (address: string) =>
    db.query(`insert into internal.post_coin_pick (item_id, address, outcome, decided_at, evidence, updated_at) values ('x:new', $1, 'picked', now(), '{}', now()) on conflict (item_id) do update set address = excluded.address`, [address]);
  await line('x:new', { kind: 'unsure', claimCount: 3 });
  await line('x:old', { kind: 'matched', coin: { address: 'HornHorn11111111111111111111111111111111pump', ticker: 'OLD' }, evidence: { linksPost: true } });
  assert.deepEqual(await as('GET', '/post-watch/x%3Anew'), { watching: false });
  assert.deepEqual(await as('PUT', '/post-watch/x%3Anew'), { watching: true });
  assert.deepEqual(await as('PUT', '/post-watch/x%3Aold'), { watching: true });
  assert.deepEqual(await as('GET', '/post-watch/x%3Anew'), { watching: true });
  assert.deepEqual((await as('GET', '/post-watch')).posts?.map((p) => p.itemId).sort(), ['x:new', 'x:old']);
  const launched = Date.now() + 1_000;
  const ports = { policy: P, now: () => launched + 15_000 };
  const state = { cursor: null };
  assert.equal(await checkWatched(db, ports, state), 0, 'the first look sends nothing, and the coin x:old showed when saved is not news');
  /* A market reading with its last hour (0127), taken just now. */
  let at = launched + 5_000;
  const reading = (address: string, volume: number | null, buys: number, sells: number) =>
    db.query(
      `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, tradable, source_vendor, source_endpoint, volume_1h_usd, buys_1h, sells_1h, last_hour_absent)
       values ('solana', $1, $2, 'solana:curve', $3, 'no_market', 9000, 'circulating', 'no_market', 'no_market', false, 'test', 'test', $4, $5, $6, $7)`,
      [address, `solana:${address}`, iso(at++), volume, volume === null ? null : buys, volume === null ? null : sells, volume === null ? 'not_reported' : null],
    );
  const before = 'Before1111111111111111111111111111111pump';
  await coin(before, 'BEFORE', t0 - 120_000);
  await tied(before, ['link'], t0 - 120_000);
  await reading(before, 90_000, 900, 400);
  const pic = 'Picture111111111111111111111111111111pump';
  await coin(pic, 'PIC', launched - 500);
  await tied(pic, ['picture'], launched - 500);
  await reading(pic, 90_000, 900, 400);
  assert.equal(await checkWatched(db, ports, state), 0, 'running, but launched before the save, or tied by a picture alone: not the first');
  const first = 'FerryHorn1111111111111111111111111111111pump';
  await coin(first, 'FERRY', launched);
  await tied(first, ['link', 'name_guess'], launched);
  const second = 'Second11111111111111111111111111111111pump';
  await coin(second, 'SECOND', launched + 2_000);
  await tied(second, ['name_judge'], launched + 2_000);
  /* The market reader keeps reading both: 0129's function names them, and not the picture's or the earlier coin. */
  const toRead = await db.query<{ address: string }>(`select address from internal.saved_post_coins(now() + interval '1 minute', 10800000, 10)`);
  assert.deepEqual(toRead.map((r) => r.address).sort(), [first, second].sort());
  assert.equal(await checkWatched(db, ports, state), 0, 'tied, but no reading yet: not running');
  await reading(first, null, 0, 0);
  await reading(second, 800, 30, 10);
  assert.equal(await checkWatched(db, ports, state), 0, 'a reading without its hour is not running; nor is $800 traded');
  await reading(first, 5_000, 25, 5);
  assert.equal(await checkWatched(db, ports, state), 1, 'the first tied coin to start running, no pick yet: pushed');
  await reading(second, 50_000, 300, 100);
  assert.equal(await checkWatched(db, ports, state), 0, 'a later coin running is not news');
  await pick(second);
  assert.equal(await checkWatched(db, ports, state), 1, 'the pick is another coin: the one running, once');
  assert.equal(await checkWatched(db, ports, state), 0, 'and only once');
  await pick(first);
  assert.equal(await checkWatched(db, ports, state), 0, 'never a third');
  const rows = await db.query<{ kind: string; subject: string; href: string; facts: { symbol: string; address: string; saved: string } }>('select kind, subject, href, facts from people.alert_queue order by queue_id');
  assert.deepEqual(rows.map((r) => [r.kind, r.subject, r.facts.saved, r.facts.symbol]), [['watched_first_coin', 'x:new|#launched', 'launched', 'FERRY'], ['watched_first_coin', 'x:new|#running', 'running', 'SECOND']]);
  assert.equal(rows[0]?.href, `/#/token/${encodeURIComponent(`solana:${first}`)}`);
  assert.deepEqual(await as('DELETE', '/post-watch/x%3Anew'), { watching: false });
});
