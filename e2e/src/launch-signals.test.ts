/**
 * ★ A LAUNCH'S FIRST MINUTE, RECORDED, AND THE NIGHTLY SMART WALLET LIST (0154, policy.v214). Real schema
 * (PGlite), the real repos: chainwatch's write of the new facts, the graduation told from our own charts,
 * the list — early to 2+ graduates, a wallet across 5+ promoting accounts left out — and the prune that
 * keeps a graduate's row past the fourteen days so the list can look back thirty.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { PgChartRepo, PgSmartWalletRepo } from '@insidor/store';
import type { Db, LaunchOpenWrite } from '@insidor/store';

import { migratedDb } from './db.ts';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-31T00:20:00Z');
const P = DEFAULT_POLICY.launchSignals;
const iso = (ms: number) => new Date(ms).toISOString();
const coin = (n: string) => `${n}${'1'.repeat(40 - n.length)}pump`;

let db: Db;

const launch = (name: string, ageDays: number, buyers: readonly string[], pool = 'pump'): LaunchOpenWrite => ({
  address: coin(name),
  launchedAtMs: NOW - ageDays * DAY,
  buyers: buyers.length,
  buys: buyers.length,
  devBuyUsd: 300,
  devBuySol: 2,
  pool,
  blockShare: 0.31,
  firstBuyers: buyers,
  devSold: false,
});

/** Our charts show the coin last trading in `pool`. */
const charted = (name: string, pool: string) =>
  db.query(`insert into internal.chart_coin (address, recorded_from, from_launch, last_trade_at, pool) values ($1, $2, true, $2, $3)`, [coin(name), iso(NOW - DAY), pool]);

/** The coin's metadata links the promoting account `handle`. */
const promoted = async (name: string, handle: string) => {
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'X', 'X', '{}'::jsonb, $3, 'live_stream')`,
    [coin(name), `solana:${coin(name)}`, iso(NOW - DAY)],
  );
  await db.query(`insert into internal.coin_metadata (asset_key, outcome, content_id, social_link, read_at) values ($1, 'read', 'c', $2, $3)`, [`solana:${coin(name)}`, `https://x.com/${handle}/status/1234567890`, iso(NOW - DAY)]);
};

before(async () => {
  db = await migratedDb();
  const chart = new PgChartRepo(db);
  await chart.writeOpens([
    /* Two graduates: SMART and BOT were early to both, ONCE to one. G0 is 20 days old. */
    launch('g0', 20, ['dev0', 'SMART', 'BOT', 'ONCE']),
    launch('g1', 2, ['dev1', 'SMART', 'BOT']),
    /* BOT also bought the first second of five launches promoted by five accounts: it buys everything. */
    ...['b1', 'b2', 'b3', 'b4', 'b5'].map((n) => launch(n, 1, ['devb', 'BOT', 'SMART'])),
    /* Launched on another launchpad's own pool and still trading there: not a graduate. */
    launch('pad', 1, ['devp', 'PADONLY'], 'meteora-damm-v2'),
    launch('pad2', 1, ['devq', 'PADONLY'], 'meteora-damm-v2'),
    /* A dead launch from 20 days ago: pruned at fourteen. */
    launch('old', 20, ['devo', 'SMART']),
  ]);
  await charted('g0', 'pump-amm');
  await charted('g1', 'raydium-cpmm');
  await charted('pad', 'meteora-damm-v2');
  await charted('pad2', 'meteora-damm-v2');
  await charted('b1', 'pump');
  for (const [i, n] of ['b1', 'b2', 'b3', 'b4', 'b5'].entries()) await promoted(n, `promo${i}`);
});

test('★ the new facts land as written, the buyers in order, an empty list kept apart from not recorded', async () => {
  const rows = await db.query<{ first_buyers: string[]; dev_buy_sol: number; pool: string; block_share: number; dev_sold: boolean }>(
    `select first_buyers, dev_buy_sol, pool, block_share, dev_sold from internal.launch_open where address = $1`,
    [coin('g1')],
  );
  assert.deepEqual(rows[0]?.first_buyers, ['dev1', 'SMART', 'BOT']);
  assert.equal(rows[0]?.dev_buy_sol, 2);
  assert.equal(rows[0]?.pool, 'pump');
  assert.ok(Math.abs((rows[0]?.block_share ?? 0) - 0.31) < 1e-6);
  assert.equal(rows[0]?.dev_sold, false);
  await new PgChartRepo(db).writeOpens([{ ...launch('none', 0, []), devSold: null }]);
  const none = await db.query<{ first_buyers: string[]; dev_sold: boolean | null }>(`select first_buyers, dev_sold from internal.launch_open where address = $1`, [coin('none')]);
  assert.deepEqual(none[0]?.first_buyers, []);
  assert.equal(none[0]?.dev_sold, null);
});

test('★ the night: graduates told by a pool change, early to 2+ of them is smart, a wallet across 5+ accounts is not', async () => {
  const repo = new PgSmartWalletRepo(db);
  assert.equal(await repo.lastJudgedOn(), null);
  const dry = await repo.judge(NOW, P.smart, false);
  assert.equal(dry.marked, 0, 'a dry run marks nothing');

  const run = await repo.judge(NOW, P.smart, true);
  assert.equal(run.marked, 2, 'g0 and g1; the pad coins never left their pool');
  assert.equal(run.graduates, 2);
  assert.equal(run.judgedOn, '2026-10-31');
  const list = await db.query<{ wallet: string; graduates: number; accounts: number }>(`select wallet, graduates, accounts from internal.smart_wallet order by wallet`);
  /* SMART is on the five promoted launches too, so it sees five accounts as well — and is left out with BOT. */
  assert.deepEqual(list.map((r) => r.wallet), []);
  assert.equal(run.wallets, 0);
  const runs = await db.query<{ wallets: number }>(`select wallets from internal.smart_wallet_run`);
  assert.deepEqual(runs, [{ wallets: 0 }], 'an empty night is a run row, not a missing one');
});

test('★ a wallet early to two graduates and on few accounts is on the list; the list as it stood before a launch is the one a replay gets', async () => {
  /* Take SMART off four of the five promoted launches: it now sees one account. */
  await db.query(`update internal.launch_open set first_buyers = array['devb', 'BOT'] where address = any ($1::text[])`, [['b2', 'b3', 'b4', 'b5'].map(coin)]);
  const repo = new PgSmartWalletRepo(db);
  const run = await repo.judge(NOW, P.smart, true);
  assert.equal(run.marked, 0, 'already marked');
  const list = await db.query<{ wallet: string; graduates: number; accounts: number }>(`select wallet, graduates, accounts from internal.smart_wallet`);
  assert.deepEqual(list, [{ wallet: 'SMART', graduates: 2, accounts: 1 }]);
  assert.equal(await repo.lastJudgedOn(), '2026-10-31');
  assert.equal((await repo.listBefore(NOW - 1)).judgedOn, null, 'before the night ran there was no list');
  assert.deepEqual([...(await repo.listBefore(NOW + DAY)).wallets], ['SMART']);
});

test('★ the prune keeps a graduate thirty days and everything else fourteen', async () => {
  const gone = await new PgChartRepo(db).pruneOpens(NOW - P.keepMs, NOW - P.keepGraduatesMs);
  assert.equal(gone, 1);
  const left = await db.query<{ address: string }>(`select address from internal.launch_open where address = any ($1::text[])`, [[coin('old'), coin('g0')]]);
  assert.deepEqual(left.map((r) => r.address), [coin('g0')]);
});
