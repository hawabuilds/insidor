/**
 * RANK, as the claims the board has to satisfy.
 *
 * ★ WHAT A GREEN RUN HERE DOES AND DOES NOT SUPPORT. Every fixture below is invented,
 * and the three tests that were `todo` when this file was written are now algebra over
 * hand-built boards. They prove that the transition does what the design says — that a
 * near-tie does not swap, that entering costs two ticks and leaving costs three, that
 * an outage does not evict anybody, and that the stability metric can tell a frozen
 * board from a healthy one. They prove NOTHING about whether the ordering is any good,
 * because that needs board impressions and clicks and there are none, anywhere, yet.
 * That is also the reason RANK is the last stage to become a model and not the first.
 *
 * So: mechanism, yes. Ranking quality, not from here and not for months.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StageContext } from '@insidor/contracts/decision.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy, RankPolicy } from '@insidor/contracts/policy.ts';

import { isExploreDraw } from '../track/holdout.ts';
import { heat } from './heat.ts';
import { commitBoard, committed, type BoardSlot, type TickScore } from './hysteresis.ts';
import { kendallTau, stabilityState } from './stability.ts';
import { extract, gate, rank, type RankInput } from './stage.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const SECOND = 1_000;
const MINUTE = 60_000;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'rank:story_7f3a' };

/** A policy with the board reshaped, so a two-slot board is testable at all. */
function withRank(over: Partial<RankPolicy>): Policy {
  return { ...DEFAULT_POLICY, rank: { ...DEFAULT_POLICY.rank, ...over } };
}

function rankInput(over: Partial<RankInput> = {}): RankInput {
  return {
    subjectId: 'story_7f3a',
    subjectKind: 'story',
    heat: { rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 30 },
    burstMeasured: true,
    featureAsOf: NOW - 10 * SECOND,
    subjectOrigin: NOW - 30 * MINUTE,
    incumbentScore: null,
    incumbentSince: null,
    slot: null,
    costUsd: 0,
    ...over,
  };
}

function tickScore(score: number, burst: number | null = null): TickScore {
  return { score, burst };
}

/** Run n ticks of the same scores, twenty seconds apart, from an empty board. */
function ticks(
  scores: Readonly<Record<string, TickScore>>,
  count: number,
  p: Policy,
  start: readonly BoardSlot[] = [],
): readonly BoardSlot[] {
  let state = start;
  for (let i = 0; i < count; i++) state = commitBoard(state, scores, NOW + i * p.rank.tickS * SECOND, p);
  return state;
}

const idsOf = (board: readonly BoardSlot[]): string[] => board.map((row) => row.subjectId);

/* ── the primitive, which was already built ───────────────────────────── */

test('a score depends only on its own subject, so the board cannot reshuffle around it', () => {
  const subject = { rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 30 };

  // The same inputs, scored twice with nothing shared between the calls. If any term
  // ever reached another candidate, this is the test that would stop compiling.
  assert.equal(heat(subject, DEFAULT_POLICY), heat(subject, DEFAULT_POLICY));
});

test('age penalises: the same evidence is worth less an hour later', () => {
  const fresh = heat({ rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 5 }, DEFAULT_POLICY);
  const older = heat({ rateLcbNorm: 0.4, burst: 2.25, quality: 0.8, ageMin: 65 }, DEFAULT_POLICY);

  assert.ok(older < fresh);
});

test('no evidence is zero heat, not a small positive number', () => {
  assert.equal(heat({ rateLcbNorm: 0, burst: 3, quality: 1, ageMin: 1 }, DEFAULT_POLICY), 0);
});

/* ── the board is the server's, and it is not a sort ──────────────────── */

test('the board is committed server-side and the client never sorts', () => {
  const p = withRank({ slots: 2 });

  // Two rows settle, A above B.
  let state = ticks({ a: tickScore(0.5), b: tickScore(0.45) }, 3, p);
  assert.deepEqual(idsOf(committed(state, p)), ['a', 'b']);

  // B now outscores A — by 0.07, which is under the 0.08 swap edge. A client sorting
  // this tick's scores would render [b, a]. The committed board does not move, and
  // whatever this function returns IS the board.
  state = commitBoard(state, { a: tickScore(0.5), b: tickScore(0.57) }, NOW + 10 * MINUTE, p);

  const clientSideSort = ['b', 'a'];
  assert.deepEqual(idsOf(committed(state, p)), ['a', 'b']);
  assert.notDeepEqual(idsOf(committed(state, p)), clientSideSort);

  // And the row a reader is looking at still carries the fresh number: the ORDER is
  // committed, the values are patched in place. A frozen order with stale values
  // would be a different and equally unusable product.
  assert.equal(committed(state, p)[1]?.score, 0.57);
});

