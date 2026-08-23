/**
 * ★ THE ONLY PLACE AN OUTCOME IS DECIDED. Pure: no clock, no database, no vendor.
 *
 * WHAT IT IS RESPONSIBLE FOR: turning a subject's window and whatever evidence we hold
 * over that window into exactly one of four typed states — and refusing, structurally,
 * to express the fifth thing everybody reaches for, which is a number standing in for an
 * answer we do not have.
 *
 * WHY IT IS SEPARATE FROM `db.ts` AND `main.ts`. Because the three failures this file
 * exists to prevent are all failures of REASONING, not of plumbing, and reasoning that
 * lives next to a connection pool is reasoning nobody can test at the boundaries. Every
 * branch below is reachable from `outcome.test.ts` with a literal, in milliseconds, with
 * no database at all. The classifications that matter — a window that has not closed, a
 * window we did not watch, a subject that no longer exists — are exactly the ones that
 * are hardest to produce against live data and easiest to get wrong.
 *
 * ★ THE THREE DISTINCTIONS THE WHOLE FILE IS ARRANGED AROUND. Each one is a pair of
 * states that look identical if you only look at the number:
 *
 *   1. NOT FINISHED vs NOTHING HAPPENED.  A window that is still open has no outcome.
 *      Not a small one — none. With a median six days to peak, the open population is
 *      larger than the closed one for months, so writing those rows as negatives would
 *      not be a rounding error, it would be the dataset. `pending` is a state here and
 *      deliberately produces NO ROW (see `main.ts` for why the row is withheld rather
 *      than written empty).
 *
 *   2. NOTHING HAPPENED vs WE WERE NOT LOOKING.  A negative is a real claim with two
 *      halves — nothing happened AND we watched the whole window. If the second half is
 *      untrue the measurement is a LOWER BOUND on one we may have missed, which is a
 *      censored observation, and recording it as a completed low outcome is a lie the
 *      model will learn. Both coverage tests run before any measurement is trusted.
 *
 *      ★ AND "WE WERE LOOKING" IS ITSELF TWO CLAIMS ABOUT TWO DIFFERENT PIPELINES.
 *      The coverage log belongs to the ASSET STREAM: it says we saw the mints. Nothing
 *      in it says the resolve stage — the only thing that ever attributes a coin to a
 *      story — was ever run over this subject. A stream we watched and a matcher that
 *      never ran produce the identical empty coin list, and `attributionAsked` is what
 *      keeps the second from being spent as a negative.
 *
 *   3. WE COULD NOT MEASURE vs THERE WAS NOTHING TO MEASURE.  A coin the market
 *      answered about and reported no market for never traded: that is the world, and
 *      it resolves negative. A coin we never asked about produced no readings: that is
 *      our outage, and an outage is not a claim. The two arrive as the same empty list
 *      and are told apart by whether the absences carry a reason.
 *
 * WHAT BREAKS IF THIS IS CHANGED CARELESSLY: reorder the checks and a censored window
 * starts resolving. The order below is load-bearing — coverage is tested BEFORE the
 * "no coin appeared" negative, because that negative is precisely the claim coverage
 * exists to make assertable.
 */

import type { LabelPolicy } from '@insidor/contracts/policy.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

/** One reading of one asset's price, as `public.market_reading` records it. */
export interface PriceObservation {
  readonly atMs: Millis;
  /** The price, or null when the venue answered and there was none. */
  readonly priceUsd: number | null;
  /**
   * Why there is no price. Null exactly when `priceUsd` is a number — the table's own
   * xor constraint, carried through so that "the venue said there is no market" and
   * "nobody filled this in" cannot be confused here either.
   */
  readonly absent: string | null;
}

/** The venue reported no market at all. The one absence that is a fact about the world. */
export const NO_MARKET = 'no_market';

export interface CoinEvidence {
  readonly assetKey: string;
  /** When the asset began. Null when nothing has ever established it. */
  readonly originMs: Millis | null;
  /** Readings inside the window, ascending by `atMs`. */
  readonly observations: readonly PriceObservation[];
}

/* ── the window ───────────────────────────────────────────────────────── */

