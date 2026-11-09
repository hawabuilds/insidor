/**
 * The launch-intelligence arithmetic (launch-intel.ts) on made-up launches: early wallets, smart wallets
 * with bots left out, teams by creator, funder and shared early wallets, the rug and peak tables, and the
 * copy-tests of the early-pick line, the rug hold and the pick rule.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { LaunchRecord } from '../../adapters/storage/supabase/src/launch-archive.ts';
import {
  BOT_MAX_LAUNCHES, buildTeams, copyTestEarlyLine, copyTestPicks, copyTestRugHold, earlyWallets, MIN_GROUP, peakBucket, rate, rugTable, smartWallets, tallyWallets,
  type PushCase, type TeamLaunch,
} from './launch-intel.ts';

const launch = (over: Partial<LaunchRecord>): LaunchRecord => ({
  address: 'A', launchedAt: 0, pool: 'pump', creator: 'dev', buyers: 0, buys: 0, devBuyUsd: null, devBuySol: null, blockShare: null,
  firstBuyers: null, devSold: null, name: null, symbol: null, metadataUri: null, minuteBuys: null, ...over,
});

test('early wallets: first ten seconds, the creator left out, each once; the first-second list when no minute buys', () => {
  assert.deepEqual(earlyWallets(launch({ minuteBuys: [{ w: 'dev', sol: 1, ms: 0 }, { w: 'a', sol: 1, ms: 200 }, { w: 'a', sol: 1, ms: 900 }, { w: 'b', sol: 1, ms: 9_000 }, { w: 'late', sol: 1, ms: 30_000 }] })), ['a', 'b']);
  assert.deepEqual(earlyWallets(launch({ firstBuyers: ['x', 'y'] })), ['x', 'y']);
});

test('smart wallets: early to 2+ winners at 3x the base rate; a wallet in every launch is a bot, never smart', () => {
  const ls: { early: string[]; won: boolean }[] = [];
  for (let i = 0; i < 100; i += 1) ls.push({ early: ['bot', ...(i < 3 ? ['ace'] : []), ...(i % 5 === 0 ? ['meh'] : [])], won: i < 3 || i === 50 });
  const s = smartWallets(tallyWallets(ls));
  assert.deepEqual(s.map((x) => x.wallet), ['ace']);
  assert.ok(100 > BOT_MAX_LAUNCHES);
});

test('teams: the same creator, the same funder, or two shared early wallets join launches; bots never link', () => {
  const t = (address: string, over: Partial<TeamLaunch>): TeamLaunch => ({ address, creator: null, funder: null, early: [], won: false, rug: null, peakAt: null, launchedAt: 0, ...over });
  const teams = buildTeams([
    t('1', { creator: 'c1', rug: true }),
    t('2', { creator: 'c1', rug: true }),
    t('3', { funder: 'f1', creator: 'c2' }),
    t('4', { funder: 'f1', creator: 'c3', won: true }),
    t('5', { early: ['w1', 'w2', 'bot'] }),
    t('6', { early: ['w2', 'w1'] }),
    t('7', { early: ['bot', 'w9'] }),
    t('8', { early: ['bot', 'w8'] }),
  ], new Set(['bot']));
  const byFirst = new Map(teams.map((x) => [x.launches.slice().sort().join(','), x]));
  assert.deepEqual([...byFirst.keys()].sort(), ['1,2', '3,4', '5,6']);
  assert.equal(byFirst.get('1,2')?.rugs, 2);
  assert.deepEqual(byFirst.get('3,4')?.via, ['funder']);
  assert.equal(byFirst.get('3,4')?.wins, 1);
});

test('a rate under the minimum group says too few, never a percentage', () => {
  assert.equal(rate(1, MIN_GROUP - 1).pct, null);
  assert.equal(rate(15, 60).pct, 25);
  const t = rugTable(Array.from({ length: 40 }, (_, i) => ({ f: { devSoldEarly: i < 20, blockShare: null, devBuySol: null, buyers: 0, smart: 0, teamRugShare: null }, rug: i < 15 })));
  assert.equal(t['all launches']?.pct, 37.5);
  assert.equal(t['dev sold in first minute']?.pct, null);
});

test('peak buckets by hours after launch', () => {
  const H = 3_600_000;
  assert.equal(peakBucket(0, 30 * 60_000), 'under 1 hour');
  assert.equal(peakBucket(0, 5 * H), '1-12 hours');
  assert.equal(peakBucket(0, 20 * H), '12-24 hours');
  assert.equal(peakBucket(0, 50 * H), '1-3 days');
  assert.equal(peakBucket(0, 100 * H), '3-7 days');
});

test('copy-tests: a higher early line drops pushes that never crossed it and keeps, later, those that did', () => {
  const c = (capAtPush: number, peak1h: number, ranAfter: boolean, early = true, rugRisk = false): PushCase => ({ address: 'x', capAtPush, early, peak1h, ranAfter, rugRisk });
  const r = copyTestEarlyLine([c(12_200, 12_500, false), c(12_100, 40_000, true), c(20_000, 90_000, true), c(12_300, 12_900, true)], 13_000);
  assert.equal(r.dropped, 2);
  assert.equal(r.droppedGood, 1);
  assert.equal(r.delayed, 1);
  const h = copyTestRugHold([c(20_000, 1, false, false, true), c(20_000, 1, true, false, false)]);
  assert.equal(h.held, 1);
  assert.equal(h.heldGood, 0);
});

test('pick copy-test: against the biggest coin an hour in, as picked and with the rug and smart-wallet rule', () => {
  const r = copyTestPicks([
    { picked: 'rug', candidates: [{ address: 'rug', peak1h: 10, rugRisk: true, smart: 0 }, { address: 'good', peak1h: 90, rugRisk: false, smart: 1 }] },
    { picked: 'a', candidates: [{ address: 'a', peak1h: 50, rugRisk: false, smart: 0 }, { address: 'b', peak1h: 20, rugRisk: false, smart: 0 }] },
    { picked: 'a', candidates: [{ address: 'a', peak1h: null, rugRisk: false, smart: 0 }] },
  ]);
  assert.equal(r.asPicked.n, 2);
  assert.equal(r.asPicked.hits, 1);
  assert.equal(r.withRule.hits, 2);
});
