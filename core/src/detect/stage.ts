/**
 * DETECT — is this accelerating relative to its own baseline?
 *
 * This stage costs nothing and produces the earliest alert the system can make: it
 * reads only numbers we already paid for. Which is why its rules are the ones most
 * worth getting right, and why every one of them is a ratio rather than a level.
 *
 * Three things it must do, all of them repairs of measured failures:
 *   - Never fire on a self-baseline alone. The account's own history is under an
 *     adversary's control; the relative test lives INSIDE a hard absolute floor.
 *   - Never treat a censored reading as a zero. It arrives as a Rate, so the
 *     compiler enforces this — D2_rate_censored is the honest answer, and it is a
 *     different row from D5_no_acceleration.
 *   - Use the continuous-time averages, not the discrete recurrence, because the
 *     read grid is irregular by design.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THE LADDER, AND WHY IT IS IN THIS ORDER. Each rung is a different reason, and
 * three of the six are abstains — this stage has more ways to say "we do not know"
 * than to say "no", which is correct for the only stage that sees an item before
 * anyone has reacted to it.
 *
 *   1. WHICH COUNTER DRIVES IT       none read      → D1  abstain
 *                                    read, censored → D1 / D2  abstain
 *   2. THE ABSOLUTE FLOOR            under          → D3  drop
 *   3. THE COHORT BASELINE           missing        → D4  abstain
 *   4. THE SELF BASELINE             too thin       → D1  abstain
 *   5. THE BURST LEGS                missing        → S1  abstain
 *   6. BOTH ETAS AND THE BURST       under any bar  → D5  drop
 *                                    over all three → D0  PASS
 *
 * The floor is rung 2 and not rung 5 because it is the one an adversary cannot open.
 * Every rung below it consults a number somebody could have manufactured — a
 * depressed self baseline, a cohort chosen to be quiet — and the floor is checked
 * before any of them are read, so no amount of baseline manipulation reaches it.
 * "The relative test lives INSIDE a hard absolute floor" is that ordering, and it is
 * the only property of this file that a reordering would silently destroy.
 *
 * ★ D3 AND D4 ARE THE TWO ROWS THE PREVIOUS BUILD DID NOT HAVE, and they are opposite
 * kinds of answer. D3 is "we looked and said no" — a drop. D4 is "we have no cohort
 * for this source and hour" — an abstain, because AN OUTAGE IS NOT A CLAIM. Emitting
 * D5_no_acceleration when the population baseline is simply missing would convert a
 * gap in our own coverage into a claim about the world, and it would do it silently,
 * on the sources we have covered worst.
 *
 * ★ D1 AND D2 SPLIT ON THE CENSOR REASON, WHICH IS FINER THAN THE CODES SUGGEST.
 * `no_prior` and `no_elapsed` mean we have not read enough yet — that is literally
 * "fewer readings than a difference requires", which is D1. Everything else
 * (`below_step`, `stale_counter`, `non_monotonic`, `unusable_fidelity`) means we read
 * and the source published nothing usable, which is D2. Both abstain, and they are
 * separate rows because one of them drains as the schedule runs and the other one
 * does not — a D2 rate that climbs is a source degrading, and a D1 rate that climbs
 * is TRACK falling behind. Merging them would hide both.
 *
 * Every number is in Policy. There are no numeric literals in this file beyond the
 * 0/1 encoding of a boolean feature.
 */

import type { Decision, StageContext } from '@insidor/contracts/decision.ts';
import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { ReasonCode } from '@insidor/contracts/reasons.ts';
import type {
  CensorReason,
  CounterKind,
  Item,
  Millis,
  Observation,
  Rate,
} from '@insidor/contracts/vocabulary.ts';
import { COUNTER_KINDS } from '@insidor/contracts/vocabulary.ts';

import { decide as makeDecision } from '../decide.ts';
import type { Ewma } from '../kinetics/ewma.ts';
import { MS_PER_MINUTE, safeRatio } from '../math.ts';
import type { Baseline } from './baseline.ts';
import { burst } from './burst.ts';
import { eta } from './poisson.ts';

/**
 * The stage's identity, copied onto every row it writes. See `admit/stage.ts` for the
 * full argument: `DECIDER` moves when the rule changes, `FEATURE_SET` moves when the
 * vector's shape changes, and nothing else in the row can tell either apart.
 *
 * `item.detect.v1` is shared with nothing. It is tempting to reuse `item.admit.v1`
 * because both are keyed on an item — do not. The two vectors are built from different
 * inputs at different instants, and one name over two shapes is the single most
 * expensive silent bug a training pipeline has.
 */
