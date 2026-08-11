/**
 * The replay harness, over a hand-built log.
 *
 * The re-deciders here are local toys on purpose. What is under test is the
 * harness's own contract — that `before` comes from the log rather than from a
 * recomputation, that lane and feature-set filtering skip-and-count rather than
 * silently drop, and that the identity replay is a fixed point.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Decision, StageName } from '@insidor/contracts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

import { replay } from './harness.ts';
import type { Redecider } from './harness.ts';
import { fromArray } from './source.ts';
import { summarise, countTransition } from './diff.ts';
import { renderReport } from './report.ts';

const POLICY = {} as Policy;
const LIMITS = { maxExamples: 10 };
const SET = 'item.admit.v1' as FeatureSetId;

let seq = 0;

function decision(over: Partial<Decision> = {}): Decision {
  seq++;
  const base = {
    stage: 'admit' as StageName,
    subjectKind: 'item' as const,
    subjectId: `x:${seq}`,
    featureAsOf: 1_760_000_000_000 + seq,
    decidedAt: 1_760_000_000_000 + seq,
    subjectOrigin: 1_759_999_000_000,
    horizonS: 1000,
    verdict: 'pass' as const,
    reason: 'A0_admitted' as ReasonCode,
    score: null,
    features: { reachLevel: 9000 } as FeatureVector,
    featureSet: SET,
    policyHash: 'policy_abc',
    decider: 'rule:admit@3',
    propensity: 1,
    explore: false,
    exploreArm: null,
    costUsd: 0,
  };
  return { ...base, ...over } as Decision;
}

/** The live rule: admit at or above 5,000. */
const liveGate: Redecider = (f: FeatureVector) =>
  (f["reachLevel"] ?? 0) >= 5000
    ? { verdict: 'pass', reason: 'A0_admitted' as ReasonCode, score: null }
    : { verdict: 'drop', reason: 'A1_below_reach_floor' as ReasonCode, score: null };

/** The candidate: admit at or above 12,000. Strictly tighter. */
const tighterGate: Redecider = (f: FeatureVector) =>
  (f["reachLevel"] ?? 0) >= 12_000
    ? { verdict: 'pass', reason: 'A0_admitted' as ReasonCode, score: null }
    : { verdict: 'drop', reason: 'A1_below_reach_floor' as ReasonCode, score: null };

const log = [
  decision({ features: { reachLevel: 9000 } as FeatureVector, verdict: 'pass', reason: 'A0_admitted' as ReasonCode }),
  decision({ features: { reachLevel: 20_000 } as FeatureVector, verdict: 'pass', reason: 'A0_admitted' as ReasonCode }),
  decision({
    features: { reachLevel: 100 } as FeatureVector,
    verdict: 'drop',
    reason: 'A1_below_reach_floor' as ReasonCode,
  }),
];

test('replaying the CURRENT policy over the log reproduces the log exactly', async () => {
  // ★ The invariant every other number depends on. A replay that disagrees with
  // the log about the past cannot be trusted about a hypothetical.
  const r = await replay(fromArray(log), { deciders: { admit: liveGate }, policy: POLICY }, LIMITS);
  assert.equal(r.considered, 3);
  assert.equal(r.flips, 0);
  assert.equal(countTransition(r, 'pass', 'pass'), 2);
  assert.equal(countTransition(r, 'drop', 'drop'), 1);
});

test('a tighter gate shows the expensive direction separately', async () => {
  const r = await replay(fromArray(log), { deciders: { admit: tighterGate }, policy: POLICY }, LIMITS);
  const s = summarise(r, 5);
  assert.equal(s.newlyRejected, 1); // the 9,000-reach row
  assert.equal(s.newlyAdmitted, 0);
  assert.equal(s.unchanged, 2);
  assert.equal(r.examples.length, 1);
  assert.equal(r.examples[0]?.before.verdict, 'pass');
  assert.equal(r.examples[0]?.after.verdict, 'drop');
});

test('`before` is read from the log, never recomputed', async () => {
  // A row whose logged verdict disagrees with what the live rule would say now —
  // exactly what a policy change six weeks ago looks like. The harness must
  // report the disagreement, not paper over it by recomputing both sides.
  const drifted = [decision({ features: { reachLevel: 6000 } as FeatureVector, verdict: 'drop', reason: 'A1_below_reach_floor' as ReasonCode })];
  const r = await replay(fromArray(drifted), { deciders: { admit: liveGate }, policy: POLICY }, LIMITS);
  assert.equal(r.flips, 1);
  assert.equal(countTransition(r, 'drop', 'pass'), 1);
});

test('rows are skipped and counted, never silently dropped', async () => {
  const mixed = [
    decision({ stage: 'qualify' as StageName }),
    decision({ explore: true, exploreArm: 'holdout' }),
    decision({ featureSet: 'item.admit.v2' as FeatureSetId }),
    decision(),
  ];
  const r = await replay(
    fromArray(mixed),
    { deciders: { admit: liveGate }, policy: POLICY, lanes: ['exploit'], featureSets: [SET] },
    LIMITS,
  );
  assert.equal(r.seen, 4);
  assert.equal(r.considered, 1);
  assert.equal(r.skipped.no_decider_for_stage, 1);
  assert.equal(r.skipped.lane_excluded, 1);
  assert.equal(r.skipped.feature_set_excluded, 1);
});

test('the holdout lane is selectable, because it is the only one that answers the real question', async () => {
  const arrivals = [
    decision({ explore: true, exploreArm: 'holdout', features: { reachLevel: 100 } as FeatureVector, verdict: 'drop', reason: 'A1_below_reach_floor' as ReasonCode }),
    decision({ features: { reachLevel: 100 } as FeatureVector, verdict: 'drop', reason: 'A1_below_reach_floor' as ReasonCode }),
  ];
  const r = await replay(
    fromArray(arrivals),
    { deciders: { admit: liveGate }, policy: POLICY, lanes: ['holdout'] },
    LIMITS,
  );
  assert.equal(r.considered, 1);
  assert.deepEqual([...r.lanes], ['holdout']);
});

test('the report states its population, lane and window next to the numbers', async () => {
  const r = await replay(
    fromArray(log),
    { deciders: { admit: tighterGate }, policy: POLICY, lanes: ['holdout'] },
    LIMITS,
  );
  const md = renderReport(
    r,
    { candidate: 'admit reach floor 5000 → 12000', candidatePolicyHash: 'policy_def', sourceDescription: 'test log' },
    5,
  );
  assert.match(md, /\*\*Population\.\*\*/);
  assert.match(md, /\*\*Lanes\.\*\* holdout/);
  assert.match(md, /uniform over arrivals/);
  assert.match(md, /\*\*Window\.\*\*/);
});

test('a mixed-lane report says so instead of quietly pooling', async () => {
  const r = await replay(
    fromArray([decision(), decision({ explore: true, exploreArm: 'holdout' })]),
    { deciders: { admit: liveGate }, policy: POLICY },
    LIMITS,
  );
  const md = renderReport(r, { candidate: 'x', candidatePolicyHash: 'h', sourceDescription: 'test log' }, 5);
  assert.match(md, /MIXED LANES/);
});
