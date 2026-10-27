/**
 * The runner's one-coin pass over a fake store: a launch tied by link, name and picture becomes a
 * candidate and is watched for an hour; a name hit asks for its picture to be embedded; a post whose
 * coin already trades gets it by the second path; the pick is judged on trades when the feed runs
 * and on readings, saying so, when it does not; a held coin's rug grace survives in the stored pick.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CandidateRow, ExistingCoinRow, PickWrite, PriorCoinRow, RecentLaunch, RecentPost, StoredPick, TradeRollup } from '@insidor/store';

import type { Logger } from '../log.ts';
import { holderOf, newOneCoinState, oneCoinPass, pickWrite, type OneCoinDeps } from './one-coin.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const NOW = 10_000 * MIN;

interface World {
  launches: RecentLaunch[];
  posts: RecentPost[];
  /** Posts older than the window, read only by id. */
  older: RecentPost[];
  named: ExistingCoinRow[];
  /** Every coin the lookback could read, filtered by launch here as the store does. */
  prior: PriorCoinRow[];
  trades: Map<string, TradeRollup> | null;
  feedAt: number | null;
  market: Map<string, { capUsd: number; peakCapUsd: number; readAtMs: number; liquidityUsd?: number | null }>;
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
    postsByIds: async (ids) => w.older.filter((p) => ids.includes(p.itemId)),
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
    marketFacts: async () => new Map([...w.market].map(([a, m]) => [a, { ...m, liquidityUsd: m.liquidityUsd ?? null }] as const)),
    coinsNamed: async () => w.named,
    coinsLaunchedBetween: async (_names, _words, fromMs, toMs) => w.prior.filter((c) => c.launchedAtMs !== null && c.launchedAtMs >= fromMs && c.launchedAtMs < toMs),
    picks: async (_kind, ids) => new Map([...w.picks].filter(([id]) => ids.includes(id))),
    writePicks: async (_kind, picks, previous) => {
      w.writes.push(...picks);
      for (const p of picks) w.picks.set(p.subjectId, { subjectId: p.subjectId, address: p.address, outcome: p.outcome, decidedAtMs: p.decidedAtMs, evidence: p.evidence });
      return picks.filter((p) => (previous.get(p.subjectId)?.address ?? null) !== p.address).length;
    },
    appliedFit: async () => null,
  };
}

const world = (o: Partial<World> = {}): World => ({ launches: [], posts: [], older: [], named: [], prior: [], trades: null, feedAt: null, market: new Map(), candidates: [], watched: [], picks: new Map(), writes: [], embedded: [], ...o });
const post: RecentPost = { itemId: 'x:2111', postedAtMs: NOW - 20 * MIN, judgeNames: ['Pancake'], guessNames: ['PANCAT'], hash: 'ffffffffffffffff', text: null };
const launch = (o: Partial<RecentLaunch>): RecentLaunch => ({ address: 'A1', assetKey: 'k:A1', launchedAtMs: NOW - 12 * MIN, name: 'Other', ticker: 'OTH', imageUri: 'https://img/a1', hash: null, linksPosts: [], linksThrough: [], ...o });

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