export interface WindowInput {
  /**
   * The subject's own clock, as the decision log recorded it AT DECISION TIME. Taken
   * from `internal.decisions.subject_origin` and never re-derived from today's tables:
   * a subject whose origin was corrected later would otherwise be graded over a window
   * that did not exist when the decision was made.
   */
  readonly subjectOriginMs: Millis | null;
  /**
   * The earliest known origin among the coins attributed to this subject, or null when
   * none was attributed or none has a known one.
   */
  readonly coinOriginMs: Millis | null;
  /** Why this subject can never be graded, when that is already established. */
  readonly ungradeableReason: string | null;
}

export type LabelWindow =
  | { readonly kind: 'window'; readonly originMs: Millis; readonly resolvesAtMs: Millis }
  | { readonly kind: 'ungradeable'; readonly reason: string };

const MS_PER_DAY = 86_400_000;

/**
 * ★ THE CLOCK THE WINDOW IS MEASURED FROM, and the single most consequential choice in
 * this build.
 *
 * The contract says it is not the decision's clock, and it is not: a decision can be
 * made at any age of its subject, so a window anchored on `decidedAt` would grade two
 * subjects over structurally different amounts of their own life and record nothing
 * saying so. That is the defect in the query this measurement descends from, whose only
 * time bounds were global and relative to whenever it happened to run.
 *
 * So the anchor is the thing being measured:
 *
 *   · A COIN'S OWN ORIGIN when one was attributed to the subject. The outcome is a fact
 *     about that coin, and the architecture's committed window is [origin, origin + W].
 *     The earliest of them when several were attributed, because the window has to
 *     contain all of them to compare them.
 *   · THE SUBJECT'S OWN ORIGIN when none was. "No coin came out of this narrative in W
 *     days" is a claim about the narrative, so it is counted from when the narrative
 *     began — and it has to be expressible, because it is the negative, and a training
 *     set with no negatives is not a training set.
 *
 * ★ AND THE CONSEQUENCE, WHICH MUST NOT BE DISCOVERED LATER. `internal.train_admit_v1`
 * filters `l.origin_ts >= d.decided_at` — the anti-circularity clause, which exists so
 * that a decision made about a coin that already existed cannot be graded by that coin's
 * own outcome. Under the rule above, a positive carries a coin's origin and passes that
 * clause exactly when the coin post-dates the decision, which is correct and is the
 * whole point of the clause. A NEGATIVE carries the subject's origin, which always
 * precedes the decision, so it never passes. The view as written therefore admits
 * positives only. That is a defect in the view, not in the labels, and the fix belongs
 * where the view is defined — not here, by anchoring negatives on a clock that would
 * make them meaningless in order to slip past a filter.
 */
export function labelWindow(input: WindowInput, p: LabelPolicy): LabelWindow {
  if (input.ungradeableReason !== null) {
    return { kind: 'ungradeable', reason: input.ungradeableReason };
  }
  const originMs = input.coinOriginMs ?? input.subjectOriginMs;
  if (originMs === null) {
    /* Not censored and not negative. A subject with no clock has no window, so there is
       no interval over which anything could have happened or failed to — which is the
       schema's own example of `unresolvable`. */
    return { kind: 'ungradeable', reason: 'no_origin_recorded' };
  }
  return { kind: 'window', originMs, resolvesAtMs: originMs + p.windowDays * MS_PER_DAY };
}

/* ── the measurement ──────────────────────────────────────────────────── */

export interface PeakMeasurement {
  /** The first observed price at or after the window opened. The denominator. */
  readonly first: number | null;
  /** The largest observed price inside the window. The numerator. */
  readonly peak: number | null;
  /** How many readings sit within `peakSupportFraction` of the peak. */
  readonly support: number;
  /** peak / first, or null when either end is missing. */
  readonly multiple: number | null;
  /** Every reading in the window, priced or not, across every attributed coin. */
  readonly observations: number;
  /** Readings that carried a price. */
  readonly priced: number;
  /** True when every unpriced reading says the venue reported no market at all. */
  readonly everyAbsenceIsNoMarket: boolean;
  /** When the first evidence arrived: the first priced reading, else the coin's origin. */
  readonly firstSignalMs: Millis | null;
}

