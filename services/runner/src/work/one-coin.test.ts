/**
 * The runner's one-coin pass over a fake store: a launch tied by link, name and picture becomes a
 * candidate and is watched for an hour; a name hit asks for its picture to be embedded; a post whose
 * coin already trades gets it by the second path; the pick is judged on trades when the feed runs
 * and on readings, saying so, when it does not.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CandidateRow, ExistingCoinRow, PickWrite, RecentLaunch, RecentPost, StoredPick, TradeRollup } from '@insidor/store';

import type { Logger } from '../log.ts';
import { newOneCoinState, oneCoinPass, type OneCoinDeps } from './one-coin.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const NOW = 10_000 * MIN;

interface World {
  launches: RecentLaunch[];
  posts: RecentPost[];
  named: ExistingCoinRow[];
  trades: Map<string, TradeRollup> | null;
  feedAt: number | null;
  market: Map<string, { capUsd: number; peakCapUsd: number; readAtMs: number }>;
  candidates: CandidateRow[];
  watched: { address: string; untilMs: number }[];
  picks: Map<string, StoredPick>;
  writes: PickWrite[];
  embedded: string[];
}

function fakeRepo(w: World): OneCoinDeps['repo'] {
  return {
    recentLaunches: async () => w.launches,
    recentPosts: async () => w.posts,
    similarities: async () => new Map(),
    unembedded: async (keys) => new Set(keys),
    upsertCandidates: async (rows) => {
      for (const r of rows) if (!w.candidates.some((c) => c.itemId === r.itemId && c.address === r.address)) w.candidates.push(r);
      return rows.length;
    },
    watch: async (addresses, _reason, _now, untilMs) => {
      for (const a of addresses) w.watched.push({ address: a, untilMs });
      return true;
    },
    openCandidates: async () => w.candidates,
    candidatesOf: async (ids) => w.candidates.filter((c) => ids.includes(c.itemId)),
    narrativesOf: async () => new Map(),
    tradeFeedAt: async () => w.feedAt,
    watched: async (addresses) => new Set(addresses.filter((a) => w.watched.some((x) => x.address === a))),
    tradeFacts: async () => w.trades,
    marketFacts: async () => w.market,
    coinsNamed: async () => w.named,
    picks: async (_kind, ids) => new Map([...w.picks].filter(([id]) => ids.includes(id))),
    writePicks: async (_kind, picks, previous) => {
      w.writes.push(...picks);
      for (const p of picks) w.picks.set(p.subjectId, { subjectId: p.subjectId, address: p.address, outcome: p.outcome, decidedAtMs: p.decidedAtMs, evidence: p.evidence });
      return picks.filter((p) => (previous.get(p.subjectId)?.address ?? null) !== p.address).length;
    },
    appliedFit: async () => null,
  };
}

const world = (o: Partial<World> = {}): World => ({ launches: [], posts: [], named: [], trades: null, feedAt: null, market: new Map(), candidates: [], watched: [], picks: new Map(), writes: [], embedded: [], ...o });
const post: RecentPost = { itemId: 'x:2111', postedAtMs: NOW - 20 * MIN, judgeNames: ['Pancake'], guessNames: ['PANCAT'], hash: 'ffffffffffffffff' };
const launch = (o: Partial<RecentLaunch>): RecentLaunch => ({ address: 'A1', assetKey: 'k:A1', launchedAtMs: NOW - 12 * MIN, name: 'Other', ticker: 'OTH', imageUri: 'https://img/a1', hash: null, linksPosts: [], ...o });

const deps = (w: World, now = NOW): OneCoinDeps => ({
  repo: fakeRepo(w),
  embed: async (coins) => (w.embedded.push(...coins.map((c) => c.assetKey)), coins.length),
  policy: DEFAULT_POLICY,
  log: quiet,
  now: () => now as Millis,
});

test('★ a launch tied by link, name or picture is a candidate, watched for an hour after its launch', async () => {
  const w = world({
    posts: [post],
    launches: [
      launch({ address: 'LINK', assetKey: 'k:LINK', linksPosts: ['x:2111'] }),
      launch({ address: 'NAME', assetKey: 'k:NAME', name: 'PANCAKE' }),
      launch({ address: 'PIC', assetKey: 'k:PIC', hash: 'fffffffffffffffe' }),
      launch({ address: 'NONE', assetKey: 'k:NONE' }),
      launch({ address: 'EARLY', assetKey: 'k:EARLY', name: 'Pancake', launchedAtMs: post.postedAtMs - 11 * MIN }),
    ],
  });
  const r = await oneCoinPass(deps(w), newOneCoinState());
  assert.deepEqual(w.candidates.map((c) => c.address).sort(), ['LINK', 'NAME', 'PIC']);
  assert.deepEqual(w.candidates.find((c) => c.address === 'LINK')?.evidence['ties'], ['link']);
  assert.ok(w.watched.every((x) => x.untilMs === NOW - 12 * MIN + DEFAULT_POLICY.oneCoin.watchMs));
  /* Only the coins a name or link tied are embedded; the picture-only one was compared by hash. */
  assert.deepEqual(w.embedded.sort(), ['k:LINK', 'k:NAME']);
  assert.equal(r.candidates, 3);
});

