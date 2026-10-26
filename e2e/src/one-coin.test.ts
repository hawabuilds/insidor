/**
 * ★ ONE POST, ONE COIN on the real schema (PGlite, every migration; 0112's trade tables): a post and its launches through the runner's matcher and rule, into 0113's candidates,
 * picks and history; first on market readings (no trade feed yet, said in the pick), then on trade
 * minutes, where the coin people are buying takes over from the one that merely read high and a rug
 * is out; the narrative's pick over its posts; the live card's line, the one push on the post's first
 * pick (never on its hand-over) and the saved post's rows; and the replay reading the same rows back. Nothing is fetched, paid for
 * or sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { PushSender } from '@insidor/contracts/ports/people.ts';
import { oneCoinBars, scoreReplay } from '@insidor/core';
import { deliverQueued, type Db as NotifyDb } from '@insidor/notify/deliver.ts';
import { checkLaunches } from '@insidor/notify/launch.ts';
import { checkWatched } from '@insidor/notify/watch.ts';
import { liveCoinLine, loadNarrativePicks, loadPostPicks } from '@insidor/project/src/one-coin-cards.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { newOneCoinState, oneCoinPass } from '@insidor/runner/src/work/one-coin.ts';
import { PgOneCoinRepo, type Db } from '@insidor/store';

import { loadCases } from '@insidor/project/src/onecoin-cases.ts';
import { migratedDb } from './db.ts';
/* These cases were written for the matcher in shadow; the live cards and pushes have their own cases. */
const SHADOW_POLICY = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, mode: 'shadow' as const } };


const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const POSTED = NOW - 30 * MIN;
const LINK = 'Link1111111111111111111111111111pump';
const NAME = 'Name1111111111111111111111111111pump';
const RUG = 'Rug11111111111111111111111111111pump';
const UNREL = 'Unre1111111111111111111111111111pump';

let db: Db;

const iso = (ms: number) => new Date(ms).toISOString();

async function coin(address: string, name: string, symbol: string, launchedMs: number): Promise<void> {
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, $4, $5, '{}'::jsonb, $6, 'live_stream')`,
    [address, `solana:${address}`, iso(launchedMs), symbol, name, iso(NOW - MIN)],
  );
}

async function reading(address: string, atMs: number, cap: number): Promise<void> {
  await db.query(
    `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, last_hour_absent, tradable, source_vendor, source_endpoint)
     values ('solana', $1, $2, 'solana:curve', $3, 'no_market', $4, 'circulating', 'no_market', 'no_market', 'no_market', false, 'test', 'test')`,
    [address, `solana:${address}`, iso(atMs), cap],
  );
}

async function minute(address: string, atMs: number, o: { newBuyers: number; net: number; cap: number; usd: number; creatorSold?: number }): Promise<void> {
  await db.query(
    `insert into internal.coin_trade_minute (address, minute, buys, sells, buyers, new_buyers, buy_sol, sell_sol, net_sol, creator_sold_sol, last_mcap_sol, last_mcap_usd)
     values ($1, $2, greatest($3::int, 1), 1, $3, $3, greatest($4, 0), greatest(-$4, 0), $4, $5, $6, $7)`,
    [address, iso(atMs), o.newBuyers, o.net, o.creatorSold ?? 0, o.cap, o.usd],
  );
}

const pass = (now = NOW) =>
  oneCoinPass({ repo: new PgOneCoinRepo(db), policy: SHADOW_POLICY, log: quiet, now: () => now as Millis }, newOneCoinState());

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:cat', 'x', 'cat', 'catposter')`);
  for (const [id, body] of [['1001', 'Pancake the cat drinks from the fountain'], ['1002', 'Pancake the cat again']] as const) {
    await db.query(
      `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ($1, 'x', $2, 'x:cat', $3, $3, $4, 'r', 'observed')`,
      [`x:${id}`, id, iso(POSTED), body],
    );
    await db.query(
      `insert into internal.post_judgement (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable, confidence, proposed_name, alternate_names, subject_spans, cost_usd)
       values ($1, $2, 1, 'judge:test', 'post-v1', 'text', true, 0.99, $3, '[]', '[]', 0)`,
      [`x:${id}`, iso(POSTED + MIN), id === '1001' ? 'Pancake' : 'Fountain Cat'],
    );
  }
  /* Four launches after the post: one links it, one carries its exact name, one its exact ticker, one nothing. */
  await coin(LINK, 'Fountain Kitty', 'FKITTY', NOW - 20 * MIN);
  await coin(NAME, 'Pancake', 'PNCK', NOW - 19 * MIN);
  await coin(RUG, 'Pancake Coin', 'PANCAKE', NOW - 21 * MIN);
  await coin(UNREL, 'Waffle', 'WAF', NOW - 18 * MIN);
  await db.query(`insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at) values ($1, $2, 'x', '1001', 'https://x.com/cat/status/1001', $3, $4)`, [`solana:${LINK}`, LINK, iso(NOW - 20 * MIN), iso(NOW - 19 * MIN)]);
  /* The narrative: both posts. */
  await db.query(`insert into internal.narrative (narrative_id, state, anchor_item, member_count, shown, first_shown_at, title) values ('n-x:1001', 'open', 'x:1001', 2, true, now(), 'Pancake the cat')`);
  await db.query(`insert into internal.narrative_member (narrative_id, item_id) values ('n-x:1001', 'x:1001'), ('n-x:1001', 'x:1002')`);
});