/**
 * The peak multiple of ONE coin over the window.
 *
 * The two non-obvious choices are inherited rather than invented, and both are about
 * refusing to be impressed by a single print:
 *
 *   · The denominator is the FIRST price observed at or after the window opened, not the
 *     smallest one. Taking the minimum would make every coin's multiple a function of
 *     its worst moment, which flatters exactly the coins that dumped hardest.
 *   · The peak is only a peak if `peakSupportFraction` of it was seen more than once.
 *     A maximum standing alone is not thrown away — it is carried out as a lower bound
 *     for the caller to censor on — but it is not a measurement.
 */
function measureCoin(coin: CoinEvidence, p: LabelPolicy): PeakMeasurement {
  let first: number | null = null;
  let peak: number | null = null;
  let priced = 0;
  let everyAbsenceIsNoMarket = true;
  let firstSignalMs: Millis | null = null;

  for (const observation of coin.observations) {
    const price = observation.priceUsd;
    if (price === null) {
      if (observation.absent !== NO_MARKET) everyAbsenceIsNoMarket = false;
      continue;
    }
    priced += 1;
    if (first === null) {
      first = price;
      firstSignalMs = observation.atMs;
    }
    if (peak === null || price > peak) peak = price;
  }

  let support = 0;
  if (peak !== null) {
    const bar = peak * p.peakSupportFraction;
    for (const observation of coin.observations) {
      if (observation.priceUsd !== null && observation.priceUsd >= bar) support += 1;
    }
  }

  /* A denominator of zero is not a denominator. `public.market_reading` forbids a
     negative price and records an absence as an absence, so a stored zero is a venue
     that answered "nothing" — and dividing by it would produce an infinite multiple
     from a coin nobody has ever paid for. */
  const multiple = first === null || first <= 0 || peak === null ? null : peak / first;

  return {
    first,
    peak,
    support,
    multiple,
    observations: coin.observations.length,
    priced,
    everyAbsenceIsNoMarket,
    firstSignalMs: firstSignalMs ?? coin.originMs,
  };
}

/**
 * The subject's measurement: the BEST coin attributed to it.
 *
 * ★ WHY BEST AND NOT FIRST, OR AVERAGE. The claim being graded is "was there something
 * here worth catching", not "was this exact coin the one" — the stage that picks which
 * coin to show is a different decision with its own log. Averaging would let a story
 * that produced one large winner and nine dead copies grade out as a mediocre outcome,
 * which is the opposite of what happened. Taking the first would grade the fastest
 * copycat rather than the coin that ran.
 *
 * The counts are summed across every coin, because they describe our evidence rather
 * than the outcome, and the evidence question — "did we see anything at all" — is about
 * the subject, not about whichever coin won.
 */
export function measurePeak(coins: readonly CoinEvidence[], p: LabelPolicy): PeakMeasurement {
  let observations = 0;
  let priced = 0;
  let everyAbsenceIsNoMarket = true;
  let firstSignalMs: Millis | null = null;
  let best: PeakMeasurement | null = null;

  for (const coin of coins) {
    const measured = measureCoin(coin, p);
    observations += measured.observations;
    priced += measured.priced;
    if (!measured.everyAbsenceIsNoMarket) everyAbsenceIsNoMarket = false;
    if (measured.firstSignalMs !== null) {
      firstSignalMs =
        firstSignalMs === null ? measured.firstSignalMs : Math.min(firstSignalMs, measured.firstSignalMs);
    }
    if (measured.multiple !== null && (best === null || measured.multiple > (best.multiple ?? -1))) {
      best = measured;
    }
  }

  return {
    first: best?.first ?? null,
    peak: best?.peak ?? null,
    support: best?.support ?? 0,
    multiple: best?.multiple ?? null,
    observations,
    priced,
    everyAbsenceIsNoMarket,
    firstSignalMs,
  };
}

/* ── the four states ──────────────────────────────────────────────────── */