test('a challenger must beat the incumbent by the swap edge to move', () => {
  const p = withRank({ slots: 1 });
  const settled = ticks({ a: tickScore(0.5) }, 1, p);

  // 0.05 ahead. Under the edge, so it never enters however long it waits — and the
  // "however long" is the point: this is a bar, not a delay.
  const nearTie = ticks({ a: tickScore(0.5), b: tickScore(0.55) }, 40, p, settled);
  assert.deepEqual(idsOf(committed(nearTie, p)), ['a']);

  // 0.10 ahead. Over the edge, so it does enter — eventually, and the next test is
  // about how long "eventually" is.
  const clear = ticks({ a: tickScore(0.5), b: tickScore(0.6) }, 40, p, settled);
  assert.deepEqual(idsOf(committed(clear, p)), ['b']);
});

test('entering costs two ticks, leaving costs three, and the dwell outlasts both', () => {
  const p = withRank({ slots: 1 });
  let state = ticks({ a: tickScore(0.5) }, 1, p);
  const scores = { a: tickScore(0.5), b: tickScore(0.6) };

  // The asymmetry is deliberate — a row that vanishes and reappears is worse to read
  // than one that lingers a beat too long — so the binding constraint is the leave
  // count and then the ninety-second dwell, not the entry count.
  const seen: string[][] = [];
  for (let i = 1; i <= 6; i++) {
    state = commitBoard(state, scores, NOW + i * p.rank.tickS * SECOND, p);
    seen.push(idsOf(committed(state, p)));
  }

  // Ticks 1..4 are 20s..80s: inside the 90-second dwell, so A holds regardless of how
  // many ticks B has been above it.
  assert.deepEqual(seen.slice(0, 4), [['a'], ['a'], ['a'], ['a']]);
  // Tick 5 is 100s, past the dwell, and by then B has two ticks above and A three below.
  assert.deepEqual(seen[4], ['b']);
});

test('the escape hatch skips the dwell, and an unmeasured burst can never open it', () => {
  const p = withRank({ slots: 1 });
  const settled = ticks({ a: tickScore(0.5) }, 1, p);

  // Same challenger, same score, one tick later — well inside the ninety-second
  // dwell. With a measured burst over the bar it enters anyway, which is the forty
  // seconds of the product's core claim the dwell rule would otherwise cost.
  const exploding = commitBoard(
    settled,
    { a: tickScore(0.5), b: tickScore(0.6, 4) },
    NOW + p.rank.tickS * SECOND,
    p,
  );
  assert.deepEqual(idsOf(committed(exploding, p)), ['b']);

  // ★ And a burst nobody could measure is null, not a large number and not a 1. It
  // fails the bar, so the hatch stays shut and the ordinary rules apply. An outage in
  // the kinetics must not be able to push a row onto the board.
  const unmeasured = commitBoard(
    settled,
    { a: tickScore(0.5), b: tickScore(0.6, null) },
    NOW + p.rank.tickS * SECOND,
    p,
  );
  assert.deepEqual(idsOf(committed(unmeasured, p)), ['a']);
});

test('a scorer outage does not evict the board: an absence is not a score of zero', () => {
  const p = withRank({ slots: 2 });
  const settled = ticks({ a: tickScore(0.5), b: tickScore(0.45) }, 3, p);

  // Nothing was scored this tick. Reading that as zero would empty the board and then
  // refill it when the scorer came back, which is the worst board there is to be
  // looking at while something is broken.
  const duringOutage = commitBoard(settled, {}, NOW + 10 * MINUTE, p);

  assert.deepEqual(idsOf(committed(duringOutage, p)), ['a', 'b']);
  assert.equal(committed(duringOutage, p)[0]?.score, 0.5);
});