test('★ before the trade feed: the matcher ties link, name and ticker; the pick is made on readings and says so', async () => {
  /* The readings: the name's coin read high, the link's low, the rug's moderate. */
  await reading(NAME, NOW - 12 * MIN, 60_000);
  await reading(LINK, NOW - 12 * MIN, 9_000);
  await reading(RUG, NOW - 13 * MIN, 12_000);
  const r = await pass();
  assert.equal(r.basis, 'market_readings');
  const cands = await db.query<{ address: string; path: string; ties: string[] }>(`select address, path, evidence -> 'ties' as ties from internal.one_coin_candidate where item_id = 'x:1001' order by address`);
  assert.deepEqual(cands.map((c) => [c.address, c.ties]), [[LINK, ['link']], [NAME, ['name_judge']], [RUG, ['name_judge']]]);
  const [pick] = await db.query<{ address: string; outcome: string; evidence: Record<string, unknown> }>(`select address, outcome, evidence from internal.post_coin_pick where item_id = 'x:1001'`);
  assert.equal(pick?.outcome, 'picked');
  assert.equal(pick?.address, NAME);
  assert.equal(pick?.evidence['note'], 'no trade data: judged on market readings');
  assert.equal(pick?.evidence['mode'], 'shadow');
});

test('★ on trade minutes: the coin people are buying takes over at three times, the rug is out, and the change is kept', async () => {
  /* The rug: a burst of buying, then the creator sells and the cap collapses. */
  await minute(RUG, NOW - 20 * MIN, { newBuyers: 40, net: 60, cap: 400, usd: 70_000 });
  await minute(RUG, NOW - 14 * MIN, { newBuyers: 0, net: -58, cap: 30, usd: 4_000, creatorSold: 25 });
  /* The name's coin: a few wallets. The link's coin: many buyers, steady net buying. */
  await minute(NAME, NOW - 18 * MIN, { newBuyers: 6, net: 4, cap: 150, usd: 25_000 });
  await minute(LINK, NOW - 19 * MIN, { newBuyers: 30, net: 15, cap: 120, usd: 20_000 });
  await minute(LINK, NOW - 10 * MIN, { newBuyers: 25, net: 20, cap: 260, usd: 46_000 });
  for (const [a, buyers, peak, last, sold] of [[RUG, 40, 400, 30, true], [NAME, 6, 150, 150, false], [LINK, 55, 260, 260, false]] as const) {
    await db.query(`insert into internal.coin_trade_state (address, unique_buyers, peak_mcap_sol, last_mcap_sol, creator_sold, first_trade_at, last_trade_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [a, buyers, peak, last, sold, iso(NOW - 21 * MIN), iso(NOW - 10 * MIN), iso(NOW - 5_000)]);
  }
  const r = await pass();
  assert.equal(r.basis, 'trades');
  const [pick] = await db.query<{ address: string; evidence: { basis: string; handedOverFrom: string | null; standings: { address: string; out: string | null }[] } }>(`select address, evidence from internal.post_coin_pick where item_id = 'x:1001'`);
  assert.equal(pick?.address, LINK);
  assert.equal(pick?.evidence.handedOverFrom, NAME);
  assert.equal(pick?.evidence.standings.find((s) => s.address === RUG)?.out, 'creator_sold');
  const changes = await db.query<{ from_address: string | null; to_address: string | null; basis: string }>(`select from_address, to_address, basis from internal.coin_pick_change where subject_kind = 'post' and subject_id = 'x:1001' order by id`);
  assert.deepEqual(changes.map((c) => [c.from_address, c.to_address, c.basis]), [[null, NAME, 'market_readings'], [NAME, LINK, 'trades']]);
  /* Every candidate is on the trade feed's watch list until an hour after its launch. */
  const watched = await db.query<{ address: string; until: string }>(`select address, until from internal.coin_watch order by address`);
  assert.deepEqual(watched.map((w) => w.address), [LINK, NAME, RUG]);
  assert.equal(new Date(watched.find((w) => w.address === LINK)!.until).getTime(), NOW - 20 * MIN + SHADOW_POLICY.oneCoin.watchMs);
  /* The narrative is judged over its posts' candidates together, to the same coin. */
  assert.equal((await loadNarrativePicks(db, ['n-x:1001'])).get('n-x:1001'), LINK);
});

test('★ the live card shows the pick with its facts, or Create and the top coins made after the post, to everyone', async () => {
  const picks = await loadPostPicks(db, ['x:1001', 'x:1002']);
  const coin = { address: LINK, ticker: 'FKITTY' } as never;
  const line = liveCoinLine({ kind: 'unsure', claimCount: 3 }, picks.get('x:1001'), coin, { count: 3, more: false }, new Set());
  assert.equal(line.kind, 'matched');
  assert.deepEqual(line.kind === 'matched' ? line.evidence : null, { linksPost: true, samePicture: null, launchedAfterMs: 10 * MIN, picked: true });
  /* x:1002 had no candidate: no pick row, its search found coins made after it → Create and "See 2 coins", for everyone (2026-10-26). */
  assert.deepEqual(liveCoinLine({ kind: 'unsure', claimCount: 2 }, picks.get('x:1002'), null, { count: 2, more: false }, new Set()), { kind: 'unsure', claimCount: 2 });
});

test('★ the one push: the post\'s first pick, launched after For You showed it, to everyone — never its hand-over; the saver hears of that coin once, and of the hand-over once', async () => {
  const ndb = db as unknown as NotifyDb;
  const sent: { to: string; title: string }[] = [];
  const push: PushSender = { configured: true, publicKey: 'PUB', send: async (t, m) => (sent.push({ to: t.endpoint, title: m.title }), 'sent') };
  for (const u of ['u1', 'u2']) {
    await ndb.query(`insert into people.profile (user_id, name) values ($1, $1)`, [u]);
    await ndb.query(`insert into people.push_subscription (endpoint, user_id, p256dh, auth) values ($1, $2, 'p', 'a')`, [`https://push.example/${u}`, u]);
  }
  await ndb.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`);
  /* On For You from 25 minutes ago; its coins launched 18 to 21 minutes ago, after. */
  await ndb.query(`insert into public.feed_post (feed_id, item_id, first_shown_at, last_shown_at, payload, payload_at) values ('fyp', 'x:1001', $1, $2, '{}', $2)`, [iso(NOW - 25 * MIN), iso(NOW)]);
  const lineIs = (coins: unknown) =>
    ndb.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', 'x:1001', 0, $1) on conflict (feed_id, item_id) do update set payload = excluded.payload`, [JSON.stringify({ authorLabel: '@catposter', excerpt: 'Pancake the cat drinks from the fountain', coins })]);
  await lineIs({ kind: 'unsure', claimCount: 3, ownerList: true });
  /* Saved 25 minutes ago, before its coins launched; the saved-post rule has been on since (its first look done). */
  await ndb.query(`insert into people.post_watch (user_id, item_id, created_at) values ('u1', 'x:1001', $1)`, [iso(NOW - 25 * MIN)]);
  await ndb.query(`insert into people.pipeline_seen (stream, key) values ('watch-saved', '#seeded')`);
  const state = { cursor: iso(NOW) };
  const ports = { policy: SHADOW_POLICY.notify, now: () => NOW, onPick: true };
  const launches = () => checkLaunches(ndb, ports);
  assert.equal(await launches(), 0, 'the first look sends nothing');
  /* The runner already picked $FKITTY (above), and no push went for the post yet: the pick is the saver's first. */
  assert.equal(await checkWatched(ndb, ports, state), 1, 'the saver\'s push: launched from a post you saved');
  await lineIs({ kind: 'matched', coin: { address: LINK, ticker: 'FKITTY' }, evidence: { linksPost: true, samePicture: null, launchedAfterMs: 600_000, picked: true } });
  assert.equal(await launches(), 2, 'one to each profile, saved or not');
  assert.equal(await launches(), 0, 'once');
  await db.query(`update internal.post_coin_pick set address = $1 where item_id = 'x:1001'`, [NAME]);
  await lineIs({ kind: 'matched', coin: { address: NAME, ticker: 'PNCK' }, evidence: { linksPost: null, samePicture: null, launchedAfterMs: 660_000, picked: true } });
  assert.equal(await checkWatched(ndb, ports, state), 1, 'the hand-over: the one running, once, to the saver');
  assert.equal(await checkWatched(ndb, ports, state), 0);
  assert.equal(await launches(), 0, 'the hand-over is never a launch push');
  await db.query(`update internal.post_coin_pick set address = $1 where item_id = 'x:1001'`, [LINK]);
  const out = (await deliverQueued({ db: ndb, push, pushOn: true, policy: SHADOW_POLICY.notify, now: () => NOW })).map((o) => o.outcome);
  assert.deepEqual(out, ['push', 'already-pushed', 'push', 'push'], 'the saver had $FKITTY from the saved post, so its launch push is listed');
  assert.deepEqual(sent, [
    { to: 'https://push.example/u1', title: '$FKITTY launched from a post you saved' },
    { to: 'https://push.example/u2', title: '$FKITTY launched for a post you may have seen' },
    { to: 'https://push.example/u1', title: '$PNCK is the one running for a post you saved' },
  ]);
  const [row] = await ndb.query<{ href: string; body: string; item: string }>(`select href, body, facts ->> 'item' as item from people.alert where kind = 'coin_launched' and user_id = 'u2'`);
  assert.deepEqual(row, { href: `/#/token/solana%3A${LINK}`, body: '"Pancake the cat drinks from the fountain" (@catposter). $9K MC.', item: 'x:1001' }, 'opens the coin\'s chart, the post kept for its card; the cap is the last one stored');
});

test('the replay reads the same rows back: the owner\'s coin is the truth, and the rule finds it', async () => {
  await db.query(`insert into internal.owner_feedback (owner_ref, user_id, subject_kind, item_id, verdict, coin_address) values ('x:owner', 'did:owner', 'coin_match', 'x:1001', 'right', $1)`, [LINK]);
  const P = SHADOW_POLICY.oneCoin;
  const loaded = await loadCases(db, NOW - 2 * 3_600_000, NOW + MIN, { truthAtMs: P.refit.truthAtMs, truthMinCapUsd: P.refit.truthMinCapUsd, watchMs: P.watchMs });
  assert.equal(loaded.useTrades, true);
  assert.deepEqual(loaded.truths.get('x:1001'), { address: LINK, by: 'owner' });
  const s = scoreReplay(loaded.cases.filter((c) => c.subject === 'x:1001'), oneCoinBars(P), 10 * MIN, P.watchMs, true);
  assert.deepEqual([s.withCoin, s.right], [1, 1]);
});
