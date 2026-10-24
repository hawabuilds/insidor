/**
 * The missed-runner net over fakes: a coin no pick holds goes to its origin post as a candidate tied
 * `missed_runner` and the pick; a post the owner called keeps his call and the coin is only told; a
 * coin with no post is told as "ran without a post we hold"; a coin is handled once a process.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CandidateRow, PickWrite, RunnerCoinRow, RunnerPostRow } from '@insidor/store';

import type { Logger } from '../log.ts';
import { missedRunnerPass, newMissedRunnerState, searchTerms, type MissedRunnerDeps } from './missed-runners.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const NOW = Date.UTC(2026, 9, 23, 21, 0);
const MIN = 60_000;

const BITCHES: RunnerCoinRow = { address: '26Aawi', assetKey: 'solana:26Aawi', name: 'You Missed Coin', ticker: 'BITCHES', launchedAtMs: NOW - 39 * MIN, peakCapUsd: 3_680_000, capUsd: 3_000_000 };
const ORIGIN: RunnerPostRow = { itemId: 'x:2113693141609886045', postedAtMs: NOW - 176 * MIN, handle: 'TocRadio', judgeNames: ['YOU MISSED BITCHES'], guessNames: [], text: 'reads “YOU MISSED BITCHES”', textEn: null, views: 84_508 };
const PROMO: RunnerPostRow = { itemId: 'x:2113709592987259358', postedAtMs: NOW - 110 * MIN, handle: 'Na1_N1ako', judgeNames: ['YOU MISSED COIN', 'BITCHES'], guessNames: [], text: 'officially called "You Missed Coin"', textEn: null, views: 21 };

function deps(coins: RunnerCoinRow[], posts: RunnerPostRow[], called: string[] = []) {
  const rec = { candidates: [] as CandidateRow[], picks: [] as PickWrite[], alerts: [] as { subject: string; facts: Record<string, unknown> }[], asked: [] as { phrases: readonly string[]; keys: readonly string[]; fromMs: number; toMs: number }[] };
  const d: MissedRunnerDeps = {
    runners: async () => coins,
    postsFor: async (phrases, keys, fromMs, toMs) => (rec.asked.push({ phrases, keys, fromMs, toMs }), posts),
    pictureSimilarity: async () => new Map(),
    ownerCalled: async (ids) => new Set(ids.filter((id) => called.includes(id))),
    picks: async () => new Map(),
    peaks: async (addresses) => new Map(coins.filter((c) => addresses.includes(c.address)).map((c) => [c.address, c.peakCapUsd] as const)),
    upsertCandidates: async (rows) => void rec.candidates.push(...rows),
    writePicks: async (picks) => void rec.picks.push(...picks),
    ownerWallets: ['owner-wallet'],
    owner: { ownerIds: async () => ['owner'], queue: async (_u, a) => void rec.alerts.push({ subject: a.subject, facts: a.facts }) },
    policy: DEFAULT_POLICY,
    log: quiet,
    now: () => NOW,
  };
  return { d, rec };
}

test('★ $BITCHES: the coin goes to @TocRadio\'s post, as a missed_runner candidate and the pick, and the owner is told', async () => {
  const { d, rec } = deps([BITCHES], [PROMO, ORIGIN]);
  const state = newMissedRunnerState();
  const out = await missedRunnerPass(d, state);
  assert.equal(out[0]?.post?.itemId, ORIGIN.itemId);
  assert.deepEqual(rec.candidates[0]?.evidence['ties'], ['name_stated', 'missed_runner']);
  assert.equal(rec.picks[0]?.subjectId, ORIGIN.itemId);
  assert.equal(rec.picks[0]?.address, '26Aawi');
  assert.equal(rec.alerts[0]?.subject, 'missed-runner|26Aawi');
  assert.equal(rec.alerts[0]?.facts['linked'], true);
  /* Two days of posts before the launch, to ten minutes after it. */
  assert.equal(rec.asked[0]?.fromMs, BITCHES.launchedAtMs! - DEFAULT_POLICY.runnerLink.missed.postLookbackMs);
  /* Once a process. */
  assert.equal((await missedRunnerPass(d, state)).length, 0);
});

test('the owner\'s call stands: the coin is told, the pick is not written', async () => {
  const { d, rec } = deps([BITCHES], [ORIGIN], [ORIGIN.itemId]);
  const out = await missedRunnerPass(d, newMissedRunnerState());
  assert.equal(out[0]?.linked, false);
  assert.equal(out[0]?.ownerCalled, true);
  assert.equal(rec.picks.length, 0);
  assert.equal(rec.alerts[0]?.facts['linked'], false);
});

test('★ a same-name copy that ran lower never takes the post from the coin that ran higher', async () => {
  /* 24 Oct, the first pass: $YMB at $793K, and a copy launched two minutes later at $730K, both tied to @TocRadio. */
  const YMB: RunnerCoinRow = { ...BITCHES, address: 'ozs7', assetKey: 'solana:ozs7', peakCapUsd: 792_821 };
  const COPY: RunnerCoinRow = { ...BITCHES, address: '9HCJ', assetKey: 'solana:9HCJ', launchedAtMs: BITCHES.launchedAtMs! + 2 * MIN, peakCapUsd: 729_895 };
  const { d, rec } = deps([YMB, COPY], [ORIGIN]);
  const held: MissedRunnerDeps = {
    ...d,
    picks: async (ids) => new Map(rec.picks.filter((p) => ids.includes(p.subjectId)).slice(-1).map((p) => [p.subjectId, { subjectId: p.subjectId, address: p.address, outcome: 'picked' as const, decidedAtMs: NOW, evidence: p.evidence }] as const)),
  };
  const out = await missedRunnerPass(held, newMissedRunnerState());
  assert.deepEqual(rec.picks.map((p) => p.address), ['ozs7']);
  assert.equal(out[1]?.linked, false);
  assert.equal(out[1]?.keptBigger, true);
  assert.equal(rec.alerts[1]?.facts['keptBigger'], true);
});

test('★ the matcher\'s own coin is kept when it ran higher ($FOMO over $fomo)', async () => {
  const FOMO_SMALL: RunnerCoinRow = { ...BITCHES, address: 'Ewfot', assetKey: 'solana:Ewfot', peakCapUsd: 667_201 };
  const { d, rec } = deps([FOMO_SMALL], [ORIGIN]);
  const out = await missedRunnerPass(
    {
      ...d,
      picks: async (ids) => new Map(ids.map((id) => [id, { subjectId: id, address: 'd2m8', outcome: 'picked' as const, decidedAtMs: NOW, evidence: {} }] as const)),
      peaks: async () => new Map([['d2m8', 1_803_609]]),
    },
    newMissedRunnerState(),
  );
  assert.equal(rec.picks.length, 0);
  assert.equal(out[0]?.keptBigger, true);
});

test('a coin with no post we hold is still told', async () => {
  const { d, rec } = deps([BITCHES], []);
  const out = await missedRunnerPass(d, newMissedRunnerState());
  assert.equal(out[0]?.post, null);
  assert.equal(rec.alerts[0]?.facts['itemId'], null);
});

test('the search: the name, its core without "coin", the ticker, and the core with the ticker run together', () => {
  const t = searchTerms(BITCHES, DEFAULT_POLICY);
  assert.deepEqual(t.phrases, ['You Missed Coin', 'You Missed', 'BITCHES']);
  assert.deepEqual(t.keys, ['youmissedcoin', 'youmissed', 'bitches', 'youmissedbitches']);
});