export const NAME = 'detect' as const;
export const FEATURE_SET: FeatureSetId = 'item.detect.v1';
export const DECIDER = 'rule:detect@1';

const PRESENT = 1;
const ABSENT = 0;

/**
 * Everything this stage may see. Every read has already happened; nothing is fetched.
 *
 * ★ ALL FOUR STATISTICAL INPUTS ARE NULLABLE AND THAT IS THE DEGRADATION PATH, not a
 * convenience. A missing EWMA means we have not seen enough of this item yet; a missing
 * baseline means this item or its cohort has too little history to be compared against.
 * Both are ordinary, both are frequent on exactly the young items this product is about,
 * and both must produce a NAMED abstention rather than a comparison against a fabricated
 * expectation. Default any of them to zero and every brand-new item becomes infinitely
 * atypical — the loudest possible false positive, arriving in bulk.
 */
export interface DetectInput {
  readonly item: Item;
  /** Newest last. Each carries its own Rate, censored or measured. */
  readonly observations: readonly Observation[];
  readonly fast: Ewma | null;
  readonly slow: Ewma | null;
  readonly self: Baseline | null;
  readonly population: Baseline | null;
  readonly costUsd: number;
}

/* ── which counter drives the statistic ───────────────────────────────── */

/**
 * The newest reading of each preferred counter, in preference order.
 *
 * The preference list leads with `reproduction` because vocabulary.ts calls it "the
 * thesis, as a type" — a copy that creates a new authored object. A source that
 * cannot count reproductions falls through to the next kind rather than being scored
 * as though nobody reproduced anything, which is the same absence-is-not-zero rule
 * ADMIT applies to `reproductionLevel`.
 */
interface Driver {
  readonly kind: CounterKind;
  readonly rate: Rate;
}

function selectDriver(input: DetectInput, p: Policy): Driver | null {
  let censoredFallback: Driver | null = null;

  for (const kind of p.detect.preferredCounters) {
    let newest: Observation | null = null;
    for (const o of input.observations) {
      if (o.kind !== kind) continue;
      if (newest === null || o.capturedAt >= newest.capturedAt) newest = o;
    }
    if (newest === null) continue;

    // A measured rate on a less-preferred counter beats a censored one on a more
    // preferred counter: the second is not a slower reading, it is no reading, and
    // preferring it would let one silent counter blind the stage to five live ones.
    if (newest.rate.kind === 'measured') return { kind, rate: newest.rate };
    censoredFallback ??= { kind, rate: newest.rate };
  }

  // Every preferred counter we could read was censored. That is the honest answer and
  // it is a different row from "nothing was read at all", which returns null.
  return censoredFallback;
}

/** `no_prior` and `no_elapsed` are history problems; the rest are the source's silence. */
function censorIsHistory(reason: CensorReason): boolean {
  return reason === 'no_prior' || reason === 'no_elapsed';
}

/* ── features ─────────────────────────────────────────────────────────── */

/**
 * The detect vector: the driving counter, the count, and every bar it was judged
 * against.
 *
 * ★ IT TAKES A POLICY, AND THE STUB'S SIGNATURE DID NOT. That is the one deliberate
 * departure in this file and it is the same argument group/stage.ts makes for its own
 * extract: an item's features ARE its bars. Whether a count cleared the floor is
 * `driverCount >= absoluteFloorByKind[kind]`, and a vector that records the count
 * without the floor is a vector nobody can audit and `gate()` cannot replay. ADMIT
 * gets away without a Policy because its one bar, `admissionBar`, arrives on the
 * INPUT — it is a quantile recomputed nightly, not a policy constant. Every bar here
 * is a policy constant, so the policy has to come in.
 *
 * ★ THE ONE ABSOLUTE NUMBER IN THE VECTOR IS `driverCount`, AND IT IS DELIBERATE.
 * Everything else is a ratio to an expectation or to a bar. The count is here because
 * the absolute floor is here, and the floor is the one gate an adversary cannot open —
 * so it has to be replayable, and replaying it needs the count and the bar as separate
 * numbers. Logging only the ratio `absoluteFloorRatio` would make the CURRENT floor
 * replayable and every other floor unreplayable, which is the opposite of what a
 * replay is for. The ratio is logged too, because it is the readable form.
 */
