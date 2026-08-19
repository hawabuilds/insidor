/**
 * DETECT, as the claims its implementation has to satisfy.
 *
 * The five headline tests below were written as `todo` before the code existed,
 * because they are the ones the previous build got wrong. Two of them are attached to
 * files that were ALREADY shipped — `detect/burst.ts` and `kinetics/ewma.ts` — and
 * they are the two properties the whole stage rests on, so they are tested here rather
 * than left as unwritten tests of working code.
 *
 * ★ WHAT A GREEN RUN HERE DOES AND DOES NOT SUPPORT. Every fixture is invented. These
 * prove the stage computes what the design says it computes — which rung of the ladder
 * fires, which of the four verdicts comes out, which threshold moved it. They prove
 * nothing about precision or recall on real items, because no observation corpus and
 * no labelled burst exists in this repository to measure either against.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StageContext } from '@insidor/contracts/decision.ts';
import { authorKey, itemId, sourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { CensorReason, CounterKind, Item, Observation } from '@insidor/contracts/vocabulary.ts';
import { censoredRate, measuredRate } from '@insidor/contracts/vocabulary.ts';

import { ewmaUpdate, type Ewma } from '../kinetics/ewma.ts';
import { MS_PER_MINUTE } from '../math.ts';
import { populationBaseline, selfBaseline, type Baseline } from './baseline.ts';
import { burst } from './burst.ts';
import { eta } from './poisson.ts';
import { detect, extract, gate, verdictFor, type DetectInput } from './stage.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const SOURCE = sourceId('testsrc');
const P = DEFAULT_POLICY;
const WINDOW = P.detect.countWindowMin;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'detect:i1' };

function item(over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(SOURCE, 'i1'),
    source: SOURCE,
    sourceItemId: 'i1',
    authorKey: authorKey(SOURCE, 'a1'),
    postedAt: NOW - 30 * MINUTE,
    firstSeenAt: NOW - 28 * MINUTE,
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

/** One reading whose rate was measured, at `perMin` for the given counter. */
function measured(kind: CounterKind, perMin: number, atMinutesAgo = 0): Observation {
  const capturedAt = NOW - atMinutesAgo * MINUTE;
  return {
    itemId: itemId(SOURCE, 'i1'),
    capturedAt,
    kind,
    counter: { value: perMin * WINDOW, fidelity: { kind: 'exact' }, observedAt: capturedAt },
    rate: measuredRate(perMin, WINDOW * MS_PER_MINUTE, perMin * WINDOW),
  };
}

/** One reading the censoring rule refused to turn into a rate. */
function censored(kind: CounterKind, reason: CensorReason, atMinutesAgo = 0): Observation {
  const capturedAt = NOW - atMinutesAgo * MINUTE;
  return {
    itemId: itemId(SOURCE, 'i1'),
    capturedAt,
    kind,
    counter: { value: null, fidelity: { kind: 'quantized', significantDigits: 2 }, observedAt: capturedAt },
    rate: censoredRate(reason, null),
  };
}

/** A baseline that is usable and quiet, expressed as a count in the window. */
function baseline(expectation: number, over: Partial<Baseline> = {}): Baseline {
  return {
    expectation,
    dispersion: P.detect.dispersionByKind.reproduction,
    reads: P.detect.minBaselineReads,
    hourOfDay: null,
    ...over,
  };
}

/** Two averages far enough apart to clear burstBar, both dated to now. */
function bursting(): { fast: Ewma; slow: Ewma } {
  return { fast: { value: 10, at: NOW }, slow: { value: 1, at: NOW } };
}

function input(over: Partial<DetectInput> = {}): DetectInput {
  const { fast, slow } = bursting();
  return {
    item: item(),
    observations: [measured('reproduction', 50)],
    fast,
    slow,
    self: baseline(1),
    population: baseline(1),
    costUsd: 0,
    ...over,
  };
}

/* ── the five claims written down before the code existed ─────────────── */