export interface CoverageEvidence {
  /**
   * True when the watcher DECLARED darkness over any part of the window. One declared
   * gap is decisive whatever the covered fraction says: it is positive knowledge that
   * we were not looking.
   */
  readonly gapDeclared: boolean;
  /** How much of the window observed coverage rows positively account for. */
  readonly coveredMs: Millis;
}

export type LabelOutcome =
  /** The window has not closed. Not an outcome; see `main.ts` for why no row is written. */
  | { readonly status: 'pending' }
  /** The subject can never be graded. Different from censored and different from bad. */
  | { readonly status: 'unresolvable'; readonly reason: string }
  /**
   * The window closed and we were not watching all of it. `value`, when present, is a
   * LOWER BOUND on a number we may have missed — which is why the schema permits a value
   * on a censored row and forbids a `y` on one.
   */
  | {
      readonly status: 'censored';
      readonly reason: string;
      readonly value: number | null;
      readonly firstSignalMs: Millis | null;
    }
  /**
   * The window closed, we watched all of it, and here is what happened. `value` may
   * still be null — a subject that never produced a coin has no multiple to report, and
   * the verdict `y = false` is the claim, not the number. That null is recoverable by
   * construction: it occurs exactly when nothing was ever attributed to the subject, or
   * when every venue answer over the window said there was no market.
   */
  | {
      readonly status: 'resolved';
      readonly value: number | null;
      readonly y: boolean;
      readonly firstSignalMs: Millis | null;
    };

export interface ClassifyInput {
  readonly window: { readonly originMs: Millis; readonly resolvesAtMs: Millis };
  readonly coverage: CoverageEvidence;
  /**
   * ★ DID ANYTHING EVER ASK WHETHER A COIN CAME OUT OF THIS SUBJECT?
   *
   * THE SECOND HALF OF THE NEGATIVE, AND THE HALF `coverage` CANNOT SPEAK FOR.
   * "Nothing was minted from this narrative" is two claims: nothing was minted,
   * AND we would have known if it had been. `CoverageEvidence` proves the first
   * half only — `internal.mint_coverage` is the ASSET STREAM's log, and it says we
   * were watching the chain. It says nothing about whether the resolve stage, the
   * one and only thing that ever attributes a coin to a story, was ever run over
   * this subject. Those are different outages with the same symptom: an empty
   * coin list.
   *
   * Without this flag the classifier read "the matcher never ran" as "the world
   * produced nothing", which is the exact shape of the error the whole file is
   * arranged around — an outage spent as a claim — and it was the LOUDEST case
   * rather than a corner: on the live database there is not one resolve-stage
   * `candidate` decision, so every subject whose window closed would have been
   * written a confident negative on the strength of a stage that had never
   * successfully matched anything.
   *
   * TRUE means the decision log holds at least one resolve-stage decision about
   * this subject — including a `drop`, which is the useful case: "we looked at
   * this story and rejected every candidate" is precisely the observation that
   * makes the negative assertable.
   *
   * ★ WHAT IT DELIBERATELY DOES NOT CHECK, so nobody reads more into it than it
   * says: that the stage was running THROUGHOUT the window. A story examined on
   * day one of thirty and never again could still have produced a coin on day
   * twenty. Bounding that needs a stated tolerance for how much matcher silence a
   * negative survives — a number, a `LabelPolicy` field, and a `definition` bump
   * with it, because a row graded under a tolerance is not the same measurement as
   * a row graded without one. That is a live product decision and it is the
   * owner's, not this file's. What is fixed here is the half that needs no number:
   * where NOTHING ever asked, there is no negative to assert.
   */
  readonly attributionAsked: boolean;
  readonly coins: readonly CoinEvidence[];
  readonly nowMs: Millis;
}

/**
 * ★ THE ORDER OF THESE CHECKS IS THE DESIGN. Read it as a sentence: has it finished; were
 * we watching; was there anything; could we measure it; do we believe the measurement.
 *
 * Moving the coverage tests below the "no coin appeared" branch would make every dark
 * period produce a clean negative, which is the single failure `internal.mint_coverage`
 * was created to prevent and the one that cannot be detected afterwards.
 */
