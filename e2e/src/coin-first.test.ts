/**
 * ★ THE COIN-FIRST ROUTE on the real schema (PGlite, every migration; 0117, 0118): the Laura case in
 * miniature. A day-old video post nobody showed, an account's quote of it that a copycat coin linked
 * first, and the coin that ran linking that quote too. The runner's route walks from the quote to the
 * video, asks the judge once about the video alone, credits it and records its first coin, and
 * records the quote as a pointer; the one-coin pass gets the coin back for the whole watch; and For
 * You takes the video on the judge's yes and the pick alone — no view reading at all, a day and more
 * after it went up — once. And a launcher's post naming the original only by a link is walked the
 * same way, its coins tied to the original through it. Nothing is fetched, paid for or sent anywhere.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { inMemoryMeter } from '@insidor/meter';
import { buildRising } from '@insidor/project/src/rising.ts';
import { recordAdmitted } from '@insidor/project/src/coin-first.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { coinFirstPass, newCoinFirstState } from '@insidor/runner/src/work/coin-first.ts';
import { PgCoinFirstRepo, PgItemRepo, PgOneCoinRepo, type Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const ORIGINAL = 'x:3001';
const REPOST = 'x:3002';
const COPYCAT = 'Copy1111111111111111111111111111pump';
const LAURA = 'Laur1111111111111111111111111111pump';
const iso = (ms: number) => new Date(ms).toISOString();

let db: Db;

async function coin(address: string, launchedMs: number): Promise<void> {
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'LAURA', 'Forever Laura', '{}'::jsonb, $3, 'live_stream')`,
    [address, `solana:${address}`, iso(launchedMs)],
  );
  await db.query(
    `insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at) values ($1, $2, 'x', '3002', 'https://x.com/saylor/status/3002', $3, $4)`,
    [`solana:${address}`, address, iso(launchedMs), iso(launchedMs + 15_000)],
  );
}

const judgement = (itemId: string) =>
  db.query(
    `insert into internal.post_judgement (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable, confidence, proposed_name, alternate_names, subject_spans, cost_usd)
     values ($1, $2, 1, 'judge:test', 'post-v1', 'text', true, 0.99, 'Forever Laura', '[]', '[]', 0)`,
    [itemId, iso(NOW - MIN)],
  );

const pass = (judged: string[]) =>
  coinFirstPass(
    {
      repo: new PgCoinFirstRepo(db),
      items: new PgItemRepo(db),
      sources: () => [],
      store: async () => 0,
      score: async (queue: readonly Item[]) => {
        for (const i of queue) {
          judged.push(String(i.itemId));
          await judgement(String(i.itemId));
        }
        return { queued: queue.length, scored: queue.length, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0 };
      },
      meter: inMemoryMeter({ dailyCapUsd: 1, perVendorCapUsd: {}, softStop: 1, now: () => NOW }),
      mode: 'live',
      policy: DEFAULT_POLICY,
      log: quiet,
      now: () => NOW as Millis,
    },
    newCoinFirstState(),
  );

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:laura', 'x', 'laura', 'alexes'), ('x:saylor', 'x', 'saylor', 'saylor')`);
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin) values ($1, 'x', '3001', 'x:laura', $2, $3, 'Laura forever', 'r', 'observed')`,
    [ORIGINAL, iso(NOW - 30 * HOUR), iso(NOW - 20 * MIN)],
  );
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin, reproduction_of) values ($1, 'x', '3002', 'x:saylor', $2, $2, 'Laura forever', 'r', 'observed', $3)`,
    [REPOST, iso(NOW - 25 * MIN), ORIGINAL],
  );
  await coin(COPYCAT, NOW - 25 * MIN);
  await coin(LAURA, NOW - 24 * MIN);
  /* Only the coin people bought reached the cap bar. */
  await db.query(
    `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, last_hour_absent, tradable, source_vendor, source_endpoint)
     values ('solana', $1, $2, 'solana:curve', $3, 'no_market', 48000, 'circulating', 'no_market', 'no_market', 'no_market', false, 'test', 'test')`,
    [LAURA, `solana:${LAURA}`, iso(NOW - 15 * MIN)],
  );
});

