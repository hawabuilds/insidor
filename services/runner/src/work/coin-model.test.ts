/** The coin model pass: off, dry or no fit does nothing; each post scored once on its facts at the answer, shadow unless on. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { AppliedCoinModel, CoinFactRow, CoinModelScore, ToScore } from '@insidor/store';

import type { Logger } from '../log.ts';
import { scoreCoinModel, type CoinModelDeps } from './coin-model.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };
const NOW = 1_800_000_000_000 as Millis;
const FIT: AppliedCoinModel = {
  id: 9, target: 'coined', fittedAt: new Date(0), space: 'post', intercept: 0, names: ['no_vector'], means: [0], spreads: [1], weights: [0], vectorWeights: [4, 0], threshold: 0.9, heldOut: {},
};
const fact = (itemId: string, at: Date): CoinFactRow => ({
  itemId, decidedAt: at, source: 'x', lang: 'en', text: 'a line', mediaKinds: [], postedAt: new Date(at.getTime() - 60_000), firstSeenAt: at,
  reach: 100, reachAt: at, ratePerMinute: null, priorRatePerMinute: null, approval: 1, conversation: 0, rebroadcast: 0, followers: 10, echoes: 0, coins: 0,
});

function deps(p: Policy, fit: AppliedCoinModel | readonly AppliedCoinModel[] | null, written: CoinModelScore[], asked: { at?: Date[] }): CoinModelDeps {
  const fits = fit === null ? [] : Array.isArray(fit) ? fit : [fit as AppliedCoinModel];
  const todo: ToScore[] = [{ itemId: 'x:1', answerJudgedAt: new Date(NOW - 5 * 60_000) }, { itemId: 'x:2', answerJudgedAt: new Date(NOW - 9 * 60_000) }];
  return {
    repo: {
      latestApplied: async (target) => fits.find((f) => f.target === target) ?? null,
      latestForShadow: async (target) => fits.find((f) => f.target === target) ?? null,
      toScore: async () => todo,
      facts: async (pairs) => {
        asked.at = pairs.map((x) => x.decidedAt);
        return pairs.map((x) => fact(x.itemId, x.decidedAt));
      },
      recordScores: async (rows) => void written.push(...rows),
    },
    vectors: { vectors: async () => new Map([['x:1', { itemId: 'x:1', text: '', values: Float32Array.from([1, 0]) }]]) },
    policy: p,
    mode: 'live',
    log: quiet,
    now: () => NOW,
  };
}

test('off, a dry run or no applied fit scores nothing', async () => {
  const off: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, coinModel: { ...DEFAULT_POLICY.judge.coinModel, on: false, shadow: false } } };
  const w: CoinModelScore[] = [];
  assert.equal((await scoreCoinModel(deps(off, FIT, w, {}))).skipped, 'off');
  assert.equal((await scoreCoinModel({ ...deps(DEFAULT_POLICY, FIT, w, {}), mode: 'dry' })).skipped, 'dry run');
  assert.equal((await scoreCoinModel(deps(DEFAULT_POLICY, null, w, {}))).skipped, 'no applied coined fit; no viral fit');
  assert.equal(w.length, 0);
});

test('★ facts are read at each post\'s answer, and in shadow every row says shadow', async () => {
  const w: CoinModelScore[] = [];
  const asked: { at?: Date[] } = {};
  const r = await scoreCoinModel(deps(DEFAULT_POLICY, FIT, w, asked));
  assert.deepEqual(asked.at, [new Date(NOW - 5 * 60_000), new Date(NOW - 9 * 60_000)]);
  assert.equal(r.scored, 2);
  assert.equal(r.wouldAdd, 1, 'only the post whose vector carries the weight');
  assert.deepEqual(w.map((x) => [x.itemId, x.wouldAdd, x.mode, x.fitId, x.threshold]), [['x:1', true, 'shadow', 9, 0.9], ['x:2', false, 'shadow', 9, 0.9]]);
  assert.equal(w[0]?.answerJudgedAt.getTime(), NOW - 5 * 60_000);
});

test('switched on, the rows say live', async () => {
  const on: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, coinModel: { ...DEFAULT_POLICY.judge.coinModel, on: true } } };
  const w: CoinModelScore[] = [];
  await scoreCoinModel(deps(on, FIT, w, {}));
  assert.ok(w.every((x) => x.mode === 'live'));
});

test('★ each target scores with its own fit; with on, only the live target\'s rows say live', async () => {
  const on: Policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, coinModel: { ...DEFAULT_POLICY.judge.coinModel, on: true, liveTarget: 'coined', threshold: 0.01 } } };
  const viral: AppliedCoinModel = { ...FIT, id: 12, target: 'viral', threshold: 0.95 };
  const w: CoinModelScore[] = [];
  const r = await scoreCoinModel(deps(on, [FIT, viral], w, {}));
  assert.equal(r.scored, 4);
  assert.deepEqual(w.map((x) => [x.target, x.fitId, x.mode, x.threshold]), [
    ['coined', 9, 'live', 0.01], ['coined', 9, 'live', 0.01],
    ['viral', 12, 'shadow', 0.95], ['viral', 12, 'shadow', 0.95],
  ], 'the policy threshold overrides the live target\'s fit only');
});

test('a target with no fit is skipped and the other still scores', async () => {
  const w: CoinModelScore[] = [];
  const r = await scoreCoinModel(deps(DEFAULT_POLICY, { ...FIT, target: 'viral' }, w, {}));
  assert.equal(r.skipped, null);
  assert.ok(w.length === 2 && w.every((x) => x.target === 'viral'));
});

test('★ a fit that failed its gate is watched for a shadowed target and never scores the live one', async () => {
  const w: CoinModelScore[] = [];
  const unapplied = (t: 'coined' | 'viral'): AppliedCoinModel => ({ ...FIT, id: 13, target: t });
  const d = deps(DEFAULT_POLICY, null, w, {});
  const r = await scoreCoinModel({ ...d, repo: { ...d.repo, latestApplied: async () => null, latestForShadow: async (t) => unapplied(t) } });
  assert.equal(r.scored, 2);
  assert.ok(w.every((x) => x.target === 'viral' && x.mode === 'shadow' && x.fitId === 13), 'the live target (coined) waits for an applied fit');
});