test('a censored reading abstains; it never reads as cooling', () => {
  // Everything else about this item screams: the averages are bursting and both
  // baselines are quiet. The only thing missing is a usable rate.
  const d = detect(
    input({ observations: [censored('reproduction', 'below_step')] }),
    P,
    CTX,
  );

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'D2_rate_censored');

  // The three things it must NOT be. D5 is "we looked and said no", which would be a
  // claim that the item is not moving — and a censored counter is the source telling
  // us nothing, which is not a claim about the item at all.
  assert.notEqual(d.verdict, 'drop');
  assert.notEqual(d.reason, 'D5_no_acceleration');
  assert.notEqual(d.reason, 'D3_below_absolute_floor');

  // And the vector says a rate was censored rather than recording a rate of zero.
  assert.equal(d.features.driverRateCensored, 1);
  assert.equal(d.features.driverRatePerMin, null);
  assert.equal(d.features.driverCount, null);
});

test('a censored reading is a different row from an unread one', () => {
  // Both abstain. They are separate reason codes because one drains as the schedule
  // runs and the other does not: a D2 rate that climbs is a source degrading, and a
  // D1 rate that climbs is TRACK falling behind.
  const firstRead = detect(input({ observations: [censored('reproduction', 'no_prior')] }), P, CTX);
  assert.equal(firstRead.verdict, 'abstain');
  assert.equal(firstRead.reason, 'D1_insufficient_history');

  const nothingRead = detect(input({ observations: [] }), P, CTX);
  assert.equal(nothingRead.verdict, 'abstain');
  assert.equal(nothingRead.reason, 'D1_insufficient_history');
  assert.equal(nothingRead.features.driverCounterIndex, null);
  // "No counter was censored" and "no counter was read" are different facts, and only
  // one of them is about censoring.
  assert.equal(nothingRead.features.driverRateCensored, null);
});

test('the self baseline alone can never open the gate', () => {
  // An item that is wildly atypical for ITSELF: a count of 1000 in the window against
  // its own trailing expectation of 1. The self leg is as open as it can be.
  const screaming = { observations: [measured('reproduction', 1000 / WINDOW)], self: baseline(1) };

  // 1. With no cohort to compare against, the answer is abstain and NOT a pass. A
  //    missing population baseline is an absent input, and an outage is not a claim —
  //    in either direction. It may not open the gate and it may not close it as D5.
  const noCohort = detect(input({ ...screaming, population: null }), P, CTX);
  assert.equal(noCohort.verdict, 'abstain');
  assert.equal(noCohort.reason, 'D4_baseline_unavailable');
  assert.notEqual(noCohort.reason, 'D5_no_acceleration');

  // 2. With a cohort for which this count is utterly ordinary, the self leg's opinion
  //    does not survive. Both bars are required; neither is sufficient.
  const ordinaryForCohort = detect(
    input({ ...screaming, population: baseline(1000) }),
    P,
    CTX,
  );
  assert.equal(ordinaryForCohort.verdict, 'drop');
  assert.equal(ordinaryForCohort.reason, 'D5_no_acceleration');

  // 3. And under the absolute floor, the self baseline is not even consulted. This is
  //    the rung an adversary cannot open: depress your own history all you like, a
  //    count of five reproductions never reaches the relative test.
  const belowFloor = detect(
    input({ observations: [measured('reproduction', 5 / WINDOW)], self: baseline(0.01) }),
    P,
    CTX,
  );
  assert.equal(belowFloor.verdict, 'drop');
  assert.equal(belowFloor.reason, 'D3_below_absolute_floor');
});