test('★ the running coin\'s linked quote is walked to the video: only the video asked, once, credited, and the quote a pointer', async () => {
  const running = await new PgCoinFirstRepo(db).running((NOW - HOUR) as Millis, DEFAULT_POLICY.oneCoin.minCapUsd, 100);
  assert.deepEqual(running.map((r) => [r.itemId, r.via, r.address]).sort(), [[REPOST, 'link', LAURA]]);

  const judged: string[] = [];
  await pass(judged);
  assert.deepEqual(judged, [ORIGINAL]);
  await pass(judged);
  assert.equal(judged.length, 1, 'asked once');
  const lanes = await db.query<{ item_id: string; lane: string }>(`select item_id, lane from internal.item_found_by order by item_id`);
  assert.deepEqual(lanes.map((r) => [r.item_id, r.lane]), [[ORIGINAL, 'coin_link']]);
  const rec = await db.query<{ item_id: string; coin_address: string; first_coin_address: string; judge: boolean; role: string; pointer_item_id: string | null; resolved_by: string | null }>(
    `select item_id, coin_address, first_coin_address, judge_asked_at is not null as judge, role, pointer_item_id, resolved_by from internal.coin_first_post order by item_id`,
  );
  assert.deepEqual(rec.map((r) => [r.item_id, r.coin_address, r.first_coin_address, r.judge, r.role, r.pointer_item_id, r.resolved_by]), [
    [ORIGINAL, LAURA, COPYCAT, true, 'original', REPOST, 'quote'],
    [REPOST, LAURA, COPYCAT, false, 'pointer', null, null],
  ]);
  assert.deepEqual(await new PgCoinFirstRepo(db).spentSince((NOW - HOUR) as Millis), { fetches: 0, judgements: 1 });
});

test('the one-coin pass gets the route\'s coins back for the whole watch, past the rematch window', async () => {
  const launches = await new PgOneCoinRepo(db).coinFirstLaunches(NOW - HOUR, 100, 'v1');
  assert.deepEqual(launches.map((l) => l.address).sort(), [COPYCAT, LAURA].sort());
  const recent = await new PgOneCoinRepo(db).recentLaunches(NOW - 3 * MIN, 100, 'v1');
  assert.equal(recent.length, 0);
});

test('★ For You takes the post on the yes and the pick alone, a day after it went up — once; found only by the coin\'s link, not until its views clear the bar', async () => {
  const pick = (itemId: string, address: string | null, outcome: string) =>
    db.query(
      `insert into internal.post_coin_pick (item_id, address, outcome, decided_at, evidence, updated_at) values ($1, $2, $3, $4, '{}'::jsonb, $4)
       on conflict (item_id) do update set address = excluded.address, outcome = excluded.outcome, decided_at = excluded.decided_at`,
      [itemId, address, outcome, iso(NOW - 2 * MIN)],
    );
  /* The route as it stood before policy.v192: the post found only by the coin's link joins with no view reading. */
  const policy = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, varietyOn: false, coinListNeedsReach: false } };
  await pick(ORIGINAL, null, 'waiting');
  let frame = await buildRising(db, NOW as Millis, new Map(), 30 * MIN, policy);
  assert.ok(!frame.fyp.some((p) => p.id === ORIGINAL), 'no pick yet: not on For You');

  await pick(ORIGINAL, LAURA, 'picked');
  frame = await buildRising(db, NOW as Millis, new Map(), 30 * MIN, policy);
  assert.ok(frame.fyp.some((p) => p.id === ORIGINAL), 'picked: on For You');
  assert.ok(frame.coinFirst?.has(ORIGINAL), 'by the route alone');
  const card = frame.fyp.find((p) => p.id === ORIGINAL);
  assert.equal(card?.coins.kind === 'matched' ? card.coins.coin.address : null, LAURA, 'the card shows the coin that brought it');

  /* ★ policy.v192 (the owner, 2026-10-27): found only by a coin's link, it must have been seen — with no
     view reading it is held off For You by every route, the coin-first route included. */
  const needsReach = { ...policy, rising: { ...policy.rising, coinListNeedsReach: true } };
  assert.ok(!(await buildRising(db, NOW as Millis, new Map(), 30 * MIN, needsReach)).fyp.some((p) => p.id === ORIGINAL), 'only the coin\'s link found it and its views are unread: held');

  await recordAdmitted(db, [ORIGINAL], NOW);
  frame = await buildRising(db, NOW as Millis, new Map(), 30 * MIN, policy);
  assert.ok(!frame.fyp.some((p) => p.id === ORIGINAL), 'let in once: not a member, so not again');

  const off = { ...policy, rising: { ...policy.rising, coinFirst: { ...policy.rising.coinFirst, on: false } } };
  assert.ok(!(await buildRising(db, NOW as Millis, new Map(), 30 * MIN, off)).fyp.some((p) => p.id === ORIGINAL), 'off: no route');

  /* The pointer, judged yes elsewhere and picked, is still never let in by the route. */
  await judgement(REPOST);
  await pick(REPOST, LAURA, 'picked');
  frame = await buildRising(db, NOW as Millis, new Map(), 30 * MIN, policy);
  assert.ok(!(frame.coinFirst?.has(REPOST) ?? false), 'a pointer is not the route\'s');
});

