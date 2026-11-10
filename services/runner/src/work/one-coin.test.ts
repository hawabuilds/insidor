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
import { gateWrite, holderOf, newOneCoinState, oneCoinPass, pickWrite, withCandleCaps, type OneCoinDeps } from './one-coin.ts';

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

test('★ a coin linking a post the judge answered for after the coin\'s rematch window is still that post\'s candidate', async () => {
  /* $8FDW22, 29 Oct: launched with its post, matched against nothing while the judge had not answered, then never looked at again. */
  const w = world({ posts: [post] });
  const linked = launch({ address: 'LATE', assetKey: 'k:LATE', launchedAtMs: post.postedAtMs + MIN, linksPosts: ['x:2111'] });
  const elsewhere = launch({ address: 'OTHER', assetKey: 'k:OTHER', launchedAtMs: post.postedAtMs + MIN, name: 'Pancake' });
  const asked: string[][] = [];
  const d = deps(w);
  const repo = { ...d.repo, launchesLinking: async (ids: readonly string[]) => (asked.push([...ids]), [linked, elsewhere]) };
  await oneCoinPass({ ...d, repo }, newOneCoinState());
  assert.deepEqual(asked, [['x:2111']]);
  /* Only the link ties by this route; a name is the launch path's, in its own window. */
  assert.deepEqual(w.candidates.map((c) => [c.itemId, c.address, c.evidence['ties']]), [['x:2111', 'LATE', ['link']]]);
  assert.deepEqual(w.watched.find((x) => x.address === 'LATE')?.untilMs, NOW + DEFAULT_POLICY.oneCoin.watchMs);
  /* Asked again only when the post is new, or every five minutes for the window. */
  const state = newOneCoinState();
  await oneCoinPass({ ...d, repo }, state);
  await oneCoinPass({ ...d, repo }, state);
  assert.equal(asked.length, 2);
  await oneCoinPass({ ...deps(w, NOW + 5 * MIN), repo }, state);
  assert.equal(asked.length, 3);
});

test('★ a coin linking a post that is already its candidate keeps its ties and its watch', async () => {
  const had: CandidateRow = { itemId: 'x:2111', address: 'LATE', path: 'launch', evidence: { ties: ['link', 'picture'], similarity: 0.91 }, launchedAtMs: post.postedAtMs + MIN, foundAtMs: NOW - 30 * MIN };
  const w = world({ posts: [post], candidates: [had] });
  const d = deps(w);
  const linked = launch({ address: 'LATE', assetKey: 'k:LATE', launchedAtMs: post.postedAtMs + MIN, linksPosts: ['x:2111'] });
  let upserts = 0;
  const repo = { ...d.repo, launchesLinking: async () => [linked], upsertCandidates: async (rows: readonly CandidateRow[]) => ((upserts += rows.filter((r) => r.address === 'LATE').length), rows.length) };
  await oneCoinPass({ ...d, repo }, newOneCoinState());
  assert.equal(upserts, 0);
  assert.equal(w.watched.some((x) => x.address === 'LATE'), false);
});

test('★ our candles stand in for a stale reading: a launchpad coin is judged on its close (policy.v209, 4iuBjA)', () => {
  const market = new Map([['RUNpump', { capUsd: 3_248_814, peakCapUsd: 3_248_814, readAtMs: NOW - 5 * MIN, liquidityUsd: 0.01 }], ['OLDpump', { capUsd: 20_000, peakCapUsd: 30_000, readAtMs: NOW - MIN, liquidityUsd: 9_000 }]]);
  const caps = new Map([
    ['RUNpump', { capUsd: 3_471_346, peakCapUsd: 12_645_439, atMs: NOW - 2 * MIN }],
    /* A close older than the bar is no price now: the reading stays. */
    ['OLDpump', { capUsd: 90_000, peakCapUsd: 90_000, atMs: NOW - 31 * MIN - DEFAULT_POLICY.oneCoin.candles.freshMs }],
    ['NEWpump', { capUsd: 18_000, peakCapUsd: 18_000, atMs: NOW - MIN }],
  ]);
  const out = withCandleCaps(market, caps, NOW, DEFAULT_POLICY.oneCoin.candles.freshMs);
  assert.deepEqual(out.get('RUNpump'), { capUsd: 3_471_346, peakCapUsd: 12_645_439, readAtMs: NOW - MIN, liquidityUsd: null });
  assert.equal(out.get('OLDpump')?.capUsd, 20_000);
  assert.equal(out.get('NEWpump')?.capUsd, 18_000);
});