test('burst is available at the second reading, not the third', () => {
  const tau = { fast: P.kinetics.fastTauMin, slow: P.kinetics.slowTauMin };
  const fastTauMs = tau.fast * MS_PER_MINUTE;
  const slowTauMs = tau.slow * MS_PER_MINUTE;

  // ONE reading. Both legs are seeded to the sample itself — ewmaUpdate returns the
  // sample exactly on the first fold, because seeding with zero would make every
  // series open by claiming a decline. So burst exists and is exactly 1: it says
  // nothing, and saying nothing is not the same as being unavailable.
  const t0 = NOW - 8 * MINUTE;
  let fast: Ewma | null = ewmaUpdate(null, 1, t0, fastTauMs);
  let slow: Ewma | null = ewmaUpdate(null, 1, t0, slowTauMs);
  assert.equal(burst(fast, slow, t0, P.kinetics), 1);

  // TWO readings, the second four times the first. The fast leg has folded most of the
  // new value in and the slow leg has barely moved, so the ratio is already over the
  // bar. A second difference — the alternative curvature estimate — needs a THIRD
  // reading, which on this grid is another four to nine minutes away.
  const t1 = t0 + 4 * MINUTE;
  fast = ewmaUpdate(fast, 4, t1, fastTauMs);
  slow = ewmaUpdate(slow, 4, t1, slowTauMs);
  const atSecond = burst(fast, slow, t1, P.kinetics);

  assert.ok(atSecond !== null);
  assert.ok(
    atSecond > P.detect.burstBar,
    `two readings should already clear burstBar, got ${atSecond}`,
  );

  // And the earliness is real rather than a rounding artefact: the fast leg moved
  // substantially more than the slow one over the same single interval.
  assert.ok((fast?.value ?? 0) > (slow?.value ?? 0));

  // Null, never 1, when a leg is missing. A missing average is not a flat one.
  assert.equal(burst(null, slow, t1, P.kinetics), null);
  assert.equal(burst(fast, null, t1, P.kinetics), null);
});

test('an irregular read grid does not inflate the frequently-read item', () => {
  // The same underlying behaviour — a steady rate of 10 — observed over the same two
  // hours by a hot item on a four-minute grid and a cold one on a forty-minute grid.
  const tauMs = P.kinetics.fastTauMin * MS_PER_MINUTE;
  const spanMinutes = 120;
  const start = NOW - spanMinutes * MINUTE;
  const steadyRate = 10;

  const series = (everyMinutes: number): Ewma => {
    let e = ewmaUpdate(null, 1, start, tauMs);
    for (let t = everyMinutes; t <= spanMinutes; t += everyMinutes) {
      e = ewmaUpdate(e, steadyRate, start + t * MINUTE, tauMs);
    }
    return e;
  };

  const readOften = series(4);
  const readRarely = series(40);

  // ★ The continuous-time form weights by ELAPSED TIME, so the result depends only on
  // how long has passed and not on how many times we looked. Thirty reads and three
  // reads of the same steady behaviour produce the same average, exactly.
  assert.ok(
    Math.abs(readOften.value - readRarely.value) < 1e-9,
    `dense ${readOften.value} vs sparse ${readRarely.value}`,
  );

  // And the failure it avoids, demonstrated rather than asserted about: the textbook
  // discrete recurrence with a fixed alpha gives the frequently-read item an average
  // much closer to the new value, purely because it was read more often. That gap is a
  // ranking signal manufactured by the scheduler, on exactly the items it looks at most.
  const discrete = (steps: number): number => {
    const alpha = 0.3;
    let s = 1;
    for (let i = 0; i < steps; i += 1) s = alpha * steadyRate + (1 - alpha) * s;
    return s;
  };
  assert.ok(
    discrete(spanMinutes / 4) - discrete(spanMinutes / 40) > 1,
    'the discrete form must visibly favour the frequently-read item, or this test proves nothing',
  );
});

test('eta is comparable across sources without a per-source constant', () => {
  const r = P.detect.dispersionByKind.reproduction;
  const bar = P.detect.etaSelfBar;

  // Two "sources" three orders of magnitude apart in scale.
  const quiet = 2; // a small account: two arrivals expected in the window
  const busy = 2000; // a large one

  // The smallest count that clears the SAME bar on each. eta is a probability scale,
  // so one bar is meaningful on both — which is the entire claim.
  const clears = (expectation: number): number => {
    for (let n = 1; n < 1_000_000; n += 1) {
      if (eta(n, expectation, r) >= bar) return n;
    }
    throw new Error('no count cleared the bar');
  };

  const quietCount = clears(quiet);
  const busyCount = clears(busy);

  // ★ THE COUNTS ARE NOT COMPARABLE AND THE ETAS ARE. A threshold on the raw count
  // would need a per-source constant — and this is how far apart the two constants
  // would be. A threshold on eta needs none.
  assert.ok(
    busyCount > quietCount * 10,
    `a count bar cannot serve both: ${quietCount} vs ${busyCount}`,
  );
  assert.ok(eta(quietCount, quiet, r) >= bar);
  assert.ok(eta(busyCount, busy, r) >= bar);

  // The scale behaves: nothing observed is nothing surprising, and more is more.
  assert.equal(eta(0, quiet, r), 0);
  assert.ok(eta(20, quiet, r) > eta(10, quiet, r));

  // A fractional count floors, so the rounding can only ever cost an alert.
  assert.equal(eta(9.9, quiet, r), eta(9, quiet, r));
});

