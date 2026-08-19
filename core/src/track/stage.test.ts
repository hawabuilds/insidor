/**
 * TRACK, as the claims its implementation has to satisfy.
 *
 * The four headline tests below were written as `todo` before the code existed — a
 * todo test is a specification that shows up in the test output, which a comment in a
 * document does not. They are the invariants that, if they break, break the corpus
 * rather than the feed: three of the four are restatements of "an item's history
 * length may not depend on its early performance", approached from the scheduler, the
 * shed rule and the lifecycle in turn.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StageContext } from '@insidor/contracts/decision.ts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { initialLifecycle, nextLifecycle, type LifecycleReading } from '../kinetics/lifecycle.ts';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../math.ts';
import { nextRead } from './schedule.ts';
import { shed, type ReadDemand } from './shed.ts';
import { gate, passReasonFor, track, verdictFor, type TrackInput } from './stage.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const SOURCE = sourceId('testsrc');
const P = DEFAULT_POLICY;

const GRID = P.track.tierMinutes;
const TOP_TIER = 0;
const PROBATION = GRID.length - 1;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'track:i1' };

function item(over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(SOURCE, 'i1'),
    source: SOURCE,
    sourceItemId: 'i1',
    authorKey: authorKey(SOURCE, 'a1'),
    postedAt: NOW - 60 * MINUTE,
    firstSeenAt: NOW - 58 * MINUTE,
    lang: null,
    text: 'the ferry refuses to dock',
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: 'local:test/i1',
    ...over,
  };
}

/** One observation, enough to say the source has answered us at least once. */
function reading(): TrackInput['observations'] {
  return [
    {
      itemId: itemId(SOURCE, 'i1'),
      capturedAt: NOW - 5 * MINUTE,
      kind: 'reproduction',
      counter: { value: 10, fidelity: { kind: 'exact' }, observedAt: NOW - 5 * MINUTE },
      rate: { kind: 'measured', perMin: 1, overMs: 10 * MINUTE, level: 10 },
    },
  ];
}

/** Due by default: the last read is longer ago than the top tier's interval. */
function input(over: Partial<TrackInput> = {}): TrackInput {
  return {
    item: item(),
    observations: reading(),
    lastReadAt: NOW - 30 * MINUTE,
    tier: TOP_TIER,
    lastScore: 0.95,
    censoredReadStreak: 0,
    lifecycle: null,
    isHeldBack: false,
    readsAvailable: 100,
    costUsd: 0,
    ...over,
  };
}

/* ── the four claims written down before the code existed ─────────────── */

test('a read that is not yet due is held, not dropped', () => {
  // Read one minute ago, on a four-minute tier. Nothing is wrong with this item; it is
  // simply early. A drop here would be a claim that we decided against it.
  const d = track(input({ lastReadAt: NOW - 1 * MINUTE }), P, CTX);

  assert.equal(d.verdict, 'hold');
  assert.equal(d.reason, 'T6_not_due');
  assert.notEqual(d.verdict, 'drop');
  assert.ok((d.features.dueInMin ?? 0) > 0);
});

test('a held-back item stays on the full grid whatever it scores', () => {
  const worst = nextRead(NOW, PROBATION, 0, true, P);
  const best = nextRead(NOW, TOP_TIER, 1, true, P);

  // Same tier, same due time, from opposite ends of the score range AND opposite ends
  // of the grid. An item whose read cadence depended on its score would not be
  // measuring what the scored lane gets wrong — it would be a slower copy of it.
  assert.equal(worst.tier, TOP_TIER);
  assert.equal(best.tier, TOP_TIER);
  assert.equal(worst.dueAt, best.dueAt);
  assert.equal(worst.dueAt, NOW + (GRID[TOP_TIER] ?? 0) * MS_PER_MINUTE);

  // Not scored at all: still the full grid.
  assert.equal(nextRead(NOW, PROBATION, null, true, P).tier, TOP_TIER);

  // ★ And the budget is never consulted. Zero reads left, a terrible score, a long
  // censored streak, and past the tracking horizon — it is still read.
  const d = track(
    input({
      isHeldBack: true,
      readsAvailable: 0,
      lastScore: 0,
      censoredReadStreak: 99,
      item: item({ firstSeenAt: NOW - (P.track.maxTrackedHours + 100) * MS_PER_HOUR }),
    }),
    P,
    CTX,
  );

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'T5_holdout_full_grid');
});