test('★ a launch linking its own quote of an older post is that post\'s candidate, the post read by id', async () => {
  const old: RecentPost = { itemId: 'x:baby', postedAtMs: NOW - 26 * 60 * MIN, judgeNames: ['BABY'], guessNames: [], hash: null, text: 'such a precious moment' };
  const w = world({
    posts: [post],
    older: [old],
    launches: [launch({ address: 'HI', assetKey: 'k:HI', name: 'Human Intelligence', ticker: 'HI', linksPosts: ['x:quote'], linksThrough: [{ itemId: 'x:baby', via: 'x:quote' }] })],
  });
  await oneCoinPass(deps(w), newOneCoinState());
  assert.deepEqual(w.candidates.map((c) => [c.itemId, c.address]), [['x:baby', 'HI']]);
  assert.deepEqual(w.candidates[0]?.evidence['ties'], ['link']);
  assert.equal(w.candidates[0]?.evidence['linkedThrough'], 'x:quote');
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

test('★ lookback: an older coin the post names, read hours ago under the bar, is a candidate judged from now', async () => {
  const H = 60 * MIN;
  const kim: RecentPost = { itemId: 'x:kim', postedAtMs: NOW - 10 * MIN, judgeNames: ['KIMJONG', 'KIMJONGUN'], guessNames: [], hash: null, text: 'Unconfirmed reports claim Kim Jong Un may have secretly died' };
  const w = world({
    posts: [kim],
    prior: [
      { address: 'ESAB', name: 'Rip Kim Jong-Un', ticker: 'Kim', launchedAtMs: kim.postedAtMs - 17 * H, capUsd: 14_100, liquidityUsd: 8_726, readAtMs: kim.postedAtMs - 16 * H },
      { address: 'BARE', name: null, ticker: 'Kim', launchedAtMs: kim.postedAtMs - 5 * H, capUsd: 381_537, liquidityUsd: 0.01, readAtMs: NOW },
      { address: 'OLD', name: 'Rip Kim Jong-Un', ticker: 'Kim', launchedAtMs: kim.postedAtMs - 50 * H, capUsd: 30_000, liquidityUsd: 9_000, readAtMs: NOW },
    ],
  });
  await oneCoinPass(deps(w), newOneCoinState());
  assert.deepEqual(w.candidates.map((c) => [c.itemId, c.address, c.path]), [['x:kim', 'ESAB', 'existing']]);
  assert.deepEqual(w.candidates[0]?.evidence['ties'], ['name_text', 'existing']);
  assert.ok(w.watched.some((x) => x.address === 'ESAB' && x.untilMs === NOW + DEFAULT_POLICY.oneCoin.watchMs));
});

test('★ a later coin that only shares the name does not take the post from the older coin it was about', async () => {
  const H = 60 * MIN;
  /* 19 Oct: the post at 17:53, "Rip Kim Jong-Un" 17 h old, "Kim" launched 3 h after the post on a namer ticker. */
  const kim: RecentPost = { itemId: 'x:kim', postedAtMs: NOW - 3 * H - 10 * MIN, judgeNames: ['KIMJONG', 'KIMJONGUN'], guessNames: ['Rip Kim Jong-Un', 'KIM'], hash: null, text: 'Unconfirmed reports claim Kim Jong Un may have secretly died' };
  const w = world({
    posts: [kim],
    prior: [{ address: 'ESAB', name: 'Rip Kim Jong-Un', ticker: 'Kim', launchedAtMs: kim.postedAtMs - 17 * H, capUsd: 14_100, liquidityUsd: 8_726, readAtMs: kim.postedAtMs - 16 * H }],
    launches: [launch({ address: 'LATE', assetKey: 'k:LATE', name: null, ticker: 'Kim', launchedAtMs: NOW - 8 * MIN })],
    market: new Map([['LATE', { capUsd: 381_537, peakCapUsd: 381_537, readAtMs: NOW, liquidityUsd: 0.01 }]]),
  });
  await oneCoinPass(deps(w), newOneCoinState());
  assert.deepEqual(w.candidates.map((c) => [c.address, c.path]).sort(), [['ESAB', 'existing'], ['LATE', 'launch']]);
  assert.equal(w.picks.get('x:kim')?.outcome, 'waiting', 'the older coin is not read yet: no pick, never the later one');
  /* Once read, the older coin is the post's. */
  w.market.set('ESAB', { capUsd: 578_000, peakCapUsd: 578_000, readAtMs: NOW, liquidityUsd: 72_000 });
  await oneCoinPass(deps(w, NOW + MIN), newOneCoinState());
  assert.equal(w.picks.get('x:kim')?.address, 'ESAB');
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

test('★ a held coin\'s rug grace is stored with the pick and read back as the holder, so a restart does not restart it', () => {
  const since = NOW - 7 * MIN;
  const write = pickWrite('x:1', { kind: 'picked', address: 'A', sinceMs: NOW - 20 * MIN, confirmed: true, handedOverFrom: null, underShareSinceMs: since, basis: 'market_readings', standings: [] }, undefined, NOW, 'live');
  const stored: StoredPick = { subjectId: 'x:1', address: write.address, outcome: write.outcome, decidedAtMs: write.decidedAtMs, evidence: write.evidence };
  assert.deepEqual(holderOf(stored), { address: 'A', sinceMs: NOW - 20 * MIN, underShareSinceMs: since });
  /* A pick written before the grace existed has none: it is not under. */
  assert.deepEqual(holderOf({ ...stored, evidence: {} }), { address: 'A', sinceMs: NOW - 20 * MIN, underShareSinceMs: null });
  assert.equal(holderOf({ ...stored, outcome: 'waiting', address: null }), null);
});

test('★ stated name: a post found after its stated coin launched gets it; the owner\'s coin call is never re-opened by it', async () => {
  /* @TocRadio (23 Oct): judged YOU MISSED BITCHES; "You Missed Coin" ($BITCHES) launched after the post. */
  const origin: RecentPost = { itemId: 'x:toc', postedAtMs: NOW - 120 * MIN, judgeNames: ['YOU MISSED BITCHES'], guessNames: [], hash: null, text: 'a custom gold coin that reads "YOU MISSED BITCHES"' };
  const real = { address: 'REAL', name: 'You Missed Coin', ticker: 'BITCHES', launchedAtMs: NOW - 60 * MIN, capUsd: 300_000, readAtMs: NOW - MIN, liquidityUsd: null };
  const copycat = { address: 'COPY', name: 'You Missed Bitches', ticker: 'YMB', launchedAtMs: NOW - 110 * MIN, capUsd: 40_000, readAtMs: NOW - MIN, liquidityUsd: null };
  const w = world({ posts: [origin], prior: [real, copycat], market: new Map([['REAL', { capUsd: 300_000, peakCapUsd: 300_000, readAtMs: NOW - MIN }], ['COPY', { capUsd: 40_000, peakCapUsd: 40_000, readAtMs: NOW - MIN }]]) });
  await oneCoinPass(deps(w), newOneCoinState());
  assert.deepEqual(w.candidates.map((c) => [c.address, c.evidence['ties']]), [['REAL', ['name_stated']]]);
  assert.equal(w.picks.get('x:toc')?.address, 'REAL');

  /* The copycat held, the owner called it right: the stated coin's tie is dropped for this post. */
  const held = world({
    candidates: [
      { itemId: 'x:toc', address: 'COPY', path: 'launch', evidence: { ties: ['name_judge'] }, launchedAtMs: NOW - 110 * MIN, foundAtMs: NOW - 30 * MIN },
      { itemId: 'x:toc', address: 'REAL', path: 'launch', evidence: { ties: ['name_stated'] }, launchedAtMs: NOW - 60 * MIN, foundAtMs: NOW - 20 * MIN },
    ],
    market: new Map([['REAL', { capUsd: 60_000, peakCapUsd: 60_000, readAtMs: NOW - MIN }], ['COPY', { capUsd: 40_000, peakCapUsd: 40_000, readAtMs: NOW - MIN }]]),
    picks: new Map([['x:toc', { subjectId: 'x:toc', address: 'COPY', outcome: 'picked', decidedAtMs: NOW - 25 * MIN, evidence: {} }]]),
  });
  await oneCoinPass({ ...deps(held), ownerCalled: async () => new Set(['x:toc']) }, newOneCoinState());
  assert.equal(held.picks.get('x:toc')?.address, 'COPY');
  /* Without the call, the stated coin over the bars takes it. */
  await oneCoinPass(deps(held), newOneCoinState());
  assert.equal(held.picks.get('x:toc')?.address, 'REAL');
});

test('★ the trades\' caps get dollars from the median price, so a frozen reading cannot keep a rug (2026-10-26, $DOUPI)', async () => {
  const { withDollarCaps } = await import('./one-coin.ts');
  const t = (cap: number) => ({ uniqueBuyers: 50, netBuy: 1, capUsd: null, cap, peakCap: cap, creatorSold: false });
  const trades = new Map([['a', t(100)], ['b', t(200)], ['c', t(300)], ['d', t(400)], ['e', t(500)], ['rug', t(20)]]);
  /* Five coins read at $102 a SOL; the rug's reading froze at $41,293 while its trades say 20 SOL. */
  const market = new Map([['a', { capUsd: 10_200, peakCapUsd: 10_200 }], ['b', { capUsd: 20_400, peakCapUsd: 20_400 }], ['c', { capUsd: 30_600, peakCapUsd: 30_600 }], ['d', { capUsd: 40_800, peakCapUsd: 40_800 }], ['e', { capUsd: 51_000, peakCapUsd: 51_000 }], ['rug', { capUsd: 41_293, peakCapUsd: 113_000 }]]);
  const out = withDollarCaps(trades, market);
  assert.equal(Math.round(out.get('rug')?.capUsd ?? 0), 2_040);
  /* Too few coins read both ways: nothing is guessed. */
  assert.equal(withDollarCaps(new Map([['rug', t(20)]]), market).get('rug')?.capUsd, null);
});

test('★ a post left waiting at its hour\'s end gets the coin that ran later, judged on fresh readings ("paws at you", 2026-10-27)', async () => {
  const PAWS = 'x:paws';
  const cand = (address: string, launchedAgoMin: number): CandidateRow => ({ itemId: PAWS, address, path: 'launch', evidence: { ties: ['link', 'picture'] }, launchedAtMs: NOW - launchedAgoMin * MIN, foundAtMs: NOW - launchedAgoMin * MIN });
  const waiting: StoredPick = { subjectId: PAWS, address: null, outcome: 'waiting', decidedAtMs: NOW - 9 * 60 * MIN, evidence: { reason: 'under_bars' } };
  const w = world({
    candidates: [cand('DUMPED', 10 * 60), cand('RAN', 10 * 60)],
    picks: new Map([[PAWS, waiting]]),
    /* DUMPED's market reads its frozen curve at $41k, with nothing traded in its last hour. */
    market: new Map([['DUMPED', { capUsd: 41_000, peakCapUsd: 41_000, readAtMs: NOW - 5 * MIN }], ['RAN', { capUsd: 44_000, peakCapUsd: 44_000, readAtMs: NOW - 5 * MIN }]]),
  });
  const d = deps(w);
  /* Past its hour: the open pass no longer holds the post, only the sweep can judge it. */
  const repo = { ...d.repo, openCandidates: async () => [], waitingPostPicks: async () => [waiting], lastHours: async () => new Map([['DUMPED', { volume1hUsd: 0, trades1h: 0, capUsd: 41_000 }], ['RAN', { volume1hUsd: 3_000, trades1h: 40, capUsd: 44_000 }]]) };
  await oneCoinPass({ ...d, repo }, newOneCoinState());
  assert.equal(w.picks.get(PAWS)?.outcome, 'picked');
  assert.equal(w.picks.get(PAWS)?.address, 'RAN');
});

test('a post still waiting after the sweep is left as it was: nothing written, its decided time unmoved', async () => {
  const P2 = 'x:dust';
  const waiting: StoredPick = { subjectId: P2, address: null, outcome: 'waiting', decidedAtMs: NOW - 9 * 60 * MIN, evidence: { reason: 'under_bars' } };
  const w = world({
    candidates: [{ itemId: P2, address: 'DUST', path: 'launch', evidence: { ties: ['link'] }, launchedAtMs: NOW - 600 * MIN, foundAtMs: NOW - 600 * MIN }],
    picks: new Map([[P2, waiting]]),
    market: new Map([['DUST', { capUsd: 2_800, peakCapUsd: 3_000, readAtMs: NOW - 5 * MIN }]]),
  });
  const d = deps(w);
  await oneCoinPass({ ...d, repo: { ...d.repo, openCandidates: async () => [], waitingPostPicks: async () => [waiting] } }, newOneCoinState());
  assert.equal(w.writes.length, 0);
  assert.equal(w.picks.get(P2)?.decidedAtMs, NOW - 9 * 60 * MIN);
});