export function extract(input: DetectInput, p: Policy, ctx: StageContext): FeatureVector {
  const driver = selectDriver(input, p);
  const measured = driver !== null && driver.rate.kind === 'measured' ? driver.rate : null;

  const window = p.detect.countWindowMin;
  const count = measured === null ? null : measured.perMin * window;
  const floor = driver === null ? null : p.detect.absoluteFloorByKind[driver.kind];

  const self = input.self;
  const population = input.population;
  const selfUsable = self !== null && self.reads >= p.detect.minBaselineReads;
  const populationUsable = population !== null && population.reads >= p.detect.minBaselineReads;

  /*
   * ★ A FIT OVER NOTHING IS NOT A BASELINE, AND UNTIL THIS LINE EXISTED IT WAS READ AS
   * ONE. `Baseline.expectation` and `.dispersion` are plain numbers with no null to
   * return, so `selfBaseline([])` reports the empty fit as `{expectation: 0,
   * dispersion: 0, reads: 0}` — and baseline.ts's own header says what that means:
   * "A fit over nothing returns `reads: 0` and an expectation of zero, and the CALLER
   * abstains on it." `reads` is the authority on whether anything was fitted; the two
   * numbers beside it are placeholders, and this file was using them as measurements.
   *
   * Two separate failures came out of that, and the first one cost the row:
   *
   *   · `eta` REFUSES a non-positive dispersion, on purpose, because a caller that
   *     reaches it has not abstained when it should have. The refusal is a throw, the
   *     throw escapes `extract` and therefore `detect`, and `commitDecision` writes
   *     nothing when the decider throws — "an exception is not a judgement". So a
   *     brand-new account with a usable cohort produced NO DECISION ROW AT ALL, where
   *     the ladder two screens down would have produced `D1_insufficient_history`.
   *     An absence pre-empted by an exception is worse than an absence scored as zero:
   *     the second is a wrong row and the first is no row, on exactly the population
   *     this whole file is about — the accounts an adversary can create for free.
   *
   *   · An expectation of zero is a CLAIM — "this account normally gets nothing" — and
   *     logging it as `selfExpectationRaw: 0` beside a dispersion of `0` is the
   *     absence-as-zero this repository forbids everywhere else. `selfReads: 0` is the
   *     honest fact and it is still logged from the raw input below, because "we fitted
   *     and found nothing" and "no fit was handed in" are different rows.
   *
   * So the expectation, the dispersion, the shrink and both etas read the FITTED view,
   * and everything that is a fact about the fit itself — the read count, the hour
   * bucket, whether it was usable — reads the raw one.
   */
  const selfFit = fitted(self);
  const populationFit = fitted(population);

  // The shrink toward the cohort. It is applied here rather than inside the fit
  // because the weight is policy, and it is applied at all because a self baseline
  // over two readings is mostly noise — and because it caps how far an adversary who
  // depresses their own history can move the number they do control.
  const shrinkage =
    selfFit === null ? null : selfFit.reads / (selfFit.reads + p.detect.baselineShrinkage);
  const selfExpectation =
    selfFit !== null && populationFit !== null && shrinkage !== null && populationUsable
      ? shrinkage * selfFit.expectation + (1 - shrinkage) * populationFit.expectation
      : (selfFit?.expectation ?? null);

  const burstRatio = burst(input.fast, input.slow, ctx.now, p.kinetics);

  const etaSelf =
    count === null || selfExpectation === null || !(selfExpectation > 0) || selfFit === null
      ? null
      : eta(count, selfExpectation, selfFit.dispersion);
  const etaPopulation =
    count === null || populationFit === null || !(populationFit.expectation > 0)
      ? null
      : eta(count, populationFit.expectation, populationFit.dispersion);

  const origin = input.item.postedAt ?? input.item.firstSeenAt;

  return {
    ageMin: (ctx.now - origin) / MS_PER_MINUTE,
    observationCount: input.observations.length,

    /* Which counter drove it, as an index into COUNTER_KINDS — the CLOSED vocabulary,
       not into `preferredCounters`. The vocabulary's order is stable forever;
       `preferredCounters` is a policy field somebody may reorder, and an index into a
       reorderable list is a feature whose meaning changes under replay. */
    driverCounterIndex: driver === null ? null : COUNTER_KINDS.indexOf(driver.kind),
    // null — not 0 — when nothing was read: "no counter was censored" and "no counter
    // was read" are different facts and one of them is not about censoring at all.
    driverRateCensored: driver === null ? null : measured === null ? PRESENT : ABSENT,
    driverCensorIsHistory:
      driver === null || driver.rate.kind !== 'censored'
        ? null
        : censorIsHistory(driver.rate.reason)
          ? PRESENT
          : ABSENT,
    driverRatePerMin: measured?.perMin ?? null,

    countWindowMin: window,
    driverCount: count,
    absoluteFloor: floor,
    absoluteFloorRatio: count === null || floor === null ? null : safeRatio(count, floor),

    burstRatio,
    burstBar: p.detect.burstBar,

    selfReads: self?.reads ?? null,
    selfUsable: self === null ? null : selfUsable ? PRESENT : ABSENT,
    /* Both the raw fit and the shrunk expectation are logged. The raw one is what the
       account's own history said; the shrunk one is what it was judged against. A row
       carrying only the second cannot answer "how much of this was the cohort", which
       is the first question anyone asks when a small account fires. */
    /* Null — never 0 — when nothing was fitted, and `selfReads: 0` above is the row
       that says why. An expectation of zero is a claim that this account normally gets
       nothing, and `unfitted()` has not looked. */
    selfExpectationRaw: selfFit?.expectation ?? null,
    selfExpectation,
    selfDispersion: selfFit?.dispersion ?? null,
    shrinkageWeight: shrinkage,

    populationReads: population?.reads ?? null,
    populationUsable: population === null ? null : populationUsable ? PRESENT : ABSENT,
    /* Same rule as the self fit, and it matters more here: a cohort expectation of
       zero fed to `eta` makes EVERY count infinitely surprising, which is the exact
       failure detect/poisson.ts throws to prevent. Null is the honest reading of an
       empty cohort, and `populationReads: 0` beside it is the reason. */
    populationExpectation: populationFit?.expectation ?? null,
    populationDispersion: populationFit?.dispersion ?? null,
    /* From the RAW fit: `populationBaseline` names the hour bucket before it discovers
       the cohort is empty, so "which hour we looked at" survives even when there was
       nothing in it — and a baseline compared against the wrong hour is wrong in a way
       nothing downstream can detect. */
    populationHourOfDay: population?.hourOfDay ?? null,

    etaSelf,
    etaSelfBar: p.detect.etaSelfBar,
    etaPopulation,
    etaPopulationBar: p.detect.etaPopulationBar,

    /* The readable relative forms. Neither is gated on — the etas are — but "six times
       its own baseline" is the sentence a person can check, and −log10 of a tail is
       not. They cost two keys and they are what makes a row explicable. */
    selfExpectationRatio:
      count === null || selfExpectation === null ? null : safeRatio(count, selfExpectation),
    populationExpectationRatio:
      count === null || populationFit === null ? null : safeRatio(count, populationFit.expectation),
  };
}

