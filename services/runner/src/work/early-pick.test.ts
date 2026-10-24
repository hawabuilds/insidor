/**
 * The early pick inside the one-coin pass, over a fake store, on the 24 Oct baldcat case: at +8.8
 * minutes $baldcat ($14,275) takes the cat post's pick from $CAT and the owner — only the owner — is
 * told in plain facts; the one-coin rule's "waiting" never drops it; it fires once a post; never over
 * the owner's coin call; and a post that was not on For You when the coin launched is picked silently.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { CandidateRow, PickWrite, StoredPick } from '@insidor/store';

import type { Logger } from '../log.ts';
import { EARLY_PICK, earlyAlertFacts, heldByEarly, holdEarly, type EarlyPickDeps, type EarlyRecord } from './early-pick.ts';
import { newOneCoinState, oneCoinPass, type OneCoinDeps } from './one-coin.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const LAUNCH = Date.UTC(2026, 9, 24, 0, 48, 58);
const NOW = LAUNCH + 8.8 * MIN;
const POST = 'x:2113665255088017698';

const cand = (address: string, launchedAtMs: number, ties: string[]): CandidateRow => ({ itemId: POST, address, path: 'launch', evidence: { ties }, launchedAtMs, foundAtMs: launchedAtMs + 15_000 });
const CANDS = [cand('CAT', LAUNCH - 210 * MIN, ['name_guess']), cand('BALDCAT', LAUNCH, ['link', 'picture']), cand('5d8aJH', LAUNCH + 4_000, ['link', 'picture']), cand('H57zAX', LAUNCH + 92_000, ['link', 'picture'])];
const catPick: StoredPick = { subjectId: POST, address: 'CAT', outcome: 'picked', decidedAtMs: LAUNCH - 180 * MIN, evidence: { basis: 'market_readings' } };
const reading = (capUsd: number) => ({ capUsd, peakCapUsd: capUsd, readAtMs: NOW - 30_000, liquidityUsd: null });

interface World {
  picks: Map<string, StoredPick>;
  market: Map<string, ReturnType<typeof reading>>;
  written: PickWrite[];
  queued: { userId: string; kind: string; subject: string; facts: Readonly<Record<string, unknown>>; href: string }[];
  shown: Map<string, { forYouMs: number | null; coinFirst: boolean }>;
  called: Set<string>;
}

const world = (): World => ({
  picks: new Map([[POST, catPick]]),
  market: new Map([['CAT', reading(36_009)], ['BALDCAT', reading(14_275)], ['5d8aJH', reading(3_069)], ['H57zAX', reading(4_099)]]),
  written: [],
  queued: [],
  /* The cat post was on For You from 20:03 the evening before. */
  shown: new Map([[POST, { forYouMs: LAUNCH - 285 * MIN, coinFirst: false }]]),
  called: new Set(),
});

const repoOf = (w: World): OneCoinDeps['repo'] =>
  ({
    recentLaunches: async () => [],
    recentPosts: async () => [],
    postsByIds: async () => [],
    similarities: async () => new Map(),
    unembedded: async () => new Set<string>(),
    upsertCandidates: async () => 0,
    watch: async () => true,
    openCandidates: async () => CANDS,
    candidatesOf: async (ids: readonly string[]) => CANDS.filter((c) => ids.includes(c.itemId)),
    narrativesOf: async () => new Map(),
    tradeFeedAt: async () => null,
    watched: async () => new Set<string>(),
    tradeFacts: async () => null,
    marketFacts: async () => w.market,
    coinsNamed: async () => [],
    coinsLaunchedBetween: async () => [],
    picks: async (_k: string, ids: readonly string[]) => new Map([...w.picks].filter(([id]) => ids.includes(id))),
    writePicks: async (kind: string, picks: readonly PickWrite[]) => {
      if (kind !== 'post') return 0;
      w.written.push(...picks);
      for (const p of picks) w.picks.set(p.subjectId, { subjectId: p.subjectId, address: p.address, outcome: p.outcome, decidedAtMs: p.decidedAtMs, evidence: p.evidence });
      return picks.length;
    },
    appliedFit: async () => null,
  }) as unknown as OneCoinDeps['repo'];