export function classify(input: ClassifyInput, p: LabelPolicy): LabelOutcome {
  const { window, coverage, coins, nowMs, attributionAsked } = input;

  /* 1. NOT FINISHED. Before everything, including before coverage: a window that is still
        open cannot be censored either, because we have not yet failed to watch the part
        of it that has not happened. */
  if (nowMs < window.resolvesAtMs) return { status: 'pending' };

  const measured = measurePeak(coins, p);
  const bound = measured.multiple;

  /* 2. DECLARED DARKNESS. Decisive on its own. Note this censors a MEASURED coin too, and
        that is intentional rather than over-cautious: during the dark period another coin
        of the same narrative could have been minted and missed, so the best-coin peak we
        are holding is a lower bound on the subject's outcome, not the subject's outcome. */
  if (coverage.gapDeclared) {
    return {
      status: 'censored',
      reason: 'coverage_gap_declared',
      value: bound,
      firstSignalMs: measured.firstSignalMs,
    };
  }

  /* 3. UNACCOUNTED-FOR WINDOW. The other half of the coverage question, and the one a
        boolean cannot answer: a window nobody declared dark but which observed rows only
        partly tile was still partly unwatched. */
  const windowMs = window.resolvesAtMs - window.originMs;
  const coveredFraction = windowMs <= 0 ? 0 : coverage.coveredMs / windowMs;
  if (coveredFraction < p.minCoveredFraction) {
    return {
      status: 'censored',
      reason: `coverage_incomplete:${coveredFraction.toFixed(4)}`,
      value: bound,
      firstSignalMs: measured.firstSignalMs,
    };
  }

  /* 4. NOTHING WAS MINTED FROM IT, AND WE WATCHED. The negative, and the only branch that
        may assert one on an absence. THREE halves, not two, and the third was missing:
        nothing was attributed; checks 2 and 3 proved the chain was watched the whole
        time; and something must actually have LOOKED for a coin here.

        The third is a separate outage with an identical symptom. `internal.mint_coverage`
        is the asset stream's log — it proves we saw the mints, not that we ever tried to
        match one to this subject. A subject the resolve stage never examined produces the
        same empty list as a subject it examined and found nothing for, and only one of
        those is a fact about the world. See `attributionAsked`. */
  if (coins.length === 0) {
    if (!attributionAsked) {
      return {
        status: 'censored',
        reason: 'never_examined_for_a_coin',
        value: null,
        firstSignalMs: measured.firstSignalMs,
      };
    }
    return { status: 'resolved', value: null, y: false, firstSignalMs: measured.firstSignalMs };
  }

  /* 5. WE NEVER ASKED. There is a coin and not one reading of it — that is our outage,
        and an outage is not a claim. There is no coverage log for the market reader the
        way there is for the asset stream, so this absence is the only evidence that it
        was down, and it must not be spent as a zero. */
  if (measured.observations === 0) {
    return {
      status: 'censored',
      reason: 'no_readings_over_window',
      value: null,
      firstSignalMs: measured.firstSignalMs,
    };
  }

  /* 6. NO PRICE. Two different things arriving as the same empty measurement.
        · Every answer said there was no market: the coin never traded. We asked, the
          world answered, and the answer was nothing — a resolved negative.
        · Anything else — a reading we could not parse, a market that exists and did not
          carry the number — is a hole in our evidence, not in the coin. */
  if (measured.multiple === null) {
    if (measured.priced === 0 && measured.everyAbsenceIsNoMarket) {
      return { status: 'resolved', value: null, y: false, firstSignalMs: measured.firstSignalMs };
    }
    return {
      status: 'censored',
      reason: 'no_usable_price_in_window',
      value: null,
      firstSignalMs: measured.firstSignalMs,
    };
  }

  /* 7. A PEAK NOBODY ELSE SAW. Carried out as a lower bound rather than discarded: the
        price was real, our confidence that it was a market rather than one participant
        is what is missing. */
  if (measured.support < p.minPeakSupportReadings) {
    return {
      status: 'censored',
      reason: `peak_unsupported:${measured.support}`,
      value: measured.multiple,
      firstSignalMs: measured.firstSignalMs,
    };
  }

  /* 8. A measurement, over a window we watched, that we believe. */
  return {
    status: 'resolved',
    value: measured.multiple,
    y: measured.multiple >= p.peakMultipleThreshold,
    firstSignalMs: measured.firstSignalMs,
  };
}

