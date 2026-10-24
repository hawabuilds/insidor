/**
 * ★ A PROMOTION IS NEVER SHOWN (Policy.rising.promotion, the owner 2026-10-24) on the real schema
 * (PGlite, every migration): the Light Baby case in miniature. @prtygal777's 69M-view post, six days
 * old and judged a meme; @Infinitidigits' 0-view quote of it, picked $BI. While $BI runs by the
 * saved-post bars the projector shows the ORIGINAL on For You with $BI and never the quote, and the
 * launch check pushes $BI once for the original though its coin came first; once $BI is quiet,
 * nothing is shown. With the rule off, the quote is what For You showed. Nothing is fetched or sent.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Db as NotifyDb } from '@insidor/notify/deliver.ts';
import { checkLaunches } from '@insidor/notify/launch.ts';
import { buildRising, writeRising } from '@insidor/project/src/rising.ts';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const MIN = 60_000;
const DAY = 1_440 * MIN;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const ORIGINAL = 'x:5001';
const PROMO = 'x:5002';
const BI = 'Bi11111111111111111111111111111111111pump';
const iso = (ms: number) => new Date(ms).toISOString();
const policy = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, mode: 'live' as const }, rising: { ...DEFAULT_POLICY.rising, varietyOn: false } };

let db: Db;

const reading = (at: number, volume: number, trades: number) =>
  db.query(
    `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, tradable, source_vendor, source_endpoint, volume_1h_usd, buys_1h, sells_1h, last_hour_absent)
     values ('solana', $1, $2, 'solana:curve', $3, 'no_market', 40912, 'circulating', 'no_market', 'no_market', false, 'test', 'test', $4, $5, $6, null)`,
    [BI, `solana:${BI}`, iso(at), volume, Math.floor(trades / 2), Math.ceil(trades / 2)],
  );

const judged = (itemId: string) =>
  db.query(
    `insert into internal.post_judgement (item_id, judged_at, member_count, judge_id, prompt_id, looked_at, coinable, confidence, proposed_name, alternate_names, subject_spans, cost_usd)
     values ($1, $2, 1, 'judge:test', 'post-v1', 'text', true, 0.99, 'Light Baby', '[]', '[]', 0)`,
    [itemId, iso(NOW - 30 * MIN)],
  );

const fyp = async (p = policy) => (await buildRising(db, NOW as Millis, new Map(), 30 * MIN, p)).fyp;

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:prtygal', 'x', 'prtygal', 'prtygal777'), ('x:infini', 'x', 'infini', 'Infinitidigits')`);
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin, counters)
     values ($1, 'x', '5001', 'x:prtygal', $2, $2, 'such a precious moment', 'r', 'observed', '{"reach": {"value": 69258087}}')`,
    [ORIGINAL, iso(NOW - 6 * DAY)],
  );
  await db.query(
    `insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, body, raw_ref, origin, counters, reproduction_of)
     values ($1, 'x', '5002', 'x:infini', $2, $2, 'We ran Moustache Baby, but how tf did we miss this Light Baby?!', 'r', 'observed', '{"reach": {"value": 0}}', $3)`,
    [PROMO, iso(NOW - 73 * MIN), ORIGINAL],
  );
  await db.query(`insert into internal.item_found_by (item_id, lane, found_at) values ($1, 'all', $2)`, [PROMO, iso(NOW - 73 * MIN)]);
  await judged(ORIGINAL);
  await judged(PROMO);
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'BI', 'Baby Intelligence', '{}'::jsonb, $3, 'live_stream')`,
    [BI, `solana:${BI}`, iso(NOW - 67 * MIN)],
  );
  await db.query(
    `insert into internal.post_coin_pick (item_id, address, outcome, decided_at, evidence, updated_at) values ($1, $2, 'picked', $3, '{}'::jsonb, $3), ($4, null, 'waiting', $3, '{}'::jsonb, $3)`,
    [PROMO, BI, iso(NOW - 11 * MIN), ORIGINAL],
  );
  await db.query(`insert into people.profile (user_id, name) values ('u1', 'u1')`);
});

test('★ while $BI runs: the original is on For You with $BI, the quote never — and $BI is pushed once for the original', async () => {
  await reading(NOW - 2 * MIN, 207_302, 7_250);
  const off = { ...policy, rising: { ...policy.rising, promotion: { on: false } } };
  assert.deepEqual((await fyp(off)).map((p) => p.id), [PROMO], 'before the rule: the quote, at 0 views, by its running coin');

  const notify = db as unknown as NotifyDb;
  const launches = () => checkLaunches(notify, { policy: DEFAULT_POLICY.notify, now: () => NOW, onPick: true, revivals: true });
  assert.equal(await launches(), 0, 'the first look sends nothing');

  const shown = await fyp();
  assert.deepEqual(shown.map((p) => p.id), [ORIGINAL]);
  const card = shown[0];
  assert.equal(card?.coins.kind === 'matched' ? card.coins.coin.address : null, BI, 'the card carries the promotion\'s coin');
  assert.equal(card?.coins.kind === 'matched' ? card.coins.evidence.linksPost : 'none', null, 'no link claimed: the coin does not link the original');
  assert.equal(card?.postedAt.at, NOW - 6 * DAY, 'the card says the post\'s real age');

  await writeRising(db, 'fyp', shown);
  assert.equal(await launches(), 1, 'one profile, one push, though $BI launched before the original came back');
  assert.equal(await launches(), 0, 'once');
});

test('★ once $BI is quiet: nothing is shown, the original no more than the quote', async () => {
  await reading(NOW - MIN, 5_000, 30);
  assert.deepEqual((await fyp()).map((p) => p.id), []);
});