const earlyOf = (w: World): EarlyPickDeps => ({
  shownOf: async (ids) => new Map([...w.shown].filter(([id]) => ids.includes(id))),
  pushFacts: async () => ({ ticker: 'baldcat', excerpt: 'this cat doesnt even know how stupid it looks', handle: 'queasy_f_bby', image: null }),
  push: {
    ownerIds: async (wallets) => (wallets.includes('OWNER') ? ['owner-profile'] : []),
    everyoneIds: async () => ['owner-profile', 'someone-else'],
    queue: async (userId, a) => void w.queued.push({ userId, kind: a.kind, subject: a.subject, facts: a.facts, href: a.href }),
  },
  ownerWallets: ['OWNER'],
});

const pass = (w: World, at = NOW, policy: Policy = DEFAULT_POLICY) =>
  oneCoinPass({ repo: repoOf(w), early: earlyOf(w), ownerCalled: async (ids) => new Set(ids.filter((id) => w.called.has(id))), policy, log: quiet, now: () => at as Millis }, newOneCoinState());

test('★ baldcat takes the cat post at +8.8 minutes and $14.3K, and only the owner is told', async () => {
  const w = world();
  const out = await pass(w);
  assert.deepEqual(out.early.map((e) => [e.itemId, e.address, e.capUsd]), [[POST, 'BALDCAT', 14_275]]);
  const pick = w.picks.get(POST);
  assert.equal(pick?.address, 'BALDCAT');
  assert.equal(pick?.evidence['reason'], EARLY_PICK);
  assert.equal(pick?.evidence['handedOverFrom'], 'CAT');
  const r = pick?.evidence['earlyPick'] as EarlyRecord;
  assert.equal(r.shownFirst, true);
  assert.equal(r.told, 'owner');
  assert.equal(r.rivals, 2);
  assert.deepEqual(w.queued.map((q) => [q.userId, q.kind, q.subject, q.href]), [['owner-profile', 'outage', 'early-pick|BALDCAT', '/#/token/solana:BALDCAT']]);
  assert.equal(w.queued[0]?.facts['what'], 'early-pick');
  assert.equal(w.queued[0]?.facts['author'], '@queasy_f_bby');
});

test('★ no ping-pong: the one-coin rule\'s "waiting" never drops it, and it never fires twice on a post', async () => {
  const w = world();
  await pass(w);
  w.written.length = 0;
  w.queued.length = 0;
  /* A minute later: under the one-coin rule's $15K bar, that rule would leave the post waiting. */
  w.market.set('BALDCAT', reading(13_000));
  const next = await pass(w, NOW + MIN);
  assert.equal(next.early.length, 0);
  assert.equal(w.picks.get(POST)?.address, 'BALDCAT', 'kept');
  assert.equal(w.written.filter((p) => p.subjectId === POST).length, 0, 'nothing written over it');
  assert.equal(w.queued.length, 0, 'never told twice');
});