test('budget backpressure sheds the top tier first and never probation', () => {
  const demand: ReadDemand[] = [
    { tier: TOP_TIER, dueCount: 40, isHeldBack: false },
    { tier: 3, dueCount: 30, isHeldBack: false },
    { tier: PROBATION, dueCount: 50, isHeldBack: false },
  ];

  // Enough for probation and the middle tier, not for all three.
  const served = shed(demand, 90, P);

  assert.ok(served.includes(PROBATION), 'probation is never shed');
  assert.ok(served.includes(3), 'the tier nearest probation is kept next');
  assert.ok(
    !served.includes(TOP_TIER),
    'the top tier is shed first: re-reading a confirmed riser buys almost nothing',
  );

  // Under crushing pressure probation is STILL served — even alone, even over budget.
  // The budget is a target and probation is a floor, in that order.
  const starved = shed(demand, 1, P);
  assert.deepEqual(starved, [PROBATION]);

  // The holdout is not shed either, and its cost comes out of the budget first, so it
  // competes with nothing. Here the whole budget is the holdout's, and the scored
  // tiers below probation get nothing.
  const withHoldout = shed(
    [...demand, { tier: TOP_TIER, dueCount: 90, isHeldBack: true }],
    90,
    P,
  );
  assert.deepEqual(withHoldout, [PROBATION]);
});

test('tracking never stops early because an item looked cold', () => {
  // An item that scores zero on every reading. Walk it down the grid one read at a
  // time and assert it DEGRADES rather than terminating: it slides to probation and
  // stays there, for ever, which is what makes its history usable as training data.
  let tier = TOP_TIER;
  let at = NOW;

  for (let read = 0; read < GRID.length * 2; read += 1) {
    const s = nextRead(at, tier, 0, false, P);

    // ★ Never more than one tier per read, in either direction. An item that can fall
    // from the top to probation on one bad reading has a history length that tracks
    // its early performance, which is the outcome.
    assert.ok(Math.abs(s.tier - tier) <= 1, `read ${read} moved ${tier} → ${s.tier}`);
    assert.ok(s.dueAt > at, 'there is always a next read');

    tier = s.tier;
    at = s.dueAt;
  }

  // It bottomed out at probation and was never pruned.
  assert.equal(tier, PROBATION);

  // And the stage agrees: a cold item inside the tracking horizon is still read.
  const d = track(input({ tier: PROBATION, lastScore: 0, lastReadAt: NOW - 90 * MINUTE }), P, CTX);
  assert.equal(d.verdict, 'pass');
  assert.notEqual(d.verdict, 'drop');
});

/* ── the budget decision is a row, never a silent skip ────────────────── */

test('an item we could not afford to re-read is held and recorded, not dropped', () => {
  const d = track(input({ readsAvailable: 0 }), P, CTX);

  // The identical argument admit/stage.ts makes for A9: an item we could not afford
  // and an item we decided against are different populations, and merging them makes
  // every later recall number over this stage a lie.
  assert.equal(d.verdict, 'hold');
  assert.equal(d.reason, 'T2_budget_shed');
  assert.notEqual(d.verdict, 'drop');
  assert.equal(d.features.readsAvailable, 0);
});

test('an item the source would not answer for is held, because an outage is not a claim', () => {
  // We have read it — lastReadAt is past first sight — and it has produced nothing.
  const d = track(input({ observations: [] }), P, CTX);

  assert.equal(d.verdict, 'hold');
  assert.equal(d.reason, 'T4_unreachable');
  assert.equal(d.features.hasBeenRead, 1);
  assert.equal(d.features.observationCount, 0);

  // An item we have never read yet is not unreachable; it is simply new.
  const fresh = track(
    input({ observations: [], lastReadAt: NOW - 58 * MINUTE }),
    P,
    CTX,
  );
  assert.notEqual(fresh.reason, 'T4_unreachable');
});