/* ── the distribution, and the failure it is a repair of ──────────────── */

test('Poisson is the limit as the dispersion goes to infinity, as a code path', () => {
  // The Poisson tail is P(X >= n) = regularized lower incomplete gamma(n, mu). Taking
  // it exactly for a non-finite dispersion is what makes "Poisson is the limit" a
  // property with a test rather than a sentence in a comment.
  const mu = 4;
  const exact = eta(1, mu, Number.POSITIVE_INFINITY);
  // P(X >= 1) = 1 - e^-mu, so eta = -log10(1 - e^-mu).
  assert.ok(Math.abs(exact - -Math.log10(1 - Math.exp(-mu))) < 1e-9);

  // And a large finite dispersion converges to it from below, which is the direction
  // that matters: every finite dispersion is LESS surprised than the Poisson.
  const nearly = eta(20, mu, 1e6);
  assert.ok(Math.abs(nearly - eta(20, mu, Number.POSITIVE_INFINITY)) < 1e-3);
  assert.ok(eta(20, mu, 1) < eta(20, mu, Number.POSITIVE_INFINITY));
});

test('Poisson would manufacture certainty at a low baseline, and the negative binomial does not', () => {
  // The measured failure this distribution choice is a repair of, as arithmetic.
  // A count of 12 against an expectation of 2:
  const poisson = eta(12, 2, Number.POSITIVE_INFINITY);
  const negativeBinomial = eta(12, 2, 1);

  assert.ok(poisson > P.detect.etaSelfBar, `Poisson says ${poisson}, comfortably over the bar`);
  assert.ok(
    negativeBinomial < P.detect.etaSelfBar,
    `the negative binomial says ${negativeBinomial}, under it`,
  );
  // Low-baseline accounts are the ones an adversary can create for free, so the gap
  // between these two numbers is the size of the false-positive generator avoided.
  assert.ok(poisson - negativeBinomial > 1);
});

test('an absent baseline throws rather than becoming an expectation of zero', () => {
  // expectation = 0 makes every count infinitely surprising, so an item with no
  // history would alert on its first reading for ever. The caller abstains instead,
  // and reaching this function without having done so is a bug in the caller.
  assert.throws(() => eta(5, 0, 1), RangeError);
  assert.throws(() => eta(5, -1, 1), RangeError);
  assert.throws(() => eta(5, 1, 0), RangeError);
});

/* ── the baselines ────────────────────────────────────────────────────── */

test('a fit over nothing is unusable, and is never an expectation of zero in disguise', () => {
  const empty = selfBaseline([], 'reproduction', P.detect);
  assert.equal(empty.reads, 0);
  assert.ok(empty.reads < P.detect.minBaselineReads, 'the caller must be able to see it is unusable');

  const noCohort = populationBaseline([], NOW, 'reproduction', P.detect);
  assert.equal(noCohort.reads, 0);

  // And the stage abstains on both rather than calling eta with a zero expectation.
  const d = detect(input({ self: empty, population: noCohort }), P, CTX);
  assert.equal(d.verdict, 'abstain');
});

test('the self fit is truncated to the policy window, not to whatever the caller passed', () => {
  // Twenty readings offered, the last twelve kept. Two callers handing in different
  // amounts of history must not produce different baselines from the same account.
  const rates = Array.from({ length: 20 }, (_, i) => i + 1);
  const fit = selfBaseline(rates, 'reproduction', P.detect);
  assert.equal(fit.reads, P.detect.selfBaselineReads);

  // The mean of the last twelve (9..20), times the window.
  const expected = ((9 + 20) / 2) * P.detect.countWindowMin;
  assert.ok(Math.abs(fit.expectation - expected) < 1e-9);

  // Handing in only the trailing twelve gives the identical fit.
  const same = selfBaseline(rates.slice(-P.detect.selfBaselineReads), 'reproduction', P.detect);
  assert.equal(same.expectation, fit.expectation);
});