test('nothing moves more than maxPositionsMovedPerTick positions in one tick', () => {
  const p = withRank({ slots: 10 });
  const scores: Record<string, TickScore> = {};
  for (let i = 0; i < 10; i++) scores[`s${i}`] = tickScore(1 - i / 100);
  const settled = ticks(scores, 2, p);
  assert.deepEqual(idsOf(committed(settled, p))[0], 's0');

  // The bottom row is now the best on the board by a mile. It climbs five positions,
  // not nine: a row that teleports is a row a reader loses track of, and the cap is
  // recomputed every tick so it gets the rest of the way on the next one.
  const jumped = commitBoard(settled, { ...scores, s9: tickScore(9) }, NOW + 10 * MINUTE, p);
  assert.equal(idsOf(committed(jumped, p)).indexOf('s9'), 9 - p.rank.maxPositionsMovedPerTick);
});

/* ── stability, which is a measurement of us and not of the world ─────── */

test('rank correlation between ticks stays inside its floor and its ceiling', () => {
  const p = DEFAULT_POLICY;
  const board = Array.from({ length: 20 }, (_, i) => `s${i}`);

  // ★ The ceiling is the half nobody instruments. An ordering that has not moved at
  // all looks perfect on every other instrument in the system — the tick fires, the
  // rows render, the latency is fine — and means the ranker has stopped responding.
  assert.equal(kendallTau(board, board), 1);
  assert.equal(stabilityState(kendallTau(board, board), p), 'frozen');

  // Two disjoint adjacent transpositions out of twenty rows: the board moved, a
  // reader can still follow it. This is the state the product wants to be in.
  const healthy = swapAdjacent(swapAdjacent(board, 3), 11);
  const healthyTau = kendallTau(board, healthy);
  assert.ok(healthyTau > p.rank.kendallTauFloor && healthyTau <= p.rank.kendallTauCeiling);
  assert.equal(stabilityState(healthyTau, p), 'readable');

  // Two reversed blocks of four. Under the target, above the unusable bar: a tuning
  // note rather than an incident, and the two are different alarms on purpose.
  const churning = reverseBlock(reverseBlock(board, 2, 4), 12, 4);
  const churningTau = kendallTau(board, churning);
  assert.ok(churningTau < p.rank.kendallTauFloor && churningTau >= p.rank.kendallTauUnusable);
  assert.equal(stabilityState(churningTau, p), 'churning');

  // Reversed outright. Nobody can read this, and the metric says so in its own word.
  assert.equal(kendallTau(board, [...board].reverse()), -1);
  assert.equal(stabilityState(-1, p), 'unreadable');
});

test('turnover registers as turnover: tau is over the union, never the intersection', () => {
  const previous = Array.from({ length: 20 }, (_, i) => `a${i}`);
  // Half the board is replaced. The ten survivors keep their exact relative order.
  const next = [
    ...previous.slice(0, 10),
    ...Array.from({ length: 10 }, (_, i) => `b${i}`),
  ];

  // ★ This is the number a naive implementation reports: perfect stability, computed
  // over the ids the two lists happen to share, at the exact moment the board is
  // least readable.
  assert.equal(kendallTau(previous.slice(0, 10), next.slice(0, 10)), 1);

  // Over the union, with the leavers ranked below everything present, the churn is
  // visible and lands well under the floor — which is the only useful behaviour.
  const tau = kendallTau(previous, next);
  assert.ok(tau < DEFAULT_POLICY.rank.kendallTauFloor);
  assert.equal(stabilityState(tau, DEFAULT_POLICY), 'unreadable');
});

test('a board too small to have an order is not churning, and is not evidence either', () => {
  // No pairs, so no disagreement is possible. 1 is the honest reading of "nothing
  // moved"; the caller's own alarm is what must not fire on a board of one row.
  assert.equal(kendallTau([], []), 1);
  assert.equal(kendallTau(['a'], ['a']), 1);
  // One ordering exists and the other does not. That is not agreement and not
  // disagreement — it is no information, which is zero.
  assert.equal(kendallTau([], ['a', 'b', 'c']), 0);
});

/* ── the per-subject decision ─────────────────────────────────────────── */