test('★ our candles are read once a minute, for launchpad coins only, and a failed read leaves the readings', async () => {
  const c = (address: string): CandidateRow => ({ itemId: 'x:1', address, path: 'launch', evidence: { ties: ['link'] }, launchedAtMs: NOW - 30 * MIN, foundAtMs: NOW - 30 * MIN });
  const w = world({ candidates: [c('RUNpump'), c('OFFCURVE')], market: new Map([['RUNpump', { capUsd: 9_000, peakCapUsd: 9_000, readAtMs: NOW - MIN, liquidityUsd: 0.01 }]]) });
  const asked: string[][] = [];
  const state = newOneCoinState();
  const at = (now: number): OneCoinDeps => ({ ...deps(w, now), candleCaps: async (addresses) => (asked.push([...addresses]), new Map([['RUNpump', { capUsd: 80_000, peakCapUsd: 80_000, atMs: now - MIN }]])) });
  await oneCoinPass(at(NOW), state);
  await oneCoinPass(at(NOW + 15_000), state);
  assert.deepEqual(asked, [['RUNpump']]);
  /* Judged on readings, the frozen $9k quote could not be picked; on its candle the coin clears. */
  assert.equal(w.picks.get('x:1')?.address, 'RUNpump');
  await oneCoinPass(at(NOW + DEFAULT_POLICY.oneCoin.candles.readEveryMs), state);
  assert.equal(asked.length, 2);
  const failing: OneCoinDeps = { ...deps(world(), NOW), candleCaps: async () => { throw new Error('down'); } };
  await oneCoinPass(failing, newOneCoinState());
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
      { address: 'OLDBIG', name: 'Pancake', ticker: 'PANCAKE', launchedAtMs: NOW - 3 * 24 * 60 * MIN, capUsd: 400_000, readAtMs: NOW - MIN, liquidityUsd: 25_000 },
      { address: 'OLDSMALL', name: 'Pancake', ticker: 'PNK', launchedAtMs: NOW - 2 * 24 * 60 * MIN, capUsd: 20_000, readAtMs: NOW - MIN, liquidityUsd: 5_000 },
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

test('★ $trump (9 Nov): an older coin on a frozen price is not picked, and a held one is dropped by the sweep', async () => {
  const frozenWorld = () => world({
    posts: [post],
    named: [{ address: 'OADY', name: 'Pancake', ticker: 'PANCAKE', launchedAtMs: NOW - 2 * 24 * 60 * MIN, capUsd: 64_129, readAtMs: NOW - MIN, liquidityUsd: null }],
    market: new Map([['OADY', { capUsd: 64_129, peakCapUsd: 65_439, readAtMs: NOW - MIN, liquidityUsd: null }]]),
  });
  /* Without the lookup (a repo before it): picked on its frozen $64k, as on 9 Nov. */
  const before = frozenWorld();
  await oneCoinPass(deps(before), newOneCoinState());
  assert.equal(before.picks.get('x:2111')?.address, 'OADY');
  /* With it: still the post's candidate, never its pick. */
  const asked: string[][] = [];
  const after = frozenWorld();
  const d = deps(after);
  await oneCoinPass({ ...d, repo: { ...d.repo, frozenPrices: async (a: readonly string[]) => (asked.push([...a]), new Set(['OADY'])) } }, newOneCoinState());
  assert.deepEqual(after.candidates.map((c) => c.address), ['OADY']);
  assert.notEqual(after.picks.get('x:2111')?.address, 'OADY');
  assert.deepEqual(asked, [['OADY']], 'asked only for the older coin');

  /* Held past its hour (the open pass no longer judges it): the sweep drops it. */
  const ID = 'x:trump';
  const cand: CandidateRow = { itemId: ID, address: 'OADY', path: 'existing', evidence: { ties: ['name_judge', 'existing'] }, launchedAtMs: NOW - 2 * 24 * 60 * MIN, foundAtMs: NOW - 5 * 60 * MIN };
  const held: StoredPick = { subjectId: ID, address: 'OADY', outcome: 'picked', decidedAtMs: NOW - 4 * 60 * MIN, evidence: { standings: [{ address: 'OADY', ties: ['name_judge', 'existing'] }] } };
  const w = world({ candidates: [cand], picks: new Map([[ID, held]]), trades: new Map(), market: new Map([['OADY', { capUsd: 64_129, peakCapUsd: 65_439, readAtMs: NOW - MIN, liquidityUsd: null }]]) });
  const s = deps(w);
  const sweep = { ...s.repo, openCandidates: async () => [], heldPostPicks: async () => [held] };
  await oneCoinPass({ ...s, repo: { ...sweep, frozenPrices: async () => new Set(['OADY']) } }, newOneCoinState());
  assert.equal(w.picks.get(ID)?.outcome, 'waiting');
  /* A held coin made for the post is never looked up: the flag is for older coins only. */
  const launchHeld: StoredPick = { ...held, subjectId: 'x:made', evidence: { standings: [{ address: 'OADY', ties: ['link'] }] } };
  const lookups: string[][] = [];
  const w2 = world({ candidates: [{ ...cand, itemId: 'x:made', path: 'launch', evidence: { ties: ['link'] } }], picks: new Map([['x:made', launchHeld]]), trades: new Map() });
  const s2 = deps(w2);
  await oneCoinPass({ ...s2, repo: { ...s2.repo, openCandidates: async () => [], heldPostPicks: async () => [launchHeld], frozenPrices: async (a: readonly string[]) => (lookups.push([...a]), new Set(a)) } }, newOneCoinState());
  assert.deepEqual(lookups, []);
  assert.equal(w2.picks.get('x:made')?.address, 'OADY');

  /* Its narrative, judged only while a post is in its hour, is let go by the narrative sweep. */
  const N = 'n-x:trump';
  const nPick: StoredPick = { subjectId: N, address: 'OADY', outcome: 'picked', decidedAtMs: NOW - 4 * 60 * MIN, evidence: {} };
  const narrativeWrites: PickWrite[] = [];
  const w3 = world({ candidates: [cand], trades: new Map(), market: new Map([['OADY', { capUsd: 64_129, peakCapUsd: 65_439, readAtMs: NOW - MIN, liquidityUsd: null }]]) });
  const s3 = deps(w3);
  await oneCoinPass({ ...s3, repo: {
    ...s3.repo,
    openCandidates: async () => [],
    heldFrozenNarrativePicks: async () => [{ pick: nPick, members: [ID] }],
    frozenPrices: async () => new Set(['OADY']),
    writePicks: async (kind, picks, previous, mode, at) => (kind === 'narrative' && narrativeWrites.push(...picks), s3.repo.writePicks(kind, picks, previous, mode, at)),
  } }, newOneCoinState());
  assert.deepEqual(narrativeWrites.map((p) => [p.subjectId, p.outcome, p.address]), [[N, 'waiting', null]]);
});

test('★ the launchpad sweep: a held pick on a coin that did not launch on the launchpad is let go, post and narrative', async () => {
  /* JENSEN (9 Nov): a pool opened for a coin made elsewhere, held on a post past its hour. The candidate
     read no longer returns it (store `#onLaunchpad`), so the held pick is judged on what is left. */
  const ID = 'x:jensen';
  const N = 'n-x:jensen';
  const held: StoredPick = { subjectId: ID, address: 'POOLONLY', outcome: 'picked', decidedAtMs: NOW - 4 * 60 * MIN, evidence: {} };
  const nHeld: StoredPick = { ...held, subjectId: N };
  const w = world({ candidates: [], trades: new Map(), picks: new Map([[ID, held]]) });
  const s = deps(w);
  const asked: string[] = [];
  await oneCoinPass({ ...s, repo: {
    ...s.repo,
    openCandidates: async () => [],
    heldOffLaunchpadPicks: async (kind) => (asked.push(kind), kind === 'post' ? [{ pick: held, members: [ID] }] : [{ pick: nHeld, members: [ID] }]),
  } }, newOneCoinState());
  assert.deepEqual(asked, ['post', 'narrative']);
  assert.equal(w.picks.get(ID)?.outcome, 'none');
  assert.equal(w.picks.get(ID)?.address, null);

  /* A launchpad coin made for the post is still a candidate: it is judged on its own, not kept off. */
  const rival: CandidateRow = { itemId: ID, address: 'PADCOIN', path: 'launch', evidence: { ties: ['link'] }, launchedAtMs: NOW - 5 * 60 * MIN, foundAtMs: NOW - 5 * 60 * MIN };
  const w2 = world({ candidates: [rival], trades: new Map(), picks: new Map([[ID, held]]), market: new Map([['PADCOIN', { capUsd: 80_000, peakCapUsd: 80_000, readAtMs: NOW - MIN, liquidityUsd: null }]]) });
  const s2 = deps(w2);
  await oneCoinPass({ ...s2, repo: { ...s2.repo, openCandidates: async () => [], heldOffLaunchpadPicks: async (kind) => (kind === 'post' ? [{ pick: held, members: [ID] }] : []) } }, newOneCoinState());
  assert.notEqual(w2.picks.get(ID)?.address, 'POOLONLY');
});

test('★ the bundle screen: a pick moving to a bundled coin waits, the bundle leaves the candidates, and the next pass picks the clean coin', async () => {
  /* GTA6 (9 Nov): 19 of its top 20 holders at exactly 301,080 tokens, at $5.9M four minutes after launch. */
  const ID = 'x:gta';
  const row = (address: string): CandidateRow => ({ itemId: ID, address, path: 'launch', evidence: { ties: ['link'] }, launchedAtMs: NOW - 30 * MIN, foundAtMs: NOW - 10 * MIN });
  const w = world({
    candidates: [row('BUNDLE'), row('CLEAN')],
    trades: null,
    market: new Map([['BUNDLE', { capUsd: 5_900_000, peakCapUsd: 5_900_000, readAtMs: NOW - MIN, liquidityUsd: 190_000 }], ['CLEAN', { capUsd: 90_000, peakCapUsd: 90_000, readAtMs: NOW - MIN, liquidityUsd: 30_000 }]]),
  });
  const read: string[] = [];
  const holders = async (mint: string) => (read.push(mint), mint === 'BUNDLE' ? ['16019181', ...Array.from({ length: 19 }, () => '301080')] : ['9000000', '4400000', '3100000', '2500000', '1000000']);
  const state = newOneCoinState();
  await oneCoinPass({ ...deps(w), holders }, state);
  assert.equal(w.picks.get(ID)?.outcome, 'waiting');
  assert.equal(w.picks.get(ID)?.evidence['reason'], 'bundled_holders');
  assert.equal(w.picks.get(ID)?.evidence['heldBack'], 'BUNDLE');
  await oneCoinPass({ ...deps(w), holders }, state);
  assert.equal(w.picks.get(ID)?.address, 'CLEAN');
  assert.deepEqual(read, ['BUNDLE', 'CLEAN'], 'each coin read once; a bundle is never read again');

  /* Holders that cannot be read: a new pick waits; it is never taken as clean. */
  const w2 = world({ candidates: [row('CLEAN')], trades: null, market: new Map([['CLEAN', { capUsd: 90_000, peakCapUsd: 90_000, readAtMs: NOW - MIN, liquidityUsd: 30_000 }]]) });
  await oneCoinPass({ ...deps(w2), holders: async () => { throw new Error('429'); } }, newOneCoinState());
  assert.equal(w2.picks.get(ID)?.evidence['reason'], 'holders_unread');

  /* No holder reader (no chain endpoint): nothing is held back, as before. */
  const w3 = world({ candidates: [row('CLEAN')], trades: null, market: new Map([['CLEAN', { capUsd: 90_000, peakCapUsd: 90_000, readAtMs: NOW - MIN, liquidityUsd: 30_000 }]]) });
  await oneCoinPass(deps(w3), newOneCoinState());
  assert.equal(w3.picks.get(ID)?.address, 'CLEAN');
});

test('★ the bundle sweep: a pick held on a coin found bundled is judged again without it', async () => {
  const ID = 'x:held';
  const held: StoredPick = { subjectId: ID, address: 'BUNDLE', outcome: 'picked', decidedAtMs: NOW - 4 * 60 * MIN, evidence: {} };
  const cand: CandidateRow = { itemId: ID, address: 'BUNDLE', path: 'launch', evidence: { ties: ['link'] }, launchedAtMs: NOW - 5 * 60 * MIN, foundAtMs: NOW - 5 * 60 * MIN };
  const w = world({ candidates: [cand], trades: null, picks: new Map([[ID, held]]) });
  const d = deps(w);
  const asked: string[][] = [];
  await oneCoinPass({
    ...d,
    holders: async () => ['16019181', ...Array.from({ length: 19 }, () => '301080')],
    repo: {
      ...d.repo,
      openCandidates: async () => [],
      heldPickCoins: async () => ['BUNDLE'],
      heldPicksOn: async (kind, addresses) => (asked.push([kind, ...addresses]), kind === 'post' ? [{ pick: held, members: [ID] }] : []),
    },
  }, newOneCoinState());
  assert.deepEqual(asked, [['post', 'BUNDLE'], ['narrative', 'BUNDLE']]);
  assert.equal(w.picks.get(ID)?.outcome, 'none');
});

test('★ the volume-bot screen ($Grok, 10 Nov): a pick held on a coin traded by a bot is let go, though its holders read clean', async () => {
  const ID = 'x:grok';
  const held: StoredPick = { subjectId: ID, address: 'BOT', outcome: 'picked', decidedAtMs: NOW - 20 * MIN, evidence: {} };
  const cand: CandidateRow = { itemId: ID, address: 'BOT', path: 'launch', evidence: { ties: ['name_text'] }, launchedAtMs: NOW - 25 * MIN, foundAtMs: NOW - 25 * MIN };
  const w = world({ candidates: [cand], trades: null, picks: new Map([[ID, held]]) });
  const d = deps(w);
  /* 133, 133, 133, 129 buys a minute, three in four buyers seen before. */
  const bot = [133, 133, 133, 132].map((buys, i) => ({ t: NOW - (10 - i) * MIN, buys, buyers: buys, newBuyers: 35 }));
  const state = newOneCoinState();
  await oneCoinPass({
    ...d,
    holders: async () => Array.from({ length: 20 }, (_, i) => String(1_000_000 + i * 7_919)),
    repo: {
      ...d.repo,
      openCandidates: async () => [],
      heldPickCoins: async () => ['BOT'],
      heldPicksOn: async (kind) => (kind === 'post' ? [{ pick: held, members: [ID] }] : []),
      botMinutes: async () => new Map([['BOT', bot]]),
    },
  }, state);
  assert.ok(state.volumeBots.has('BOT'));
  assert.equal(w.picks.get(ID)?.outcome, 'none');
});

test('gateWrite: a held unread coin keeps its pick, a held bundle does not, racing coins not read clean leave the race', () => {
  const state = newOneCoinState();
  const B = DEFAULT_POLICY.oneCoin.bundle;
  state.bundles.set('CLEAN', { bundled: false, atMs: NOW });
  state.bundles.set('BAD', { bundled: true, atMs: NOW });
  const pick = (address: string, racing?: string[]): PickWrite => ({ subjectId: 'x:1', address, outcome: 'picked', decidedAtMs: NOW, evidence: { mode: 'live', ...(racing === undefined ? {} : { racing }) }, basis: 'trades' });
  const prevOn = (address: string): StoredPick => ({ subjectId: 'x:1', address, outcome: 'picked', decidedAtMs: NOW - MIN, evidence: {} });
  const back = new Set<string>();
  assert.equal(gateWrite(pick('UNREAD'), prevOn('UNREAD'), state, NOW, B, back).address, 'UNREAD');
  assert.equal(gateWrite(pick('BAD'), prevOn('BAD'), state, NOW, B, back).outcome, 'waiting');
  assert.equal(gateWrite(pick('UNREAD'), undefined, state, NOW, B, back).evidence['reason'], 'holders_unread');
  assert.deepEqual([...back], ['x:1']);
  assert.deepEqual(gateWrite(pick('CLEAN', ['CLEAN', 'BAD', 'UNREAD']), undefined, state, NOW, B, new Set()).evidence['racing'], undefined, 'a race of one is no race');
  state.bundles.set('CLEAN2', { bundled: false, atMs: NOW });
  assert.deepEqual(gateWrite(pick('CLEAN', ['CLEAN', 'CLEAN2', 'BAD']), undefined, state, NOW, B, new Set()).evidence['racing'], ['CLEAN', 'CLEAN2']);
  /* A clean read older than `cleanForMs` is read again before a new pick. */
  assert.equal(gateWrite(pick('CLEAN'), undefined, state, NOW + B.cleanForMs, B, new Set()).outcome, 'waiting');
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