test('the self fit takes its dispersion from the kind, which is what the kind is for', () => {
  const rates = [1, 1, 1];
  const reach = selfBaseline(rates, 'reach', P.detect);
  const approval = selfBaseline(rates, 'approval', P.detect);

  assert.equal(reach.dispersion, P.detect.dispersionByKind.reach);
  assert.equal(approval.dispersion, P.detect.dispersionByKind.approval);
  // Cascades are more overdispersed than one-tap acts, so reach is the smaller r.
  assert.ok(reach.dispersion < approval.dispersion);
});

test('a cohort may argue for more spread than the prior, never for less', () => {
  const kind: CounterKind = 'reproduction';
  const prior = P.detect.dispersionByKind[kind];

  // A wildly overdispersed cohort: mostly nothing, one enormous member.
  const spread = populationBaseline([0, 0, 0, 0, 100], NOW, kind, P.detect);
  assert.ok(spread.dispersion < prior, 'the sample may make us less certain');

  // A perfectly uniform cohort is UNDERdispersed and must buy nothing. Acting on it
  // would turn a quiet cohort into a hair trigger.
  const uniform = populationBaseline([5, 5, 5, 5, 5], NOW, kind, P.detect);
  assert.equal(uniform.dispersion, prior);

  // And the floor holds under any sample.
  assert.ok(spread.dispersion >= P.detect.dispersionFloor);
});

test('the cohort fit records the hour it was fitted for', () => {
  // A count remarkable at 04:00 is ordinary at 20:00, so a baseline compared against
  // the wrong hour is wrong in a way nothing downstream can detect. The hour rides on
  // the fit and into the vector, which is what makes that mistake findable later.
  const at = NOW;
  const fit = populationBaseline([1, 2, 3], at, 'reproduction', P.detect);
  assert.notEqual(fit.hourOfDay, null);
  assert.ok((fit.hourOfDay ?? -1) >= 0 && (fit.hourOfDay ?? 99) < 24);

  const twelveHoursLater = populationBaseline([1, 2, 3], at + 12 * 60 * MINUTE, 'reproduction', P.detect);
  assert.notEqual(fit.hourOfDay, twelveHoursLater.hourOfDay);

  // The self fit is not hour-keyed and says so rather than inventing an hour.
  assert.equal(selfBaseline([1, 2], 'reproduction', P.detect).hourOfDay, null);
});

/* ── the floor, per kind ──────────────────────────────────────────────── */

test('the absolute floor is per counter kind: fifty of one is not fifty of another', () => {
  // Fifty arrivals in the window. Over the floor for a conversation, far under it for
  // reach — which is the whole reason the single scalar was replaced. `reach` is
  // autoplay on one source and impressions on another; a shared number was
  // simultaneously unreachable for one kind and free for another.
  const fifty = 50 / WINDOW;

  const asConversation = detect(
    input({ observations: [measured('conversation', fifty)] }),
    P,
    CTX,
  );
  assert.notEqual(asConversation.reason, 'D3_below_absolute_floor');

  const asReach = detect(input({ observations: [measured('reach', fifty)] }), P, CTX);
  assert.equal(asReach.reason, 'D3_below_absolute_floor');
  assert.equal(asReach.verdict, 'drop');
});

test('a measured counter beats a censored more-preferred one', () => {
  // reproduction leads the preference list, but a censored reproduction is not a
  // slower reading, it is no reading. Falling through to a live conversation counter
  // is what stops one silent counter blinding the stage to the others.
  const d = detect(
    input({
      observations: [
        censored('reproduction', 'stale_counter'),
        measured('conversation', 200 / WINDOW),
      ],
    }),
    P,
    CTX,
  );

  assert.equal(d.features.driverRateCensored, 0);
  assert.equal(d.features.absoluteFloor, P.detect.absoluteFloorByKind.conversation);
  assert.notEqual(d.reason, 'D2_rate_censored');
});

/* ── the pass, and the replay ─────────────────────────────────────────── */