/* ── demotion, and the ceiling on how fast it can happen ──────────────── */

test('a censored streak demotes exactly one tier and says so', () => {
  const d = track(input({ tier: 2, censoredReadStreak: P.track.flatReadsToDemote }), P, CTX);

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'T1_tier_demoted');
  assert.equal(d.features.demoted, 1);
  assert.equal(d.features.scheduledTier, 3);

  // ★ The streak beats the score, and the score in this fixture is 0.95 — which alone
  // would PROMOTE the item to tier 1. A run of reads that produced no usable rate is
  // newer evidence than the number those reads failed to move, and letting a stale
  // high score cancel a live demotion keeps the item on the tier that costs money.
  assert.equal(track(input({ tier: 2, censoredReadStreak: 0 }), P, CTX).features.scheduledTier, 1);

  // ★ And it cannot stack into a two-tier fall: measured from the CURRENT tier, a low
  // score and a censored streak together still move it exactly one step.
  const both = track(
    input({ tier: 2, lastScore: 0, censoredReadStreak: P.track.flatReadsToDemote }),
    P,
    CTX,
  );
  assert.equal(both.features.scheduledTier, 3);

  // And a streak below the bar demotes nothing.
  const short = track(
    input({ tier: 2, censoredReadStreak: P.track.flatReadsToDemote - 1 }),
    P,
    CTX,
  );
  assert.equal(short.features.demoted, 0);
  assert.equal(short.reason, 'T0_scheduled');
});

test('an unscored item holds its tier rather than being treated as a zero', () => {
  // null is not a low score. Treating "not scored yet" as "scored badly" would demote
  // every new arrival on its first pass — precisely where the dense reading is worth
  // the most, and precisely the failure the old scheduler shipped.
  assert.equal(nextRead(NOW, 2, null, false, P).tier, 2);
  assert.equal(nextRead(NOW, 0, null, false, P).tier, 0);

  // A zero score, by contrast, is a real claim and does move it.
  assert.equal(nextRead(NOW, 2, 0, false, P).tier, 3);
});

test('the grid is geometric, so a tier is always a longer wait than the one above', () => {
  for (let tier = 1; tier < GRID.length; tier += 1) {
    const here = nextRead(NOW, tier, null, false, P);
    const above = nextRead(NOW, tier - 1, null, false, P);
    assert.ok(here.dueAt > above.dueAt, `tier ${tier} is not a longer wait than ${tier - 1}`);
  }
});

/* ── the terminal edge ────────────────────────────────────────────────── */

test('past the tracking horizon the item is terminal, and the holdout is exempt', () => {
  const old = item({ firstSeenAt: NOW - (P.track.maxTrackedHours + 1) * MS_PER_HOUR });

  const scored = track(input({ item: old }), P, CTX);
  assert.equal(scored.verdict, 'drop');
  assert.equal(scored.reason, 'T3_terminal');

  // "Stop re-reading after this, UNLESS the item is in the holdout" — the one lane
  // whose history length is guaranteed to depend on nothing is never stopped.
  const held = track(input({ item: old, isHeldBack: true }), P, CTX);
  assert.equal(held.verdict, 'pass');
  assert.equal(held.reason, 'T5_holdout_full_grid');
});

test('a dormant lifecycle is terminal, and it is an input rather than a recomputation', () => {
  const dormant: LifecycleReading = {
    state: 'dormant',
    proposed: 'dormant',
    agreeing: P.track.agreeingToDormant,
    since: NOW - 60 * MINUTE,
  };

  const d = track(input({ lifecycle: dormant }), P, CTX);
  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'T3_terminal');
  assert.equal(d.features.lifecycleTerminal, 1);

  // Held back: never terminal, whatever the lifecycle says.
  const held = track(input({ lifecycle: dormant, isHeldBack: true }), P, CTX);
  assert.equal(held.verdict, 'pass');

  // And an item with no lifecycle reading yet records the absence rather than a zero:
  // "no lifecycle" is not "not terminal", it is "we have not run one".
  assert.equal(track(input(), P, CTX).features.lifecycleTerminal, null);
});

