/**
 * ★ THE WALLET TAB'S RULES, ON THE REAL SCHEMA: a coin with no buy history says so and carries
 * no number; a coin whose narrative names it as its one coin shows that narrative, and one whose
 * match is unsure shows nothing; coins created through Insidor are listed; an outage is said.
 *
 * Balances are a recorded reply from a public wallet; prices and history are stand-ins.
 */

import { strict as assert } from 'node:assert';
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
const [CONFIDENT, UNSURE] = balances.tokens.map((t) => t.mint);

before(async () => {
  db = await migratedDb();
  const story = (id: string, coins: unknown) => db.query(`insert into public.story_view (story_id, payload) values ($1, $2::jsonb)`, [id, JSON.stringify({ id, title: id === 'st_one' ? 'The confident one' : 'The unsure one', coins })]);
  await story('st_one', { kind: 'one', coin: { coinId: `solana:${CONFIDENT}`, address: CONFIDENT } });
  await story('st_unsure', { kind: 'unsure', claimCount: 4 });
  await db.query(`insert into public.created_coin (address, creator, story_id, signature, created_at) values ('Made111111111111111111111111111111111pump', $1, 'st_one', 'sig', now())`, [WALLET]);
});

const route = (over: Partial<Parameters<typeof createWallet>[0]> = {}) => createWallet({
  db, log: SILENT, policy: DEFAULT_POLICY.wallet,
  reader: { balances: async () => balances, signatures: async () => [], parse: async () => [] },
  quotes: { quotes: async (addrs) => new Map(addrs.map((a) => [a, { name: null, ticker: null, priceUsd: 2, priceSol: 0.01, marketCapUsd: 9_000, liquidityUsd: null, change: { h1: 1, h6: null, h24: -3 } }])) },
  images: null,
  creatorFees: async () => 1_500_000_000n,
  now: () => 1_000,
  ...over,
});

const read = async (r = route(), range = '24h') => JSON.parse((await r.wallet(WALLET, range, 'me')).body);

test('★ no buy history means a dash with its reason, never a number', async () => {
  const w = await read();
  for (const h of w.holdings) assert.deepEqual(h.profit, { kind: 'none', why: 'no_buy_history' });
  /* History that could not be read is a dash too, with that reason instead. */
  const unread = await read(route({ reader: { balances: async () => balances, signatures: async () => ['a'], parse: async () => { throw new Error('429'); } } }));
  for (const h of unread.holdings) assert.deepEqual(h.profit, { kind: 'none', why: 'history_unread' });
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
  const w = await read(route({ reader: { balances: async () => { throw new Error('429'); }, signatures: async () => [], parse: async () => [] } }));
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