test('a genuine burst passes, and the row carries every bar it was judged against', () => {
  const d = detect(
    input({
      observations: [measured('reproduction', 400 / WINDOW)],
      self: baseline(2),
      population: baseline(2),
    }),
    P,
    CTX,
  );

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'D0_burst');

  // The bars are IN the row. Without them the count is a number nobody can audit and
  // gate() has nothing to replay a threshold change against.
  assert.equal(d.features.etaSelfBar, P.detect.etaSelfBar);
  assert.equal(d.features.etaPopulationBar, P.detect.etaPopulationBar);
  assert.equal(d.features.burstBar, P.detect.burstBar);
  assert.equal(d.features.countWindowMin, P.detect.countWindowMin);
  assert.equal(d.features.absoluteFloor, P.detect.absoluteFloorByKind.reproduction);
});

test('the vector records both the raw self fit and the cohort it was shrunk toward', () => {
  // A brand-new account with the bare minimum of history. Its own fit says one thing;
  // what it was JUDGED against is mostly the cohort, and a row carrying only the second
  // cannot answer "how much of this was the cohort" — the first question anyone asks
  // when a small account fires.
  const f = extract(
    input({ self: baseline(1, { reads: 2 }), population: baseline(9) }),
    P,
    CTX,
  );

  assert.equal(f.selfExpectationRaw, 1);
  assert.equal(f.selfReads, 2);
  const w = 2 / (2 + P.detect.baselineShrinkage);
  assert.ok(Math.abs((f.shrinkageWeight ?? 0) - w) < 1e-12);
  assert.ok(Math.abs((f.selfExpectation ?? 0) - (w * 1 + (1 - w) * 9)) < 1e-12);

  // The shrink is toward the cohort, so a two-reading account is judged mostly by its
  // cohort — which is both the cold-start repair and the bound on how far an adversary
  // who depresses their own history can move the number they control.
  assert.ok((f.selfExpectation ?? 0) > 6);
});

test('gate() and detect() agree on every fixture, so a threshold is replayable', () => {
  const cases: Array<[string, DetectInput]> = [
    ['nothing read', input({ observations: [] })],
    ['first reading', input({ observations: [censored('reproduction', 'no_prior')] })],
    ['censored', input({ observations: [censored('reproduction', 'below_step')] })],
    ['under the floor', input({ observations: [measured('reproduction', 5 / WINDOW)] })],
    ['no cohort', input({ population: null })],
    ['thin cohort', input({ population: baseline(1, { reads: 0 }) })],
    ['thin self', input({ self: baseline(1, { reads: 0 }) })],
    ['no averages', input({ fast: null, slow: null })],
    ['quiet', input({ self: baseline(1000), population: baseline(1000) })],
    [
      'bursting',
      input({
        observations: [measured('reproduction', 400 / WINDOW)],
        self: baseline(2),
        population: baseline(2),
      }),
    ],
  ];

  for (const [name, i] of cases) {
    const d = detect(i, P, CTX);
    const blocked = gate(d.features, P);

    if (blocked === null) {
      assert.equal(d.verdict, 'pass', name);
      assert.equal(d.reason, 'D0_burst', name);
    } else {
      assert.equal(d.reason, blocked, name);
      assert.equal(d.verdict, verdictFor(blocked), name);
    }
  }
});

test('gate() resolves the floor from the logged counter kind, so a floor change replays', () => {
  const d = detect(input({ observations: [measured('reproduction', 30 / WINDOW)] }), P, CTX);
  // Thirty reproductions clears the shipped floor of twenty-five.
  assert.notEqual(gate(d.features, P), 'D3_below_absolute_floor');

  // Replay the SAME row under a policy whose floor moved. The row still carries the
  // count and the kind, so the new floor is applied to it — which is the only reason
  // gate() reads the kind rather than the logged bar.
  const stricter: Policy = {
    ...P,
    detect: {
      ...P.detect,
      absoluteFloorByKind: { ...P.detect.absoluteFloorByKind, reproduction: 100 },
    },
  };
  assert.equal(gate(d.features, stricter), 'D3_below_absolute_floor');
});