/**
 * The fit, or null when it did not fit anything.
 *
 * `reads` is the authority: `unfitted()` is the only `Baseline` with none, and it is
 * the only one whose `expectation` and `dispersion` are placeholders rather than
 * measurements. The dispersion is tested as well as the read count because it is the
 * one that throws — a `Baseline` assembled by hand rather than by `selfBaseline` can
 * carry readings and no spread, and `eta` refuses that too. Refusing it here costs an
 * abstain; reaching `eta` with it costs the whole row.
 */
function fitted(b: Baseline | null): Baseline | null {
  return b !== null && b.reads > 0 && b.dispersion > 0 ? b : null;
}

/* ── the ladder, as a pure function of the logged vector ──────────────── */

/**
 * Every DETECT threshold, applied to nothing but what the decision row carries.
 *
 * WHY IT EXISTS SEPARATELY FROM `detect()`: eval/src/replay/core-stages.ts replays a
 * stage through `gate(features, policy)` and nothing else, because the log holds the
 * vector and not the stage input — there is no way to reconstruct an observation
 * series and two baseline fits from six months ago. Without this function every
 * threshold in this stage is untestable against history, which would make
 * `etaSelfBar` a number nobody can ever move safely.
 *
 * ★ IT RESOLVES THE FLOOR FROM THE LOGGED COUNTER INDEX RATHER THAN FROM THE LOGGED
 * FLOOR, which is what makes a floor CHANGE replayable and not merely a floor. The
 * logged `absoluteFloor` is the fallback for a row whose counter index does not exist
 * under the policy being replayed — a state that can only arise if the vocabulary
 * itself changed, in which case the row is from a different world and saying so is
 * better than pretending.
 *
 * The order is `detect()`'s and has to stay that way; the tests assert the two agree
 * on every fixture rather than trusting that they do.
 */
