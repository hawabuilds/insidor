/**
 * ★ THE WALLET TAB'S RULES, ON THE REAL SCHEMA: a coin's gain comes from its landed buys and sells
 * in our own trade record (public.trade), at average cost, in SOL and in today's dollars; a coin
 * never bought in Insidor says so and carries no number, and so does a record that cannot be read; a coin whose narrative names it as its one coin shows that narrative, and one whose
 * match is unsure shows nothing; coins created through Insidor are listed; an outage is said.
 *
 * Balances are a recorded reply from a public wallet; prices are stand-ins; trades are rows as
 * the trade service writes them.
 */

import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';

import { readBalances } from '@insidor/chain-portfolio';
import { BALANCE, CLASSIC, TOKEN_2022, WALLET } from '@insidor/chain-portfolio/__fixtures__/wallet.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { createWallet } from '@insidor/read/src/wallet.ts';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

let db: Db;
const balances = readBalances(BALANCE, CLASSIC, TOKEN_2022);
const [CONFIDENT, UNSURE, WHOLE] = balances.tokens.map((t) => t.mint);
const tradeId = (s: string) => createHash('sha256').update(s).digest('hex');
/* A trade as the trade service leaves it: buy = lamports in, coins out; sell = coins in, lamports out. */
const trade = (wallet: string, tag: string, kind: 'buy' | 'sell', mint: string, inAmount: string, outAmount: string, status: string, at: string) =>
  db.query(
    `insert into public.trade (id, wallet, kind, venue, mint, in_amount, out_amount, status, signature, built_at, sent_at, settled_at)
     values ($1, $2, $3, 'pool', $4, $5, $6, $7, $8, $9, $9, case when $7 in ('confirmed', 'failed') then $9::timestamptz else null end)`,
    [tradeId(tag), wallet, kind, mint, inAmount, outAmount, status, `sig${tag}`, at],
  );

before(async () => {
  db = await migratedDb();
  const story = (id: string, coins: unknown) => db.query(`insert into public.story_view (story_id, payload) values ($1, $2::jsonb)`, [id, JSON.stringify({ id, title: id === 'st_one' ? 'The confident one' : 'The unsure one', coins })]);
  await story('st_one', { kind: 'one', coin: { coinId: `solana:${CONFIDENT}`, address: CONFIDENT } });
  await story('st_unsure', { kind: 'unsure', claimCount: 4 });
  await db.query(`insert into public.created_coin (address, creator, story_id, signature, created_at) values ('Made111111111111111111111111111111111pump', $1, 'st_one', 'sig', now())`, [WALLET]);
});

const route = (over: Partial<Parameters<typeof createWallet>[0]> = {}) => createWallet({
  db, log: SILENT, policy: DEFAULT_POLICY.wallet,
  reader: { balances: async () => balances },
  /* SOL at $200, every coin at $2: 0.01 SOL each, as a SOL pair says. */
  quotes: { quotes: async (addrs) => new Map(addrs.map((a) => [a, { name: null, ticker: null, priceUsd: a.startsWith('So111') ? 200 : 2, priceSol: 0.01, marketCapUsd: 9_000, liquidityUsd: null, change: { h1: 1, h6: null, h24: -3 }, bonded: false }])) },
  images: null,
  creatorFees: async () => 1_500_000_000n,
  now: () => 1_000,
  ...over,
});

const read = async (r = route(), range = '24h') => JSON.parse((await r.wallet(WALLET, range, 'me')).body);

test('★ not bought in Insidor means a dash with its reason, never a number', async () => {
  await db.query(`delete from public.trade`, []);
  const w = await read();
  for (const h of w.holdings) assert.deepEqual(h.profit, { kind: 'none', why: 'not_bought_here' });
  /* A trade record that could not be read is a dash too, with that reason instead. */
  const failing = { query: async (sql: string, params?: readonly unknown[]) => { if (sql.includes('from public.trade')) throw new Error('down'); return db.query(sql, params as unknown[]); } } as unknown as Db;
  const unread = await read(route({ db: failing }));
  for (const h of unread.holdings) assert.deepEqual(h.profit, { kind: 'none', why: 'history_unread' });
});