test('★ a post naming the original only by a link (its links kept, 0118) is walked to it, and its coins tied to the original through it', async () => {
  const LINKER = 'x:4001';
  const VIRAL = 'x:4002';
  const DEGEN = 'Dgen1111111111111111111111111111pump';
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:viral', 'x', 'viral', 'viral'), ('x:degen', 'x', 'degen', 'degen')`);
  await new PgItemRepo(db).upsert([
    {
      itemId: VIRAL, source: 'x', sourceItemId: '4002', origin: 'observed', authorKey: 'x:viral', postedAt: NOW - 3 * HOUR, firstSeenAt: NOW - 3 * HOUR, lang: 'en', text: 'the cat',
      media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: 'r', refersTo: [],
    },
    {
      itemId: LINKER, source: 'x', sourceItemId: '4001', origin: 'observed', authorKey: 'x:degen', postedAt: NOW - 30 * MIN, firstSeenAt: NOW - 30 * MIN, lang: 'en',
      text: 'THIS CAT IS GOING VIRAL https://t.co/abc', media: [], counters: {}, fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: 'r', refersTo: [VIRAL],
    },
  ] as unknown as Item[]);
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'CAT', 'Cat', '{}'::jsonb, $3, 'live_stream')`,
    [DEGEN, `solana:${DEGEN}`, iso(NOW - 20 * MIN)],
  );
  await db.query(
    `insert into internal.coin_post_link (asset_key, address, source, source_item_id, link, minted_at, found_at) values ($1, $2, 'x', '4001', 'https://x.com/degen/status/4001', $3, $3)`,
    [`solana:${DEGEN}`, DEGEN, iso(NOW - 20 * MIN)],
  );
  await db.query(
    `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, last_hour_absent, tradable, source_vendor, source_endpoint)
     values ('solana', $1, $2, 'solana:curve', $3, 'no_market', 48000, 'circulating', 'no_market', 'no_market', 'no_market', false, 'test', 'test')`,
    [DEGEN, `solana:${DEGEN}`, iso(NOW - 10 * MIN)],
  );
  const judged: string[] = [];
  await pass(judged);
  assert.deepEqual(judged, [VIRAL]);
  const rec = await db.query<{ role: string; pointer_item_id: string | null; resolved_by: string | null }>(`select role, pointer_item_id, resolved_by from internal.coin_first_post where item_id = $1`, [VIRAL]);
  assert.deepEqual(rec.map((r) => [r.role, r.pointer_item_id, r.resolved_by]), [['original', LINKER, 'link']]);
  const ties = await new PgCoinFirstRepo(db).ties([VIRAL]);
  assert.deepEqual(ties.get(VIRAL)?.map((t) => t.address), [DEGEN]);
  const launches = await new PgOneCoinRepo(db).coinFirstLaunches(NOW - HOUR, 100, 'v1');
  assert.deepEqual(launches.find((l) => l.address === DEGEN)?.linksThrough, [{ itemId: VIRAL, via: LINKER }]);
});
