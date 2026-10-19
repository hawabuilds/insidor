/**
 * ★ THE TRADE FEED'S ROWS, READ BY THE ONE-COIN RULE, on the real schema (PGlite, every migration;
 * 0112's trade tables and 0114's coverage): what chainwatch's trade watcher writes — whole minutes
 * and state, each coin's measured span, an end of measurement with its reason, the opening buy, the
 * day's counted cost — and what the runner's rule makes of it: a measured coin with buyers is picked
 * on trades, a measured coin with no trade is a real nothing, and a coin the feed stopped measuring
 * is unknown, never zero, so it holds the pick back. Nothing is fetched or paid for.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { oneCoinBars, pickOneCoin } from '@insidor/core';
import { contendersOf } from '@insidor/runner/src/work/one-coin.ts';
import { PgOneCoinRepo, PgTradeFeedRepo, type CandidateRow, type Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const MIN = 60_000;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const BUYING = 'Buyi1111111111111111111111111111pump';
const QUIET = 'Quie1111111111111111111111111111pump';
const CAPPED = 'Capp1111111111111111111111111111pump';
const iso = (ms: number) => new Date(ms).toISOString();

let db: Db;
let feed: PgTradeFeedRepo;
const repo = () => new PgOneCoinRepo(db);

async function coin(address: string, launchedMs: number): Promise<void> {
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'T', 'T', '{}'::jsonb, $3, 'backfill')`,
    [address, `solana:${address}`, iso(launchedMs)],
  );
  await db.query(`insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_usd, market_cap_basis, liquidity_absent, price_change_24h_absent, tradable, source_vendor, source_endpoint)
     values ('solana', $1, $2, 'solana:curve', $3, 'no_market', 40000, 'circulating', 'no_market', 'no_market', false, 'test', 'test')`, [address, `solana:${address}`, iso(NOW - MIN)]);
  await db.query(`insert into internal.coin_watch (address, reason, since, until) values ($1, 'one_coin', $2, $3)`, [address, iso(launchedMs), iso(launchedMs + 60 * MIN)]);
}

const row = (address: string): CandidateRow => ({ itemId: 'x:1', address, path: 'launch', evidence: { ties: ['name_judge'] }, launchedAtMs: NOW - 20 * MIN, foundAtMs: NOW - 20 * MIN });

async function judge(addresses: readonly string[]) {
  const r = repo();
  const [trades, feedAt, watched, market] = await Promise.all([r.tradeFacts(addresses), r.tradeFeedAt(), r.watched(addresses, NOW), r.marketFacts(addresses, NOW - 2 * 60 * MIN)]);
  const running = trades !== null && feedAt !== null && NOW - feedAt <= DEFAULT_POLICY.oneCoin.tradeFeedFreshMs;
  return pickOneCoin(contendersOf(addresses.map(row), running ? trades : null, watched, market), null, NOW, running, oneCoinBars(DEFAULT_POLICY.oneCoin));
}

before(async () => {
  db = await migratedDb();
  feed = new PgTradeFeedRepo(db, 'solana');
  for (const a of [BUYING, QUIET, CAPPED]) await coin(a, NOW - 20 * MIN);
  const measured = NOW - 19 * MIN;
  /* What the watcher writes: twenty wallets buying the first coin, nothing on the second, and the third cut off at its byte cap. */
  await feed.write({
    minutes: [
      { address: BUYING, minuteMs: NOW - 15 * MIN, buys: 20, sells: 2, buyers: 20, newBuyers: 20, buySol: 12, sellSol: 1, creatorSoldSol: 0, lastMcapSol: 220, lastMcapUsd: null },
      { address: CAPPED, minuteMs: NOW - 15 * MIN, buys: 3, sells: 0, buyers: 3, newBuyers: 3, buySol: 1, sellSol: 0, creatorSoldSol: 0, lastMcapSol: 60, lastMcapUsd: null },
    ],
    states: [
      { address: BUYING, uniqueBuyers: 20, peakMcapSol: 230, lastMcapSol: 220, creatorSold: false, firstTradeMs: NOW - 16 * MIN, lastTradeMs: NOW - 15 * MIN },
      { address: CAPPED, uniqueBuyers: 3, peakMcapSol: 60, lastMcapSol: 60, creatorSold: false, firstTradeMs: NOW - 15 * MIN, lastTradeMs: NOW - 15 * MIN },
    ],
    cover: [
      { address: BUYING, measuredFromMs: measured, measuredToMs: NOW - 5_000, unmeasured: null, addBytes: 60_000 },
      { address: QUIET, measuredFromMs: measured, measuredToMs: NOW - 5_000, unmeasured: null, addBytes: 300 },
      { address: CAPPED, measuredFromMs: measured, measuredToMs: NOW - 5_000, unmeasured: { fromMs: NOW - 14 * MIN, reason: 'coin_cap' }, addBytes: 20_000_001 },
    ],
    openings: [{ address: QUIET, creatorBuyTokens: 1_000_000, creatorBuySol: 0.03, launchMcapSol: 28 }],
    day: { dayMs: Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), new Date(NOW).getUTCDate()), bytes: 20_060_301, rpcCalls: 3, credits: 404 },
    nowMs: NOW - 5_000,
  });
});