export function gate(f: FeatureVector, p: Policy): ReasonCode | null {
  const driverIndex = f.driverCounterIndex ?? null;
  if (driverIndex === null) return 'D1_insufficient_history';

  if (f.driverRateCensored === PRESENT) {
    return f.driverCensorIsHistory === PRESENT ? 'D1_insufficient_history' : 'D2_rate_censored';
  }

  const count = f.driverCount ?? null;
  if (count === null) return 'D1_insufficient_history';

  const kind = COUNTER_KINDS[driverIndex];
  const floor = kind === undefined ? (f.absoluteFloor ?? null) : p.detect.absoluteFloorByKind[kind];
  if (floor === null) return 'S1_input_incomplete';
  if (count < floor) return 'D3_below_absolute_floor';

  // The cohort is checked before the self fit because an absent cohort is an absent
  // input and an absent self fit is a fact about this subject. Both abstain; they are
  // separate rows because only one of them is our own coverage failing.
  if (f.populationUsable !== PRESENT) return 'D4_baseline_unavailable';
  if (f.selfUsable !== PRESENT) return 'D1_insufficient_history';

  const burstRatio = f.burstRatio ?? null;
  const etaSelf = f.etaSelf ?? null;
  const etaPopulation = f.etaPopulation ?? null;
  // A missing average or a missing eta with a measured count is a required input that
  // did not arrive, not a quiet item. S1 rather than D5, and abstain rather than drop.
  if (burstRatio === null || etaSelf === null || etaPopulation === null) {
    return 'S1_input_incomplete';
  }

  if (
    etaSelf < p.detect.etaSelfBar ||
    etaPopulation < p.detect.etaPopulationBar ||
    burstRatio < p.detect.burstBar
  ) {
    return 'D5_no_acceleration';
  }

  return null;
}

/** D3 and D5 are "we looked and said no". Everything else here is "we never asked". */
export function verdictFor(reason: ReasonCode): 'drop' | 'abstain' {
  return reason === 'D3_below_absolute_floor' || reason === 'D5_no_acceleration'
    ? 'drop'
    : 'abstain';
}

/* ── the decision ─────────────────────────────────────────────────────── */

export function detect(input: DetectInput, p: Policy, ctx: StageContext): Decision {
  const f = extract(input, p, ctx);
  const { item } = input;

  const base = {
    stage: NAME,
    subjectKind: 'item' as const,
    subjectId: item.itemId,
    featureAsOf: newestInput(input),
    subjectOrigin: item.postedAt,
    features: f,
    featureSet: FEATURE_SET,
    costUsd: input.costUsd,
  };

  /*
   * A model, if one is loaded, arrives as a pure sync closure on the Policy. core
   * NEVER imports ml/. This is the "a rule today, a model tomorrow" slot.
   *
   * ★ IT SCORES AND IT DOES NOT GATE. The gates above run first and the score cannot
   * override them, which matters more here than anywhere else: the absolute floor is
   * the one rung an adversary cannot open, and a model that could pass an item under
   * it would be a model that had learned to open it.
   */
  const scorer = p.scorers.detect;
  const decider = scorer ? scorer.id : DECIDER;

  const blocked = gate(f, p);
  if (blocked !== null) {
    return makeDecision(
      { ...base, verdict: verdictFor(blocked), reason: blocked, score: null, decider: DECIDER },
      ctx,
    );
  }

  return makeDecision(
    {
      ...base,
      verdict: 'pass',
      reason: 'D0_burst',
      score: scorer ? scorer.score(f) : null,
      decider,
    },
    ctx,
  );
}

/**
 * The newest input datum this decision was allowed to see: our first sight of the
 * item, or the newest reading if one is fresher. Never the clock — `decide()` supplies
 * that from ctx, and a featureAsOf taken from a fresher read than the features is the
 * lookahead the store rejects as a CHECK constraint.
 */
function newestInput(input: DetectInput): Millis {
  let newest = input.item.firstSeenAt;
  for (const o of input.observations) {
    if (o.capturedAt > newest) newest = o.capturedAt;
  }
  return newest;
}