/* ── the replay ───────────────────────────────────────────────────────── */

test('gate() and track() agree on every fixture, so a tier cutoff is replayable', () => {
  const cases: Array<[string, TrackInput]> = [
    ['not due', input({ lastReadAt: NOW - 1 * MINUTE })],
    ['due and affordable', input()],
    ['unaffordable', input({ readsAvailable: 0 })],
    ['unreachable', input({ observations: [] })],
    ['demoted', input({ tier: 2, censoredReadStreak: P.track.flatReadsToDemote })],
    ['held back', input({ isHeldBack: true, readsAvailable: 0 })],
    ['past the horizon', input({ item: item({ firstSeenAt: NOW - 200 * MS_PER_HOUR }) })],
    [
      'dormant',
      input({
        lifecycle: { state: 'dormant', proposed: 'dormant', agreeing: 9, since: NOW - MINUTE },
      }),
    ],
    ['cold and old', input({ tier: PROBATION, lastScore: 0, lastReadAt: NOW - 90 * MINUTE })],
  ];

  for (const [name, i] of cases) {
    const d = track(i, P, CTX);
    const blocked = gate(d.features, P);

    if (blocked === null) {
      assert.equal(d.verdict, 'pass', name);
      assert.equal(d.reason, passReasonFor(d.features), name);
    } else {
      assert.equal(d.reason, blocked, name);
      assert.equal(d.verdict, verdictFor(blocked), name);
    }
  }
});

test('the row carries the bars it was judged against', () => {
  const d = track(input(), P, CTX);
  assert.equal(d.features.maxTrackedHours, P.track.maxTrackedHours);
  assert.equal(d.features.flatReadsToDemote, P.track.flatReadsToDemote);
  assert.equal(d.features.probationTier, PROBATION);
  assert.ok(d.featureAsOf <= d.decidedAt);
});

/* ── the shed rule's own algebra ──────────────────────────────────────── */

test('the shed returns the tiers to SERVE, and the set is contiguous from probation up', () => {
  const demand: ReadDemand[] = [
    { tier: 0, dueCount: 10, isHeldBack: false },
    { tier: 1, dueCount: 10, isHeldBack: false },
    { tier: 2, dueCount: 10, isHeldBack: false },
    { tier: PROBATION, dueCount: 10, isHeldBack: false },
  ];

  // Everything fits.
  assert.deepEqual(shed(demand, 1000, P), [0, 1, 2, PROBATION]);

  // ★ The walk STOPS at the first tier that does not fit rather than skipping it to
  // find a cheaper one further up. A shed middle tier with a served top tier above it
  // would be the rule inverted for the one tier it happened to be cheap on.
  const expensive: ReadDemand[] = [
    { tier: 0, dueCount: 1, isHeldBack: false },
    { tier: 1, dueCount: 500, isHeldBack: false },
    { tier: PROBATION, dueCount: 10, isHeldBack: false },
  ];
  const served = shed(expensive, 20, P);
  assert.deepEqual(served, [PROBATION], 'tier 0 is cheap but sits above a tier that did not fit');
});

test('a shed that returned the tiers to DROP would invert the rule, so the direction is pinned', () => {
  // The single most dangerous inversion in this file, asserted as a value rather than
  // trusted to a name: with a budget that covers only some of the demand, the answer
  // must CONTAIN probation and must NOT contain the top tier.
  const served = shed(
    [
      { tier: TOP_TIER, dueCount: 10, isHeldBack: false },
      { tier: PROBATION, dueCount: 10, isHeldBack: false },
    ],
    10,
    P,
  );
  assert.ok(served.includes(PROBATION));
  assert.ok(!served.includes(TOP_TIER));
});

/* ── the lifecycle machine ────────────────────────────────────────────── */