test('a stale vector abstains: our own outage is not a claim that the subject went quiet', () => {
  const p = DEFAULT_POLICY;
  const stale = rank(
    rankInput({ featureAsOf: NOW - (p.rank.maxFeatureAgeS + 1) * SECOND }),
    p,
    CTX,
  );

  assert.equal(stale.verdict, 'abstain');
  assert.equal(stale.reason, 'R5_features_stale');
  // No score, because we did not judge it. A number here would be a judgement we
  // just said we were not entitled to make.
  assert.equal(stale.score, null);
});

test('below the cut is a drop and held by hysteresis is a hold, and they never merge', () => {
  const p = DEFAULT_POLICY;
  const score = heat(rankInput().heat, p);

  const belowCut = rank(rankInput({ incumbentScore: score * 2, incumbentSince: NOW - 10 * MINUTE }), p, {
    ...CTX,
    seed: exploreSeed(false, p),
  });
  assert.equal(belowCut.verdict, 'drop');
  assert.equal(belowCut.reason, 'R1_below_cut');

  // Ahead of the incumbent, but not by the edge. "We looked and said no" and "it is
  // in the queue behind an incumbent" are different populations, and merging them
  // makes every recall number over this stage a lie.
  const nearTie = rank(
    rankInput({ incumbentScore: score - p.rank.swapEdge / 2, incumbentSince: NOW - 10 * MINUTE }),
    p,
    CTX,
  );
  assert.equal(nearTie.verdict, 'hold');
  assert.equal(nearTie.reason, 'R3_hysteresis_hold');

  // Past the edge, inside the dwell. Also a hold, and a third distinct row.
  const dwelling = rank(
    rankInput({ incumbentScore: score - p.rank.swapEdge * 2, incumbentSince: NOW - 30 * SECOND }),
    p,
    CTX,
  );
  assert.equal(dwelling.verdict, 'hold');
  assert.equal(dwelling.reason, 'R2_dwell_hold');
});

test('the new-entrant hatch is its own reason, and an unmeasured burst does not open it', () => {
  const p = DEFAULT_POLICY;
  const exploding = rankInput({
    heat: { rateLcbNorm: 0.4, burst: p.rank.newEntrantBurst + 1, quality: 0.8, ageMin: 30 },
    incumbentScore: 0,
    incumbentSince: NOW - 30 * SECOND,
  });

  const entered = rank(exploding, p, CTX);
  assert.equal(entered.verdict, 'pass');
  // Not folded into R0. "Entered early because it was genuinely exploding" is the
  // population that has to justify its own churn later, and it can only do that if it
  // is a row of its own.
  assert.equal(entered.reason, 'R4_new_entrant');

  // The identical burst, with nothing behind it. The vector records null and the
  // hatch stays shut, so the dwell rule applies as it does to everybody else.
  const unmeasured = rank({ ...exploding, burstMeasured: false }, p, CTX);
  assert.equal(unmeasured.features.burst, null);
  assert.equal(unmeasured.features.heatBurst, p.rank.newEntrantBurst + 1);
  assert.equal(unmeasured.reason, 'R2_dwell_hold');
});

test('an exploration slot records its propensity, or the counterfactual is undefined', () => {
  const p = DEFAULT_POLICY;
  const score = heat(rankInput().heat, p);
  const input = rankInput({ incumbentScore: score * 2, incumbentSince: NOW - 10 * MINUTE });

  const drawn = rank(input, p, { ...CTX, seed: exploreSeed(true, p) });
  assert.equal(drawn.verdict, 'pass');
  assert.equal(drawn.reason, 'R6_explore_slot');
  assert.equal(drawn.exploreArm, 'epsilon');
  assert.equal(drawn.explore, true);
  // ★ The slot budget, not ADMIT's draw over arrivals. They are different
  // populations with separately costed penalties, and one number for both writes a
  // wrong propensity on every row here.
  assert.equal(drawn.propensity, p.rank.exploreSlotShare);

  // And it is genuinely its own field: moving ADMIT's draw over arrivals leaves the
  // propensity written on a rank row untouched. If the two were one number, this is
  // the assertion that would have caught it.
  const louderAdmit: Policy = { ...p, explore: { ...p.explore, epsilon: 0.5 } };
  assert.equal(rank(input, louderAdmit, { ...CTX, seed: exploreSeed(true, p) }).propensity, p.rank.exploreSlotShare);
});