test('★ the gain is from landed trades in our record, at average cost: in SOL, its share of the cost, and at today\'s SOL price', async () => {
  await db.query(`delete from public.trade`, []);
  /* WHOLE (9 decimals, 1 held): bought 2 for 0.004 SOL, sold 1. One left, costing 0.002 SOL. */
  await trade(WALLET, 'b1', 'buy', WHOLE!, '4000000', '2000000000', 'confirmed', '2026-10-17T10:00:00Z');
  await trade(WALLET, 's1', 'sell', WHOLE!, '1000000000', '3000000', 'confirmed', '2026-10-17T11:00:00Z');
  /* Never landed, failed, or someone else's: none of these is money this wallet spent. */
  await trade(WALLET, 'b2', 'buy', WHOLE!, '900000000', '1000000000', 'sent', '2026-10-17T12:00:00Z');
  await trade(WALLET, 'b3', 'buy', WHOLE!, '900000000', '1000000000', 'failed', '2026-10-17T12:10:00Z');
  await trade('Other1111111111111111111111111111111111111', 'o1', 'buy', WHOLE!, '900000000', '1000000000', 'confirmed', '2026-10-17T12:20:00Z');
  /* CONFIDENT (0 decimals, 100 held): only 10 bought here, for 0.001 SOL. The rest came another way. */
  await trade(WALLET, 'c1', 'buy', CONFIDENT!, '1000000', '10', 'confirmed', '2026-10-17T09:00:00Z');

  const w = await read();
  const by = new Map(w.holdings.map((h: any) => [h.address, h.profit]));
  const whole = by.get(WHOLE) as any;
  assert.equal(whole.kind, 'known');
  /* Worth 0.01 SOL now (1 coin at 0.01), cost 0.002: +0.008 SOL, +400%, $1.60 at SOL's $200. */
  assert.ok(Math.abs(whole.sol - 0.008) < 1e-12);
  assert.ok(Math.abs(whole.costSol - 0.002) < 1e-12);
  assert.ok(Math.abs(whole.pct - 400) < 1e-9);
  assert.ok(Math.abs(whole.usd.v - 1.6) < 1e-9);
  assert.equal(whole.partial, false);
  const part = by.get(CONFIDENT) as any;
  assert.equal(part.kind, 'known');
  assert.equal(part.partial, true, 'held beyond what was bought here: measured on the part bought here only');
  assert.ok(Math.abs(part.sol - (0.1 - 0.001)) < 1e-12);
  assert.deepEqual(by.get(UNSURE), { kind: 'none', why: 'not_bought_here' });

  /* No SOL price now: the gain stays in SOL, its dollars a dash, never zero. */
  const noSol = await read(route({ quotes: { quotes: async (addrs) => new Map(addrs.filter((a) => !a.startsWith('So111')).map((a) => [a, { name: null, ticker: null, priceUsd: 2, priceSol: 0.01, marketCapUsd: 9_000, liquidityUsd: null, change: { h1: 1, h6: null, h24: -3 }, bonded: false }])) } }));
  const noSolWhole = noSol.holdings.find((h: any) => h.address === WHOLE).profit;
  assert.ok(Math.abs(noSolWhole.sol - 0.008) < 1e-12);
  assert.deepEqual(noSolWhole.usd, { v: null, why: 'no_market' });
  await db.query(`delete from public.trade`, []);
});

test('★ a narrative only on a confident match; an unsure one shows nothing', async () => {
  const w = await read();
  const byAddress = new Map(w.holdings.map((h: any) => [h.address, h]));
  assert.deepEqual((byAddress.get(CONFIDENT) as any).story, { storyId: 'st_one', title: 'The confident one' });
  assert.equal((byAddress.get(UNSURE) as any).story, null);
});

test('totals, the range\'s move, and the coins this wallet created with its unclaimed fees', async () => {
  const w = await read(route(), '6h');
  assert.equal(w.kind, 'read');
  assert.deepEqual(w.holdings[0].change, { v: null, why: 'not_reported' }, 'no 6-hour move reported is a dash, not zero');
  assert.ok(w.totalUsd.v > 0);
  assert.equal(w.created.coins.length, 1);
  assert.deepEqual(w.created.unclaimedFeesSol, { v: 1.5 });
});

test('★ an outage is said, never an empty wallet', async () => {
  const w = await read(route({ reader: { balances: async () => { throw new Error('429'); } } }));
  assert.deepEqual(w, { kind: 'unavailable', why: 'not_read_yet' });
});

test('★ the balance chart\'s one write: a point at most once a gap, a junk value never, and the history oldest first', async () => {
  const A = WALLET;
  const record = (v: number, gapMs: number) => db.query(`select public.record_wallet_snapshot($1, $2, $3)`, [A, v, gapMs]);
  await db.query(`delete from public.wallet_snapshot`, []);
  await record(100, 600_000);
  await record(200, 600_000);
  await record(300, 0);
  const rows = await db.query<{ n: number }>(`select count(*)::int as n from public.wallet_snapshot where address = $1`, [A]);
  assert.equal(rows[0]?.n, 1, 'inside the gap, and a gap of zero is still at least a minute');
  await record(-1, 600_000);
  await db.query(`select public.record_wallet_snapshot($1, $2, $3)`, ['not an address', 5, 600_000]);
  const all = await db.query<{ n: number }>(`select count(*)::int as n from public.wallet_snapshot`, []);
  assert.equal(all[0]?.n, 1);
  await db.query(`insert into public.wallet_snapshot (address, at, total_usd) values ($1, now() - interval '2 days', 50)`, [A]);
  const h = JSON.parse((await route({ now: Date.now }).history(A, '1w', 'me')).body);
  assert.deepEqual(h.points.map((p: { value: number }) => p.value), [50, 100]);
  const day = JSON.parse((await route({ now: Date.now }).history(A, '1d', 'me')).body);
  assert.deepEqual(day.points.map((p: { value: number }) => p.value), [100]);
});