/* ── is this a correction, or the same answer again ───────────────────── */

/** The settled shape of a row already on disk, as this comparison needs to see it. */
export interface SettledRow {
  readonly status: string;
  readonly value: number | null;
  readonly y: boolean | null;
  readonly censorReason: string | null;
}

/**
 * ★ IS THE RECOMPUTED OUTCOME THE SAME CLAIM AS THE ROW ALREADY ON DISK?
 *
 * This is the whole of idempotence-that-does-not-churn, and it is easy to get backwards.
 * A censored subject MUST be re-measured every run — that is the only way a backfilled
 * coverage gap ever gets noticed — but re-measuring is not the same as re-recording. If
 * the answer has not changed, the run has learned nothing and must append nothing;
 * otherwise every nightly run would add a revision saying exactly what the last one said,
 * and the revision number would count RUNS instead of counting CORRECTIONS, which
 * destroys the only signal that says how often our evidence actually improves.
 *
 * It compares the settled claim and NOT the whole row: `computed_at` moves every run by
 * construction, and comparing it would make every row a correction.
 *
 * Value equality is exact rather than tolerant. A multiple that moved in the fifteenth
 * decimal place because a floating-point sum associated differently is not a real
 * correction — but an exact test makes that visible as a spurious revision somebody can
 * find and explain, and a tolerant one silently decides how much drift is acceptable
 * without anybody choosing the number.
 */
export function sameOutcome(previous: SettledRow, outcome: LabelOutcome): boolean {
  if (previous.status !== outcome.status) return false;
  if (outcome.status === 'resolved') {
    return previous.value === outcome.value && previous.y === outcome.y;
  }
  if (outcome.status === 'censored') {
    return previous.value === outcome.value && previous.censorReason === outcome.reason;
  }
  if (outcome.status === 'unresolvable') return previous.censorReason === outcome.reason;
  /* `pending` never reaches disk, so it can never be the same as a row on it. */
  return false;
}

/* ── the denominator, written next to every number ────────────────────── */

/**
 * ★ THE POPULATION STRING, BUILT FROM THE POLICY RATHER THAN TYPED.
 *
 * `internal.labels.population` is NOT NULL with no default because the previous
 * backtest reported a claim about coinability in general from a population of graduated
 * coins — roughly 107 a day against about 30,000 mints. Nobody lied; the denominator
 * simply was not written next to the number.
 *
 * So it is derived here from the same object that decides the numbers, which means it
 * cannot describe a run that did not happen. It names the three things that actually
 * bound the set: which subjects were eligible, how a coin was attributed to one, and how
 * long the window was.
 */
export function populationOf(p: LabelPolicy, subjectKinds: readonly string[]): string {
  /* ★ IT DESCRIBES EVERY SUBJECT CONSIDERED, INCLUDING THE ONES THAT COULD NOT BE GRADED.
     The tempting shorter sentence is "…with a recorded origin", and it is exactly the
     error this column exists to prevent: a subject with no origin is IN the population
     and is graded `unresolvable`, so a population string that excluded it would describe
     a denominator smaller than the one the rows were actually drawn from. */
  return (
    `every distinct (subject_kind, subject_id) in internal.decisions with subject_kind in ` +
    `(${subjectKinds.join(', ')}), graded or recorded ungradeable; coins attributed by ` +
    `resolve-stage decisions with verdict in (pass, abstain); window ${p.windowDays}d from ` +
    `the coin's origin when one is attributed, else from the subject's recorded origin`
  );
}

/**
 * Where the value came from, pinned to a revision — a rerunnable recipe rather than a
 * name. It carries the policy version as well as the label definition because the two
 * can move independently and a row that cannot say which numbers graded it is a row
 * nobody can re-derive.
 */
export function sourceOf(p: LabelPolicy, policyVersion: string): string {
  return `services/label:peak_multiple@${p.definition} (public.market_reading; ${policyVersion})`;
}