test('entering rising is cheap and leaving it is not', () => {
  const start = initialLifecycle(NOW - 60 * MINUTE);
  const margin = P.track.lifecycleMargin;
  const later = NOW;

  // Rise: agreeingToRise readings and it commits.
  let r: LifecycleReading = start;
  for (let i = 0; i < P.track.agreeingToRise; i += 1) {
    r = nextLifecycle(r, 'rising', margin, later, P);
  }
  assert.equal(r.state, 'rising');

  // Fall: the same number of readings is NOT enough to leave it.
  let f: LifecycleReading = r;
  for (let i = 0; i < P.track.agreeingToRise; i += 1) {
    f = nextLifecycle(f, 'cooling', margin, later + 60 * MINUTE, P);
  }
  assert.equal(f.state, 'rising', 'leaving rising must cost more than entering it');

  // With the full count it commits.
  for (let i = 0; i < P.track.agreeingToFall - P.track.agreeingToRise; i += 1) {
    f = nextLifecycle(f, 'cooling', margin, later + 60 * MINUTE, P);
  }
  assert.equal(f.state, 'cooling');
});

test('the terminal edge costs the most, because it costs the item permanently', () => {
  assert.ok(P.track.agreeingToDormant > P.track.agreeingToFall);
  assert.ok(P.track.agreeingToFall > P.track.agreeingToRise);

  let r = initialLifecycle(NOW - 60 * MINUTE);
  const at = NOW;
  for (let i = 0; i < P.track.agreeingToFall; i += 1) {
    r = nextLifecycle(r, 'dormant', P.track.lifecycleMargin, at, P);
  }
  assert.equal(r.state, 'fresh', 'a fall-sized run of agreement must not reach dormant');

  for (let i = 0; i < P.track.agreeingToDormant - P.track.agreeingToFall; i += 1) {
    r = nextLifecycle(r, 'dormant', P.track.lifecycleMargin, at, P);
  }
  assert.equal(r.state, 'dormant');
});

test('a proposal inside the noise is recorded and never committed', () => {
  let r = initialLifecycle(NOW - 60 * MINUTE);
  const weak = P.track.lifecycleMargin / 2;

  for (let i = 0; i < P.track.agreeingToDormant * 2; i += 1) {
    r = nextLifecycle(r, 'rising', weak, NOW, P);
  }

  assert.equal(r.state, 'fresh', 'no number of weak readings may commit a transition');
  // But the evidence IS accumulated, which is what lets a run of weak readings become
  // a transition the moment one of them argues with real margin.
  assert.equal(r.proposed, 'rising');
  assert.ok(r.agreeing > P.track.agreeingToRise);

  const strong = nextLifecycle(r, 'rising', P.track.lifecycleMargin, NOW, P);
  assert.equal(strong.state, 'rising');
});

test('the dwell bounds how fast the machine moves, which an agreement count does not', () => {
  // Three readings inside one minute agree three times and have observed one minute.
  const justEntered = initialLifecycle(NOW);
  let r: LifecycleReading = justEntered;
  for (let i = 0; i < P.track.agreeingToDormant; i += 1) {
    r = nextLifecycle(r, 'rising', 1, NOW, P);
  }
  assert.equal(r.state, 'fresh', 'the dwell has not elapsed');

  const afterDwell = nextLifecycle(r, 'rising', 1, NOW + P.track.minLifecycleDwellMs, P);
  assert.equal(afterDwell.state, 'rising');
  assert.equal(afterDwell.since, NOW + P.track.minLifecycleDwellMs);
});

test('a reading agreeing with the committed state is the resting position', () => {
  const r = nextLifecycle(initialLifecycle(NOW - 60 * MINUTE), 'fresh', 1, NOW, P);
  assert.equal(r.state, 'fresh');
  assert.equal(r.proposed, 'fresh');
  assert.equal(r.since, NOW - 60 * MINUTE, 'agreeing with where you are does not restart the dwell');
});

test('a proposal that changes restarts the count rather than inheriting it', () => {
  let r = initialLifecycle(NOW - 60 * MINUTE);
  r = nextLifecycle(r, 'cooling', P.track.lifecycleMargin, NOW, P);
  r = nextLifecycle(r, 'cooling', P.track.lifecycleMargin, NOW, P);
  assert.equal(r.agreeing, 2);

  // Consecutive means consecutive: a different proposal is a different question.
  const switched = nextLifecycle(r, 'rising', P.track.lifecycleMargin, NOW, P);
  assert.equal(switched.agreeing, 1);
});