test('the vector records the heat inputs and not the heat, so a curve change replays', () => {
  const f = extract(rankInput(), CTX);

  // All four inputs, raw. `alpha`, `gamma` and `t0Min` are policy, so a row that
  // froze the output could never be replayed against a different curve — which is the
  // single most likely thing anybody will want to replay this stage against.
  assert.equal(f.rateLcbNorm, 0.4);
  assert.equal(f.heatBurst, 2.25);
  assert.equal(f.quality, 0.8);
  assert.equal(f.ageMin, 30);

  // The same frozen vector against two curves. Under the shipped gamma the subject
  // is behind its incumbent and held; under a flatter age penalty the same evidence
  // is worth enough to take the slot. That difference is the replay, and it is
  // computable from the row alone — no stage input, no network, no clock.
  const held = { ...f, incumbentScore: 0.11, incumbentDwellS: 600 };
  const flatter = withRank({ gamma: DEFAULT_POLICY.rank.gamma / 2 });
  assert.equal(gate(held, DEFAULT_POLICY), 'R1_below_cut');
  assert.equal(gate(held, flatter), null);
});

test('gate() and rank() agree, so a replayed threshold means what the live one meant', () => {
  const p = DEFAULT_POLICY;
  const score = heat(rankInput().heat, p);
  const ctx = { ...CTX, seed: exploreSeed(false, p) };

  const fixtures: RankInput[] = [
    rankInput(),
    rankInput({ slot: 3, incumbentScore: score, incumbentSince: NOW - 10 * MINUTE }),
    rankInput({ incumbentScore: score * 2, incumbentSince: NOW - 10 * MINUTE }),
    rankInput({ incumbentScore: score - p.rank.swapEdge / 2, incumbentSince: NOW - 10 * MINUTE }),
    rankInput({ incumbentScore: 0, incumbentSince: NOW - 30 * SECOND }),
    rankInput({ incumbentScore: 0, incumbentSince: NOW - 10 * MINUTE }),
    rankInput({ featureAsOf: NOW - (p.rank.maxFeatureAgeS + 1) * SECOND }),
  ];

  for (const input of fixtures) {
    const decision = rank(input, p, ctx);
    const blocked = gate(extract(input, ctx), p);
    if (blocked === null) {
      assert.equal(decision.verdict, 'pass', `${decision.reason} should have passed`);
      assert.ok(decision.reason === 'R0_ranked' || decision.reason === 'R4_new_entrant');
    } else {
      assert.equal(decision.reason, blocked);
      assert.notEqual(decision.verdict, 'pass');
    }
  }
});

test('horizonS is recorded, because how early we were is the whole claim', () => {
  const decision = rank(rankInput({ subjectOrigin: NOW - 30 * MINUTE }), DEFAULT_POLICY, CTX);
  assert.equal(decision.horizonS, (30 * MINUTE) / SECOND);

  // Null rather than the clock when no member of the story carried a post time.
  // A zero here would be a claim that we were instantaneous.
  assert.equal(rank(rankInput({ subjectOrigin: null }), DEFAULT_POLICY, CTX).horizonS, null);
});

/* ── helpers ──────────────────────────────────────────────────────────── */

/** The first seed inside or outside the exploration lane. Found, never guessed. */
function exploreSeed(inLane: boolean, p: Policy): string {
  for (let i = 0; i < 10_000; i++) {
    const seed = `rank:subject-${i}`;
    if (isExploreDraw(seed, p.rank.exploreSlotShare, p.explore.holdoutSalt) === inLane) return seed;
  }
  throw new Error('no seed found on either side of the exploration lane');
}

function swapAdjacent(list: readonly string[], at: number): string[] {
  const out = [...list];
  const a = out[at] as string;
  out[at] = out[at + 1] as string;
  out[at + 1] = a;
  return out;
}

function reverseBlock(list: readonly string[], at: number, length: number): string[] {
  return [...list.slice(0, at), ...list.slice(at, at + length).reverse(), ...list.slice(at + length)];
}