test('★ without trade data the pick is judged on readings, and the evidence says so', async () => {
  const w = world({
    posts: [post],
    launches: [launch({ address: 'NAME', assetKey: 'k:NAME', name: 'Pancake' }), launch({ address: 'B', assetKey: 'k:B', ticker: 'PANCAT' })],
    market: new Map([['NAME', { capUsd: 60_000, peakCapUsd: 60_000, readAtMs: NOW }], ['B', { capUsd: 4_000, peakCapUsd: 4_000, readAtMs: NOW }]]),
  });
  const r = await oneCoinPass(deps(w), newOneCoinState());
  const pick = w.picks.get('x:2111');
  assert.equal(pick?.outcome, 'picked');
  assert.equal(pick?.address, 'NAME');
  assert.equal(pick?.evidence['basis'], 'market_readings');
  assert.equal(pick?.evidence['note'], 'no trade data: judged on market readings');
  assert.equal(r.basis, 'market_readings');
});

test('★ with the trade feed running, net buying decides — a coin nobody buys is not picked for its cap', async () => {
  const t = (netBuy: number, uniqueBuyers: number, capUsd: number): TradeRollup => ({ uniqueBuyers, netBuy, capUsd, cap: 100, peakCap: 100, creatorSold: false });
  const w = world({
    posts: [post],
    launches: [launch({ address: 'NAME', assetKey: 'k:NAME', name: 'Pancake' }), launch({ address: 'B', assetKey: 'k:B', ticker: 'PANCAT' })],
    trades: new Map([['NAME', t(2, 4, 90_000)], ['B', t(40, 60, 30_000)]]),
    feedAt: NOW - 5_000,
    market: new Map([['NAME', { capUsd: 90_000, peakCapUsd: 90_000, readAtMs: NOW }]]),
  });
  await oneCoinPass(deps(w), newOneCoinState());
  assert.equal(w.picks.get('x:2111')?.address, 'B');
  assert.equal(w.picks.get('x:2111')?.evidence['basis'], 'trades');
});

test('second path: a post whose coin launched long before it gets the biggest coin of its name, judged from now', async () => {
  const w = world({
    posts: [post],
    named: [
      { address: 'OLDBIG', name: 'Pancake', ticker: 'PANCAKE', launchedAtMs: NOW - 3 * 24 * 60 * MIN, capUsd: 400_000, readAtMs: NOW - MIN },
      { address: 'OLDSMALL', name: 'Pancake', ticker: 'PNK', launchedAtMs: NOW - 2 * 24 * 60 * MIN, capUsd: 20_000, readAtMs: NOW - MIN },
    ],
    market: new Map([['OLDBIG', { capUsd: 400_000, peakCapUsd: 410_000, readAtMs: NOW - MIN }]]),
  });
  const state = newOneCoinState();
  await oneCoinPass(deps(w), state);
  assert.deepEqual(w.candidates.map((c) => [c.address, c.path]), [['OLDBIG', 'existing']]);
  assert.equal(w.picks.get('x:2111')?.outcome, 'picked', 'judged from the moment it became the candidate');
  /* Each post is given the second path once per process. */
  await oneCoinPass(deps(w), state);
  assert.equal(w.candidates.length, 1);
});