test('the one-coin rule may still confirm it or hand it to a coin of its wave, never back to the incumbent, and its write keeps the record', () => {
  const held: StoredPick = { subjectId: POST, address: 'BALDCAT', outcome: 'picked', decidedAtMs: NOW, evidence: { earlyPick: { address: 'BALDCAT' } } };
  const prev = new Map([[POST, held]]);
  const launchedOf = new Map(CANDS.map((c) => [c.address, c.launchedAtMs] as const));
  const WAVE = DEFAULT_POLICY.oneCoin.early.rivalWithinMs;
  const hold = (w: PickWrite, p = prev) => holdEarly([w], p, launchedOf, WAVE);
  assert.equal(heldByEarly(held), true);
  const waiting: PickWrite = { subjectId: POST, address: null, outcome: 'waiting', decidedAtMs: NOW, evidence: {}, basis: 'market_readings' };
  assert.deepEqual(hold(waiting), []);
  const pickOf = (address: string): PickWrite => ({ subjectId: POST, address, outcome: 'picked', decidedAtMs: NOW, evidence: { basis: 'trades' }, basis: 'trades' });
  assert.deepEqual(hold(pickOf('CAT')), [], '★ the incumbent, launched hours before the wave, never takes it straight back');
  assert.deepEqual(hold(pickOf('UNKNOWN')), [], 'a coin of unknown launch cannot be said to be of the wave');
  const [same] = hold(pickOf('BALDCAT'));
  assert.equal(same?.address, 'BALDCAT', 'confirmed by the ordinary rule');
  const [w] = hold(pickOf('H57zAX'));
  assert.equal(w?.address, 'H57zAX', 'a coin of its wave, by the ordinary rule\'s own bar');
  assert.deepEqual(w?.evidence['earlyPick'], { address: 'BALDCAT' }, 'the record stays, so the early rule never fires on the post again');
  const moved: StoredPick = { ...held, address: 'H57zAX' };
  assert.equal(heldByEarly(moved), false);
  assert.deepEqual(hold(waiting, new Map([[POST, moved]])).length, 1, 'once handed on, the ordinary rule is in charge');
});

test('★ never over the owner\'s coin call', async () => {
  const w = world();
  w.called.add(POST);
  const out = await pass(w);
  assert.equal(out.early.length, 0);
  assert.equal(w.queued.length, 0);
});

test('a post that was not on For You when the coin launched is picked, and nobody is told', async () => {
  const w = world();
  w.shown.set(POST, { forYouMs: LAUNCH + 30 * MIN, coinFirst: false });
  await pass(w);
  assert.equal(w.picks.get(POST)?.address, 'BALDCAT');
  assert.equal((w.picks.get(POST)?.evidence['earlyPick'] as EarlyRecord).told, 'nobody');
  assert.equal(w.queued.length, 0);
  const cf = world();
  cf.shown.set(POST, { forYouMs: null, coinFirst: true });
  await pass(cf);
  assert.equal(cf.queued.length, 1, 'a coin-first post: its coin always came first, as the launch push says');
});

test('widened to everyone: a coin_launched for every profile, keyed by the coin as the launch push is', async () => {
  const w = world();
  const policy: Policy = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, early: { ...DEFAULT_POLICY.oneCoin.early, push: { on: true, everyone: true } } } };
  await pass(w, NOW, policy);
  assert.deepEqual(w.queued.map((q) => [q.userId, q.kind, q.subject]), [['owner-profile', 'coin_launched', 'BALDCAT'], ['someone-else', 'coin_launched', 'BALDCAT']]);
  assert.equal(w.queued[0]?.facts['early'], true);
});

test('switched off: no early pick, and an early pick already held is still held', async () => {
  const w = world();
  const off: Policy = { ...DEFAULT_POLICY, oneCoin: { ...DEFAULT_POLICY.oneCoin, early: { ...DEFAULT_POLICY.oneCoin.early, on: false } } };
  assert.equal((await pass(w, NOW, off)).early.length, 0);
  assert.equal(w.picks.get(POST)?.address, 'CAT');
});

test('the facts the push says: the multiple of the rivals\' rise, or none when no rival rose', () => {
  const pick = { address: 'BALDCAT', capUsd: 14_275, ageMs: 8.8 * MIN, riseUsd: 11_375, rivalRiseUsd: 1_199, rivals: 2, rivalsUnread: 0, ties: ['link'] as const };
  const f = earlyAlertFacts({ itemId: POST, pick, write: {} as PickWrite }, { ticker: 'baldcat', excerpt: null, handle: 'x', image: null });
  assert.equal(Math.floor(f['multiple'] as number), 9);
  assert.equal(earlyAlertFacts({ itemId: POST, pick: { ...pick, rivalRiseUsd: 0 }, write: {} as PickWrite }, { ticker: null, excerpt: null, handle: null, image: null })['multiple'], null);
});
