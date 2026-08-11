/**
 * The gold set's own tests.
 *
 * Two jobs, and they are different:
 *
 *   1. The FIXTURES are internally consistent — the stated day counts are the
 *      actual arithmetic, the ids are unique, every expectation names something.
 *      A frozen set with a typo in it is worse than no set, because it is trusted.
 *
 *   2. The RUNNER discriminates. It is fed the previous build's behaviour (no
 *      temporal check at all) and must report every temporal case as a failure;
 *      then a reference gate implementing G1/G2/G3 and the provenance rule, and
 *      must report a clean run. A comparator that always says "pass" would sail
 *      through a set of any size.
 *
 * The reference gate below is a TEST DOUBLE. The real one is
 * `core/src/resolve/gates.ts`, and `run-gold.ts` wires that one. Duplicating it
 * here would let the two drift into agreement with each other and away from the
 * cases; this one exists only to prove the harness can tell right from wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';

import { GOLD_CASES, toGateInput } from './cases.ts';
import type { GoldGateInput } from './cases.ts';
import { runGold, describeGold } from './run.ts';
import type { ResolverGate } from './run.ts';

const POLICY = {} as Policy;
const ABSTAIN: readonly ReasonCode[] = [
  'G1_mint_time_unknown' as ReasonCode,
  'R_symbol_provenance_invented' as ReasonCode,
];
const OPTS = { abstainReasons: ABSTAIN, policy: POLICY };

const DAY_MS = 86_400_000;

/* ── 1. the fixtures ──────────────────────────────────────────────────── */

test('every case has a unique id and a stated reason for existing', () => {
  const ids = new Set(GOLD_CASES.map((c) => c.id));
  assert.equal(ids.size, GOLD_CASES.length, 'duplicate case id');
  for (const c of GOLD_CASES) {
    assert.ok(c.incident.length > 20, `${c.id}: incident must describe what happened`);
    assert.ok(c.why.length > 20, `${c.id}: why must say why the expected outcome is correct`);
  }
});

test('the stated day offsets are the actual arithmetic', () => {
  for (const c of GOLD_CASES) {
    const input = toGateInput(c);
    if (c.candidate.mintedAtConf === 'unknown') {
      assert.equal(input.mintedAtMs, null, `${c.id}: an unknown mint time must not carry a timestamp`);
      continue;
    }
    assert.notEqual(input.mintedAtMs, null);
    const days = ((input.mintedAtMs ?? 0) - input.earliestPostAtMs) / DAY_MS;
    assert.ok(
      Math.abs(days - c.candidate.mintedDaysFromPost) < 1e-9,
      `${c.id}: derived lag ${days} does not match the stated ${c.candidate.mintedDaysFromPost}`,
    );
  }
});

test('the four historical incidents are present with the right sign', () => {
  const byId = new Map(GOLD_CASES.map((c) => [c.id, c]));
  assert.equal(byId.get('gold-001-pump')?.candidate.mintedDaysFromPost, -375);
  assert.equal(byId.get('gold-002-grass')?.candidate.mintedDaysFromPost, -633);
  assert.equal(byId.get('gold-003-gym-showdown')?.candidate.mintedDaysFromPost, -65);
  // The negative control must be the other sign, or the set only tests rejection.
  assert.ok((byId.get('gold-005-live-curve-no-liquidity-object')?.candidate.mintedDaysFromPost ?? 0) > 0);
});

test('the set contains at least one case the resolver must ACCEPT', () => {
  // A gold set of only rejections silently rewards a resolver that rejects
  // everything, which is the easiest possible way to make this file go green.
  assert.ok(GOLD_CASES.some((c) => c.expect.verdict === 'pass'));
});

test('no case gates on liquidity, because absence is not illiquidity', () => {
  // Two real cases carry a null liquidity because a bonding curve has no
  // two-sided reserve. If a future case is added that expects a rejection AND
  // has null liquidity, the reason must not be about liquidity.
  const curves = GOLD_CASES.filter((c) => c.candidate.liquidityUsd === null);
  assert.ok(curves.length >= 2, 'the curve population must stay represented');
  for (const c of curves) {
    assert.ok(
      c.expect.reason === null || !/liquidity/i.test(c.expect.reason),
      `${c.id}: nothing may gate on liquidity`,
    );
  }
});

/* ── 2. the runner ────────────────────────────────────────────────────── */

/** What shipped: symbol search, highest liquidity wins, no temporal check. */
const legacyGate: ResolverGate = () => null;

/** A reference implementation of the free local gates, for testing the runner. */
const referenceGate: ResolverGate = (c: GoldGateInput): ReasonCode | null => {
  if (c.mintedAtConf === 'unknown' || c.mintedAtMs === null) return 'G1_mint_time_unknown' as ReasonCode;
  if (c.mintedAtMs < c.earliestPostAtMs) return 'G2_predates_post' as ReasonCode;
  if (c.symbolProvenance === 'llm') return 'R_symbol_provenance_invented' as ReasonCode;
  return null;
};

test('the previous build’s behaviour fails every case it should', () => {
  const r = runGold(legacyGate, OPTS);
  // Everything except the negative control, which the old build got right by
  // accident of it being a `pass` — and even that it did not reach, because the
  // liquidity filter rejected it upstream.
  const failed = new Set(r.failures.map((f) => f.caseId));
  assert.ok(failed.has('gold-001-pump'));
  assert.ok(failed.has('gold-002-grass'));
  assert.ok(failed.has('gold-003-gym-showdown'));
  assert.ok(failed.has('gold-004-kang-invented-ticker'));
  assert.ok(failed.has('gold-006-mint-time-unknown'));
  assert.ok(!failed.has('gold-005-live-curve-no-liquidity-object'));
});

test('a gate implementing G1, G2 and provenance satisfies the whole set', () => {
  const r = runGold(referenceGate, OPTS);
  assert.deepEqual(
    r.failures.map((f) => f.caseId),
    [],
    describeGold(r),
  );
  assert.equal(r.passed, GOLD_CASES.length);
});

test('a right answer for the wrong reason is a failure', () => {
  // A resolver that drops GYM because it is "too old" rather than because it
  // predates the post has not fixed the temporal gate; it has coincidentally
  // rejected the row, and the next threshold change brings it straight back.
  const wrongReason: ResolverGate = (c) =>
    c.mintedAtMs !== null && c.mintedAtMs < c.earliestPostAtMs
      ? ('G3_too_late' as ReasonCode)
      : referenceGate(c, POLICY);
  const r = runGold(wrongReason, OPTS);
  const failed = r.failures.map((f) => f.caseId);
  assert.ok(failed.includes('gold-001-pump'));
  assert.ok(failed.includes('gold-003-gym-showdown'));
});

test('the failure report names the incident, not just the assertion', () => {
  const text = describeGold(runGold(legacyGate, OPTS));
  assert.match(text, /gym day/);
  assert.match(text, /what happened once/);
  assert.match(text, /why it matters/);
});