test('★ the watcher\'s rows land as written: coverage, the end and its reason, bytes, the opening buy and the day', async () => {
  const w = await db.query<{ address: string; measured_from: string; measured_to: string; unmeasured_from: string | null; unmeasured_reason: string | null; data_bytes: string }>(
    `select address, measured_from, measured_to, unmeasured_from, unmeasured_reason, data_bytes::text from internal.coin_watch order by address`,
  );
  const capped = w.find((r) => r.address === CAPPED)!;
  assert.equal(capped.unmeasured_reason, 'coin_cap');
  assert.equal(new Date(capped.measured_to).getTime(), NOW - 14 * MIN, 'a heartbeat never runs past the end of measurement');
  assert.equal(capped.data_bytes, '20000001');
  const [a] = await db.query<{ creator_buy_sol: string; launch_mcap_sol: string }>(`select creator_buy_sol::text, launch_mcap_sol::text from public.asset where address = $1`, [QUIET]);
  assert.deepEqual([Number(a?.creator_buy_sol), Number(a?.launch_mcap_sol)], [0.03, 28]);
  assert.deepEqual(await feed.missingOpenings([QUIET, BUYING]), new Set([BUYING]));
  assert.equal((await feed.day(NOW))?.credits, 404);
  assert.deepEqual((await feed.watchList(NOW, DEFAULT_POLICY.oneCoin.watchMs)).map((c) => [c.address, c.unmeasured]).sort(), [[BUYING, false], [CAPPED, true], [QUIET, false]].sort());
});

test('★ the rule reads them: the coin twenty wallets are buying is picked on trades over a measured quiet one', async () => {
  assert.equal(await repo().tradeFeedAt(), NOW - 5_000, 'the heartbeat says the feed is running');
  const o = await judge([BUYING, QUIET]);
  assert.equal(o.kind, 'picked');
  assert.equal(o.kind === 'picked' ? o.address : null, BUYING);
  assert.equal(o.kind === 'picked' ? o.basis : null, 'trades');
  const quiet = o.kind === 'picked' ? o.standings.find((s) => s.address === QUIET) : undefined;
  assert.deepEqual([quiet?.measured, quiet?.strength], [true, 0], 'watched and measured with no trade: a real nothing');
});

test('★ a coin the feed stopped measuring is unknown, never zero: it is not read as quiet, and it holds the pick back', async () => {
  assert.equal((await repo().tradeFacts([CAPPED]))?.has(CAPPED), false, 'its partial totals are not handed to the rule');
  assert.equal((await repo().watched([CAPPED], NOW)).has(CAPPED), false);
  const o = await judge([BUYING, CAPPED]);
  assert.equal(o.kind, 'waiting');
  assert.equal(o.kind === 'waiting' ? o.reason : null, 'rival_unmeasured');
  assert.equal(o.kind === 'waiting' ? o.standings.find((s) => s.address === CAPPED)?.measured : null, false);
});

test('a restart ends what the previous process was measuring, from its last heartbeat', async () => {
  assert.equal(await feed.markRestarted(NOW), 2);
  const rows = await db.query<{ address: string; unmeasured_from: string; unmeasured_reason: string }>(`select address, unmeasured_from, unmeasured_reason from internal.coin_watch where unmeasured_reason = 'restart' order by address`);
  assert.deepEqual(rows.map((r) => [r.address, new Date(r.unmeasured_from).getTime()]), [[BUYING, NOW - 5_000], [QUIET, NOW - 5_000]]);
  assert.equal((await repo().watched([BUYING, QUIET], NOW)).size, 0);
});