test('a burst leg that never arrived abstains; it is not a quiet item', () => {
  // A measured rate over the floor, both baselines usable, and no averages. That is a
  // required input that did not arrive, which is S1 and an abstain — not D5, which
  // would be a claim that fast and slow agreed.
  const d = detect(
    input({
      observations: [measured('reproduction', 400 / WINDOW)],
      self: baseline(2),
      population: baseline(2),
      fast: null,
      slow: null,
    }),
    P,
    CTX,
  );

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'S1_input_incomplete');
  assert.notEqual(d.reason, 'D5_no_acceleration');
});

test('featureAsOf never postdates the decision, whatever the readings claim', () => {
  // decide() throws on lookahead, so this is really a test that the stage takes its
  // featureAsOf from the inputs rather than from the clock.
  const d = detect(input({ observations: [measured('reproduction', 50, 3)] }), P, CTX);
  assert.ok(d.featureAsOf <= d.decidedAt);
  assert.equal(d.decidedAt, NOW);
  assert.equal(d.subjectKind, 'item');
});

/* ── the empty fit, which is the one baseline this stage will actually meet ──── */

/**
 * ★ THE FIXTURES ABOVE BUILD A `reads: 0` BASELINE BY HAND AND `selfBaseline` DOES NOT
 * BUILD THE SAME OBJECT, which is why the two tests below exist and why the ones above
 * did not catch what they missed.
 *
 * `baseline(1, { reads: 0 })` carries a real expectation and a real dispersion with a
 * read count of zero — an object nothing in this package produces. What `selfBaseline`
 * actually returns for an account with no history is `unfitted()`: expectation 0,
 * dispersion 0, reads 0. A dispersion of zero is the one input `eta` throws on, and a
 * throw inside `extract` means `commitDecision` writes NO ROW — the honest abstain two
 * rungs down is pre-empted by an exception, on precisely the population this file's
 * header is about.
 *
 * So these two go through the fitting functions rather than the fixture, because the
 * fixture is the thing that was wrong.
 */

test('an account with no history at all abstains — it does not take the row down with it', () => {
  const i = input({
    observations: [measured('reproduction', 50)],
    // The real empty fit, not the fixture's hand-built one.
    self: selfBaseline([], 'reproduction', P.detect),
    population: populationBaseline([2, 3, 4, 5], NOW, 'reproduction', P.detect),
  });

  // 1. It decides. Before this, `eta` threw on the zero dispersion and nothing was
  //    written — which is worse than a wrong row, because a wrong row is findable.
  const d = detect(i, P, CTX);
  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'D1_insufficient_history');

  // 2. And the vector says the fit found nothing rather than claiming it found zero.
  //    `selfReads: 0` is the fact; an expectation of 0 would be the claim that this
  //    account normally gets nothing, which we have not looked hard enough to make.
  assert.equal(d.features.selfReads, 0);
  assert.equal(d.features.selfExpectationRaw, null);
  assert.equal(d.features.selfDispersion, null);
  assert.equal(d.features.etaSelf, null);
  assert.equal(d.features.shrinkageWeight, null);

  // 3. The gate agrees, so the row replays to the same answer.
  assert.equal(gate(d.features, P), 'D1_insufficient_history');
});

test('an empty cohort abstains as D4, and still records which hour it looked at', () => {
  const i = input({
    observations: [measured('reproduction', 50)],
    self: selfBaseline([1, 1, 1], 'reproduction', P.detect),
    population: populationBaseline([], NOW, 'reproduction', P.detect),
  });

  const d = detect(i, P, CTX);
  // D4, not D5: a gap in OUR coverage is not a claim that the world went quiet.
  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'D4_baseline_unavailable');
  assert.notEqual(d.reason, 'D5_no_acceleration');

  // A cohort expectation of zero makes every count infinitely surprising, which is
  // exactly what poisson.ts throws to prevent. Null is the honest reading of it.
  assert.equal(d.features.populationReads, 0);
  assert.equal(d.features.populationExpectation, null);
  assert.equal(d.features.populationDispersion, null);
  assert.equal(d.features.etaPopulation, null);

  // ★ But the HOUR survives. `populationBaseline` names the bucket before it discovers
  // the cohort is empty, and a baseline compared against the wrong hour is wrong in a
  // way nothing downstream can detect — so which hour we looked at is worth keeping
  // even when there was nothing in it.
  assert.notEqual(d.features.populationHourOfDay, null);
});
