/**
 * POLICY — EVERY threshold in the system, in one frozen object.
 *
 * WHY this file exists: the audit that started this rebuild found sixty uppercase
 * numeric constants spread across twenty-four files, none of them recorded against
 * the decisions they produced. That is what made six months of output unauditable —
 * not that the numbers were wrong, but that nobody could say afterwards which number
 * a given decision had been judged against. So: every threshold is here, the object
 * is hashed, and the hash rides on every Decision. `tools/check-policy.mjs` fails CI
 * on a bare numeric literal anywhere in core/ outside a small mathematical allowlist.
 *
 * WHY frozen, deeply: a policy mutated mid-run makes its own hash a lie, and a lie in
 * the audit column is worse than no audit column.
 *
 * WHY the admit bar is a quantile and not a number: a typed score floor drifts out of
 * calibration the moment volume moves, and cannot be compared across sources at all.
 * The bar is recomputed nightly so that admissions land on the tracking budget.
 *
 * Units are in the field names. Every threshold that is a duration ends in Ms, S or
 * Min; every ratio is unitless in [0,1]; every rate limit says what it limits.
 */

import type { AssetKey } from './ids.ts';
import type { CounterKind } from './vocabulary.ts';
import type { Scorers } from './features.ts';

/** Readonly all the way down, so a nested object cannot be edited through a reference. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends ReadonlyArray<infer U>
    ? readonly DeepReadonly<U>[]
    : T extends bigint | boolean | number | string | symbol | null | undefined
      ? T
      : T extends (...args: never[]) => unknown
        ? T
        : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/* ── ADMIT ────────────────────────────────────────────────────────────── */

export interface AdmitPolicy {
  /** Older than this at first sight and there is no lead time left to sell. */
  readonly maxAgeMin: number;
  /**
   * The admission bar as a quantile of today's scored arrivals, not a score.
   * Recomputed nightly against the tracking budget.
   */
  readonly quantile: number;
  /** Floor and ceiling on the recomputed bar, so a bad night cannot open or shut the gate. */
  readonly quantileFloor: number;
  readonly quantileCeiling: number;
  /** How many admissions a day the tracking budget can actually carry. */
  readonly dailyAdmitTarget: number;
  /** Linear score weights. Negative terms are penalties and are meant to be. */
  readonly weights: {
    readonly authorRosterTier: number;
    readonly carrierAcceleration: number;
    readonly hasMedia: number;
    readonly reproductionLevel: number;
    readonly namedSpanPresent: number;
    readonly engagementBait: number;
    readonly threadContinuation: number;
  };
  readonly roster: RosterPolicy;
}

/**
 * The author prior's own thresholds — the shrinkage, the forgetting, and what the
 * four outcome counts are worth relative to each other.
 *
 * ★ WHY THIS BLOCK EXISTS AT ALL. `admit.weights.authorRosterTier` is 0.3, the
 * largest single weight in the admission score, and until this block existed the
 * function that PRODUCES that number had nowhere to read a constant from. Every
 * number below would otherwise have been typed into `core/src/admit/prior.ts`,
 * which is the exact failure this file was created to end — and it would have been
 * typed into the most adversarially interesting feature in the system, where a
 * number nobody can find later is a number nobody can defend later.
 */
export interface RosterPolicy {
  /**
   * The `k` in `n/(n+k)`: how much observed history an account needs before its own
   * record outweighs the population it was drawn from. At k = 10 an account's first
   * ten admitted items buy it at most half the distance from the population mean.
   *
   * The failure it repairs is stated in prior.ts's own doc: without it "an account
   * with one lucky item outranks an account with forty good ones", because a rate
   * over one trial is 0 or 1 and nothing in between.
   */
  readonly shrinkageStrength: number;
  /**
   * How fast the roster forgets, as a half-life on the WEIGHT of an account's
   * evidence — not on the score. Halving the weight pulls the account back toward
   * the population mean rather than toward zero, which is the difference between
   * "we no longer know" and "we now think they are bad".
   *
   * Ninety days, and the number is a choice rather than a measurement, so it is
   * worth saying what it is a choice ABOUT: the regime. Nothing in this repository
   * has measured how long an account's standing predicts its next item, because
   * `internal.decisions` has never held a row. The closest stated half-lives are
   * 21 days on the ranking model's recency weight and 12h on prior mass, and this
   * quantity is slower than both — an account's standing is a fact about a person,
   * not about a moment. Ninety days means a roster earned two years ago has decayed
   * by a factor of about 250 and is, correctly, gone.
   */
  readonly halfLifeDays: number;
  /**
   * The shrink target: what an account we know nothing about is worth.
   *
   * ★ IT IS POLICY RATHER THAN AN INPUT FOR A STRUCTURAL REASON. `rosterTier()` sees
   * ONE author's history, so it cannot compute a mean over the population — and the
   * population mean is the fixed point of its own output, so the nightly job that
   * computes it is downstream of the value it needs. Recomputed nightly against the
   * corpus, exactly like `admit.quantile`'s bar, and frozen here between runs.
   *
   * It is deliberately not zero. Zero is a CLAIM that an unseen account is bad; an
   * absence is not a claim about anything, and this is the value an absence gets.
   */
  readonly populationMean: number;
  /**
   * What each outcome in an account's history is worth, as a share of one admitted
   * item's maximum credit. They sum to 1, so an account every one of whose items
   * reached a resolved story scores exactly 1 before shrinkage.
   *
   * The ordering is the funnel's own: joining a story is common and cheap, a
   * qualified story is rarer, and a resolved one is — in prior.ts's own words —
   * "sparse and slow". Weighting them equally would let volume at the cheap end
   * substitute for depth at the expensive end, which is precisely what an account
   * farming this feature would buy.
   */
  readonly weights: {
    readonly itemsJoinedStory: number;
    readonly storiesQualified: number;
    readonly storiesResolved: number;
  };
}

/* ── TRACK ────────────────────────────────────────────────────────────── */

export interface TrackPolicy {
  /** The re-read grid, in minutes. Geometric, so early minutes are dense. */
  readonly tierMinutes: readonly number[];
  /** Score bands that map an item onto a tier. Same length as tierMinutes − 1. */
  readonly tierCutoffs: readonly number[];
  /*
   * ★ `track.holdoutRate` USED TO BE HERE AND HAS BEEN DELETED. It held 0.02, it was
   * declared and never read, and every live call site — admit/stage.ts and
   * track/holdout.ts — reads `explore.holdoutRate` instead.
   *
   * Two fields holding the same number with only one of them wired up is not a
   * duplicate, it is a trap: whoever tunes the holdout will find this one first,
   * change it, watch nothing happen, and eventually change the other one too — at
   * which point the two disagree and the lane silently splits. holdout.ts is explicit
   * that a hole in the unbiased record is the one failure that is NOT recoverable by
   * re-enabling something later, so the field that cannot be reached is the field that
   * has to go. `explore.holdoutRate` is the single source; this comment is the
   * signpost for whoever comes looking for the deleted one.
   */
  /** Backpressure sheds tiers from the top down and NEVER touches probation. */
  readonly shedFromTier: number;
  /** Stop re-reading after this, unless the item is in the holdout. */
  readonly maxTrackedHours: number;
  /** Consecutive censored reads before the lifecycle demotes a tier. */
  readonly flatReadsToDemote: number;

  /*
   * ── the lifecycle bars ──────────────────────────────────────────────
   *
   * `kinetics/lifecycle.ts` states that "every bar it consults — the margin, the
   * agreement count per edge, the minimum dwell — comes from Policy.track, because a
   * lifecycle bar is a spend decision." None of the three existed. A lifecycle state
   * decides how often we pay to re-read an item and whether we stop paying at all, so
   * these are spend thresholds wearing a state machine's clothes.
   */

  /**
   * How far past its bar a reading must argue before it counts as arguing at all.
   * Under this the reading is inside the noise, the proposal is recorded, and nothing
   * is committed — which is what stops a state machine from flapping on a value that
   * is oscillating across a threshold rather than crossing it.
   */
  readonly lifecycleMargin: number;
  /**
   * Consecutive agreeing readings required to move UP the heat order.
   *
   * ★ ASYMMETRIC WITH `agreeingToFall` ON PURPOSE, and the asymmetry is the file's own
   * argument: entering `rising` is cheap to get wrong — it buys a few extra reads at
   * the top of the grid — and leaving it is not, because leaving it stops us reading
   * the item densely at exactly the moment the density was worth paying for.
   */
  readonly agreeingToRise: number;
  /** Consecutive agreeing readings required to move DOWN the heat order. Higher. */
  readonly agreeingToFall: number;
  /**
   * Consecutive agreeing readings required to enter `dormant`, which is terminal.
   *
   * Highest of the three, and it earns the extra field rather than sharing
   * `agreeingToFall`: every other edge is recoverable by the next reading, and this
   * one costs the item permanently. An item wrongly declared dormant is not demoted,
   * it is gone — and its history stops at the length its early performance bought it,
   * which is the exact conditioning the holdout lane exists to make measurable.
   */
  readonly agreeingToDormant: number;
  /**
   * How long a state must have been held before any transition out of it may commit,
   * whatever the evidence says. The agreement counts bound how much noise it takes to
   * move; this bounds how FAST it can move, which is a different failure — a burst of
   * readings inside one minute can satisfy an agreement count without spanning enough
   * real time to have observed anything.
   */
  readonly minLifecycleDwellMs: number;
}

/* ── DETECT and KINETICS ──────────────────────────────────────────────── */

export interface KineticsPolicy {
  /** Continuous-time decay constants. The sampling grid is irregular by design, so
   *  the discrete form would bias frequently-sampled items upward mechanically. */
  readonly fastTauMin: number;
  readonly slowTauMin: number;
  /** A difference under this multiple of the rounding step is censored, not zero. */
  readonly stepSafetyFactor: number;
  /** Two readings closer together than this cannot support a difference. */
  readonly minElapsedMs: number;
  /** A drop larger than this fraction is a correction at the source, not a decline. */
  readonly nonMonotonicTolerance: number;
}

export interface DetectPolicy {
  /** Atypicality, as −log10 P(count | baseline). Scale-free, so comparable anywhere. */
  readonly etaSelfBar: number;
  readonly etaPopulationBar: number;
  /**
   * ★ THE HARD ABSOLUTE FLOOR BENEATH THE RELATIVE TEST — PER COUNTER KIND.
   *
   * WHY THE FLOOR EXISTS: an author's own baseline is under an adversary's control in
   * both directions — depress it with filler, then buy engagement — and a gate an
   * attacker can open by buying a hundred approvals is worse than no gate. The
   * relative tests live INSIDE this one, and it is checked before any baseline is
   * consulted, so nothing an adversary can do to a baseline reaches it.
   *
   * ★ WHY IT IS NO LONGER A SINGLE SCALAR, which was a real defect. It shipped as
   * `absoluteFloor: 50`, one number across all six counter kinds. But admit/stage.ts
   * opens by forbidding exactly that shape: "`reach` means autoplay on one source and
   * impressions on another, and on a third it does not exist at all". Fifty
   * reproductions and fifty impressions are not the same claim, they are not the same
   * order of magnitude, and a single number meant the floor was simultaneously
   * unreachable for one kind and free for another.
   *
   * ★ WHY PER KIND AND NOT PER SOURCE, which is the harder half of the question. A
   * per-source table is the thing this repository refuses everywhere else: it has to
   * be re-derived every time a vendor changes, and it silently defines every source
   * nobody has tuned as "undetectable". The source-specific part of the judgement is
   * already carried, and carried better, by the POPULATION baseline — whose cohort is
   * (source, hour of day) and whose expectation therefore already knows what a normal
   * number looks like there. This floor has exactly one job left after that: be a
   * quantity no baseline manipulation can move. A kind is the coarsest unit at which
   * that job is still meaningful, and coarse is the point.
   *
   * ★ THE UNIT IS ARRIVALS IN `countWindowMin`, NOT A LEVEL. It is compared against
   * the counter's DELTA over the window, so an old post with a large cumulative total
   * and no current motion does not clear it. A floor on a level would be a floor on
   * how big something already is, which is the opposite of what this stage sells.
   *
   * ★ WHAT WOULD MOVE THESE NUMBERS, and it is not taste. The distribution of window
   * deltas per kind per source over real observations — which does not exist yet:
   * `internal.decisions` has never held a row, so there is no measured distribution to
   * set a percentile against. These are the shipped 50 re-expressed across the kinds
   * in the ratios the counters' own meanings imply, and they are a starting point that
   * is honest about being one. The moment a week of observations exists, each of these
   * becomes a percentile of its own kind's window-delta distribution.
   *
   * ★ THE ALTERNATIVE THAT WAS CONSIDERED AND NOT TAKEN: a floor on `rate_LCB`, the
   * Gamma-Poisson shrunk lower-bound arrival rate. It is the better quantity — it is
   * already small-sample-corrected — and it is what the system design specifies. It is
   * not used here because nothing in core computes it yet, its home is the wide item
   * feature set, and a floor that reads a quantity no file produces is a floor that is
   * silently never applied. When `rate_LCB` exists, this field moves onto it and the
   * unit line above is the only thing that has to change.
   */
  readonly absoluteFloorByKind: Readonly<Record<CounterKind, number>>;
  /** burst = fast/slow. Above this is bending upward. */
  readonly burstBar: number;
  /** Readings required before a baseline is usable at all. */
  readonly minBaselineReads: number;
  /** Which counter drives the burst statistic when several are present. */
  readonly preferredCounters: readonly CounterKind[];
  /**
   * ★ THE WINDOW A RATE BECOMES A COUNT OVER, and the unit `Baseline.expectation` is
   * expressed in.
   *
   * `eta(count, expectation, dispersion)` takes "the arrivals observed in the window"
   * and "the fitted mean for this subject in this window", and until this field
   * existed no number in the system named that window. Without it `detect()` cannot
   * turn a per-minute `Rate` into a count at all, and two implementers would have
   * picked two different windows in two files, producing bars that mean different
   * things on different days with nothing recording which.
   *
   * Twenty minutes, equal to `kinetics.fastTauMin`, and the equality is deliberate
   * rather than incidental: `burst` is a statement about the fast leg's memory and
   * `eta` is a statement about the count window, and the two are conjoined in the same
   * gate. If they measured different stretches of time the conjunction would be a
   * claim about no particular interval. They are separate fields so either can move,
   * and this sentence is the note saying what breaks when only one does.
   */
  readonly countWindowMin: number;
  /**
   * ★ THE NEGATIVE-BINOMIAL DISPERSION PRIOR, PER COUNTER KIND. Variance is
   * `μ + μ²/r`; Poisson is the limit as `r → ∞`.
   *
   * WHY A PRIOR AND NOT AN ESTIMATE: `minBaselineReads` is 2, and a dispersion cannot
   * be estimated from two points. Something has to supply it, and the alternative to
   * supplying it here is supplying it as a literal inside the fit. This is also the
   * only reason `selfBaseline(rates, kind, …)` takes a kind at all — with one scalar
   * that parameter would be dead.
   *
   * WHY PER KIND: the kinds are overdispersed for different reasons and to different
   * degrees. `reach` arrives in cascades where one large-audience resharer drags the
   * whole distribution, so it is the most overdispersed. `approval` and `retention`
   * are one-tap actions by individuals and come closest to independent arrivals.
   *
   * ★ EVERY VALUE IS SET LOW, AND THE ASYMMETRY IS THE WHOLE ARGUMENT. Nothing here
   * has been measured. But the error is one-directional: too LARGE an `r` asserts
   * near-Poisson spread, and at a low baseline that manufactures certainty — a count
   * of 12 against an expectation of 2 reads as one-in-a-million under Poisson and as
   * one-in-a-hundred under `r = 1`. Low-baseline accounts are exactly the population
   * an adversary can create for free, so an inflated `r` is a false-positive generator
   * aimed at them. Too SMALL an `r` only makes us miss things. Erring toward
   * overdispersion is erring toward silence, which is the affordable error.
   */
  readonly dispersionByKind: Readonly<Record<CounterKind, number>>;
  /**
   * The hard floor under any dispersion, including one estimated from a cohort.
   * Below this the tail is so flat that nothing is ever surprising, and a baseline
   * that cannot be surprised is not a detector — it is silence with extra steps.
   */
  readonly dispersionFloor: number;
  /**
   * How many trailing readings the self baseline is fitted on.
   *
   * ★ A COUNT OF READINGS AND NOT A DURATION, which is the non-obvious half. The read
   * grid is geometric by design, so a fixed lookback window would hand a top-tier item
   * twelve readings and a probation item one. The precision of the fit would then be a
   * function of the tier, the tier is a function of the score, and the score is the
   * outcome — the same conditioning `track/stage.ts` forbids in its own header, arriving
   * through the back door of a baseline instead of through the scheduler.
   */
  readonly selfBaselineReads: number;
  /**
   * The `k` in `n/(n+k)`, shrinking the self baseline's expectation toward the
   * population's. Same form and same value as `admit.roster.shrinkageStrength`, and
   * deliberately a separate field: they are the same idea applied to two different
   * quantities, and folding them into one number would mean retuning a detector by
   * editing an author prior.
   *
   * ★ IT IS ALSO AN ADVERSARIAL BOUND, not only a small-sample repair. The self
   * baseline is the leg an attacker can depress with filler posts. Shrinking it toward
   * the cohort caps how far down it can be pushed: at `k = 10` an account with two
   * trailing readings keeps only about a sixth of its own history's influence, so
   * manufacturing a suspiciously quiet baseline costs ten real readings before it buys
   * anything, and buys it against a cohort mean that the attacker does not control.
   */
  readonly baselineShrinkage: number;
}

/* ── GROUP ────────────────────────────────────────────────────────────── */

export interface GroupPolicy {
  /** Tier 1, free: perceptual image hash distance, out of imageHashBits. */
  readonly imageHashMaxDistance: number;
  readonly imageHashBits: number;
  /** Tier 1, free: near-duplicate text distance, and the shingle count it needs. */
  readonly textHashMaxDistance: number;
  readonly textHashBits: number;
  readonly minShingles: number;
  /**
   * Tier 2, paid: similarity bar, per representation space. NEVER reuse a bar across
   * spaces — a bar calibrated on sparse term geometry merges nearly everything when
   * a dense space is dropped in behind it.
   */
  readonly similarityBars: Readonly<Record<string, number>>;
  /** Below this the pair goes to adjudication rather than to a guess. */
  readonly adjudicationBand: number;
  /**
   * The scalar bar a (item, story) pair must clear to be a join at all.
   *
   * Distinct from the per-kind distance bars above and not derivable from them:
   * those decide whether a carrier is SHARED, this decides whether the shared
   * evidence adds up to one thing. `M3_below_match_bar` had no field to read
   * before this one existed.
   */
  readonly matchBar: number;
  /**
   * Hand-set weights over the match features, to be replaced by a logistic
   * regression over the same features once there are a few hundred hand-labelled
   * pairs. They live here rather than in match.ts so that the fit, when it
   * happens, is a diff to this object — and so every decision row already carries
   * a hash saying which weights judged it.
   *
   * The two exact-match carrier kinds share one weight because they share one
   * evidential shape: an exact token present on both sides. Their difference in
   * reliability is already carried by the persistence weight, which is what
   * zeroes a symbol everybody mentions and leaves a template id alone.
   */
  readonly matchWeights: {
    readonly imageCarrier: number;
    readonly textCarrier: number;
    /** formatId and entitySpan: exact string equality, free, and certain. */
    readonly exactCarrier: number;
    readonly lineage: number;
    readonly representation: number;
    readonly sourceAgreement: number;
    readonly timeProximity: number;
  };
  /**
   * At or below this a shared carrier is ambience rather than evidence, and the
   * pair is `M5_generic_carrier` instead of a join.
   *
   * Zero is the honest value TODAY and not a placeholder: `carrierWeight()`
   * returns exactly zero for a generic symbol and a positive number for
   * everything else, and until the daily frequency table is actually being
   * written there is no second thing the weight can prove. When that history
   * exists, raising this floor is the whole edit.
   */
  readonly minCarrierWeight: number;
  /**
   * The scale time proximity decays over, as the denominator of an exponential:
   * a pair separated by this much is worth about a third of a pair posted
   * together. It is a scale rather than a cutoff because a hard window would
   * make a story's oldest member stop attracting versions at a fixed age, which
   * is a claim about memes nobody has evidence for.
   */
  readonly timeProximityTauMs: number;
  /** Term weighting: persistence over daily buckets, not raw document frequency. */
  readonly persistenceBuckets: number;
  readonly persistenceDfFloor: number;
  /** Promotion: what a candidate must show before anything downstream may look at it. */
  readonly promoteMinMembers: number;
  readonly promoteMinDistinctAuthors: number;
  /**
   * The third promotion clause, which promote.ts's header has always demanded and
   * which had no field to read.
   *
   * It ships at one, and the reason is worth writing down rather than
   * rediscovering: only one adapter currently has a live implementation, so a bar
   * of two would mean nothing is ever promoted and every downstream stage would
   * go quiet for a reason no reason code could name. One says "a single source is
   * enough while a single source is all there is". Raising it to two is the right
   * edit the day a second adapter runs, and this comment is the note that says so.
   */
  readonly promoteMinDistinctSources: number;
  /** Merge two stories when this share of one's carriers is present in the other. */
  readonly mergeCarrierOverlap: number;
  readonly maxMembersPerInterval: number;
}

/* ── QUALIFY ──────────────────────────────────────────────────────────── */

export interface QualifyPolicy {
  readonly minDistinctAuthors: number;
  readonly minMembers: number;
  readonly minNameLen: number;
  readonly minSpecificity: number;
  /** Distinct authors at which the breadth term saturates. */
  readonly authorBreadthFull: number;
  readonly passScore: number;
  /** The cap the judge cannot argue with: it runs after the model and only lowers. */
  readonly nameabilityCapFloor: number;
  readonly weights: {
    readonly judgeConfidence: number;
    readonly specificity: number;
    readonly crossSource: number;
    readonly authorBreadth: number;
  };
  /** Stories per judge call. Most of the spend is one static prompt, retransmitted. */
  readonly batchSize: number;
}

/* ── RESOLVE ──────────────────────────────────────────────────────────── */

export interface ResolvePolicy {
  /** The candidate window, measured from the story's earliest post. */
  readonly minLagMs: number;
  readonly maxLagMs: number;
  /** Time-first retrieval: symbol is a scoring channel over this set, never the key. */
  readonly maxCandidates: number;
  /**
   * ★ HOW FAR BACK OF OUR OWN FIRST SIGHT OF A STORY IT IS WORTH LOOKING FOR ITS COIN,
   * when not one of the story's members carried a post time.
   *
   * ★ IT IS A SEPARATE FIELD FROM maxLagMs AND MEASURES A COMPLETELY DIFFERENT THING.
   * `maxLagMs` answers "how long after a post is a mint still plausibly from it" — a fact
   * about how people behave. This answers "how late can OUR OWN READER be" — a fact about
   * our crawl cadence, our queue depth and our backfill schedule. They are numerically
   * close today and that is coincidence, not sharing. Folding them into one number would
   * mean that changing the poll interval silently retunes a mint-plausibility rule, and
   * nothing in the decision row would say so.
   *
   * ★ WHY IT EXISTS AT ALL, which is the honest part. Where a post time exists the window
   * is an ORDERING claim: a coin minted before the post did not come from it. Where none
   * exists there is nothing to order against, and the only clock left — when we first read
   * the item — can be LATE by an unknown amount and can never be early. So a window hung
   * on it is not an ordering claim at all; it is a bound on where it is worth LOOKING, and
   * it therefore has to reach BACKWARDS as well as forwards. A forward-only window on a
   * first-sight anchor would encode "we looked at 00:27, so nothing before 00:27 counts",
   * which is exactly the "we saw it late, therefore it was posted late" conversion this
   * number exists to refuse. Measured: it deletes the one correct coin the rooftop story
   * has, and that row then offers CREATE for a coin that already exists.
   *
   * SWEPT, not picked, against the 205 assets in public.asset with the rooftop story
   * (three members, not one post time between them, first sight 2026-08-17T00:27Z) as the
   * only anchorless story in the set. Retrieval, and whether its one correct coin — SLIDE
   * / "roof slide", minted 3h50m BEFORE we first saw the story — survives:
   *
   *     1h   10 rows   SLIDE LOST      row projects `none` → CREATE on a coin that exists
   *     3h   12 rows   SLIDE LOST      same
   *     4h   13 rows   kept, by 10 min of margin
   *     6h   13 rows   kept
   *    12h   13 rows   kept   ┐ identical row set: nothing at all was minted between
   *    24h   13 rows   kept   ┘ 45h and 4h before this anchor
   *    48h   89 rows   kept, and the five "this is his first actual ca" spam mints from
   *                    45h earlier come back, which is the precision this bound buys
   *
   * ★ SO THE SAFE BAND IS [4h, 45h] AND THE VALUE IS SET NEAR THE TOP OF IT, WHICH IS THE
   * OPPOSITE OF HOW candidateDfFloor BELOW IS SET. The errors point the other way here.
   * Too WIDE retrieves strangers, the text rule counts them, `claimCount` inflates and the
   * row says `unsure` and offers nothing — useless and safe. Too NARROW loses the story's
   * only coin, the row says `none` and offers CREATE. Setting a bound at the edge of the
   * band where the cheap failure lives is how you buy a little precision with the one
   * error this product cannot afford. 24h sits 20h inside the near edge and 21h clear of
   * the far cliff, and costs nothing measurable at either end.
   *
   * ★ WHAT WOULD MOVE IT, and it is not a re-sweep of this store. The quantity is how late
   * our reader can be, so the evidence is `first_seen_at − posted_at` over items that HAVE
   * both — measured over real ingest, not over seeded rows, which all carry a fabricated
   * two minutes. `admit.maxAgeMin` (240) is the closest thing the system already states
   * about it: an item older than four hours at first sight is not admitted at all, so for
   * anything that came through admission our lateness is bounded by that. This is six
   * times it, because backfill, a re-group and a replay all put items in the store without
   * passing that gate, and being generous here costs `unsure` while being tight costs
   * CREATE.
   *
   * ★ WHAT IT DOES NOT FIX. `maxCandidates` still caps the set, and in a real market — 23,
   * 29, 22 and 42 mints in four consecutive minutes of the live slice in this store, so
   * 1,500–2,500 an hour — a day-wide window holds far more than 500 rows and the cap, not
   * this bound, decides what survives. What survives is then the coins closest to the
   * anchor, which is the least-arbitrary prior available and is still only a prior.
   */
  readonly firstSightLookbackMs: number;
  /**
   * ★ WHICH WORDS OF A STORY ARE ALLOWED TO PUT A COIN IN THE RUNNING.
   *
   * A coin becomes a CANDIDATE for a story by sharing a normalised word with one of the
   * story's phrases. Against 192 real mints, three words did all the damage: "the" put
   * eleven strangers on the soup row, "his" five on the rooftop row, "a" four on the chill
   * row. Zero false candidates came from a content word. The fix is not a stopword list —
   * measured over the same 192 mints, only 4 of the 27 words above df 6 are stopwords and
   * the other 23 are one spam campaign's vocabulary ("70m", "views", "3days", "brainer",
   * all at df 15 because one campaign minted the same name fifteen times). A list catches
   * 15% of the head and needs a human to keep catching it.
   *
   * So the test is DOCUMENT FREQUENCY: how many distinct assets already use this word. A
   * word most of the market is already using cannot tell us who this story's coin is,
   * whoever made it common and whatever it means.
   *
   *   ceiling K = max(candidateDfFloor, ceil(candidateDfFraction × corpusSize))
   *   a word earns candidacy iff df(word) < K and word.length >= candidateMinTokenLength
   *
   * ★ WHY A FLOOR AND NOT A BARE PERCENTAGE. ceil(0.03 × N) rounds to 1 on a small corpus,
   * and "drop every word carried by one asset" drops every word that could match anything.
   * Measured at 13, 23 and 38 documents, a bare 2% ceiling made all six seeded stories
   * project `none` — including the ferry story, whose single correct DOCK coin exists.
   * `none` puts CREATE on the row, which tells a user to mint a coin that already exists.
   * That is the error direction this whole rule is built to avoid, so the floor is the part
   * that does the work and the fraction is only headroom for a corpus that grows.
   */
  readonly candidateDfFloor: number;
  readonly candidateDfFraction: number;
  /**
   * A word this short is not an identifier. Measured: every false candidate traced to a
   * one-character word was the article "a", and no true pair in the 33-pair truth set turns
   * on a one-character word. It is deliberately 2 and not 4 — 19% of the real symbols in
   * this corpus are three characters or fewer (CTB, COD, SOS, MOD, CA are real mints), so a
   * minimum of 4 would eventually hide a real three-letter ticker, and hiding it produces
   * CREATE-on-a-coin-that-exists. A coin whose WHOLE name is a short word is unaffected:
   * the equality path skips this filter entirely.
   */
  readonly candidateMinTokenLength: number;
  /** Established assets, excluded by list rather than by a heuristic. */
  readonly majors: readonly AssetKey[];
  /** The probe size a quotability gate asks for, in USD. */
  readonly probeNotionalUsd: number;
  /** All-in cost above this is a cost no user should ever pay, whatever the asset. */
  readonly maxAllInBps: number;
  /** Confidence bar for the best candidate. */
  readonly tauHigh: number;
  /**
   * ★ The margin, which is the part that is usually missing. One phrase can produce
   * hundreds of assets; a high score on the best candidate proves nothing when the
   * runner-up scores the same. Ambiguity rejection is what makes "no confident match,
   * no Buy button" enforceable rather than aspirational.
   */
  readonly deltaMargin: number;
  /**
   * A venue with fewer than this many of its own adjudicated labels may produce
   * 'unsure' at most, never 'confirmed'. Scores are not comparable across venues,
   * so a new venue's first month is read-only, enforced by the gate rather than by
   * a reminder.
   */
  readonly minVenueLabels: number;
  readonly scoreWeights: {
    readonly temporal: number;
    readonly symbol: number;
    readonly semantic: number;
    readonly image: number;
    readonly declared: number;
  };
}

/* ── MARKET ───────────────────────────────────────────────────────────── */

/**
 * Reading a market, and how long a reading stays true.
 *
 * ★ `readingFreshnessMs` IS A THRESHOLD AND IS HERE FOR THE REASON THIS FILE EXISTS.
 * It is the one number that decides whether a price on screen is presented as the
 * current price or as an absence, and it is the kind of number that ends up typed
 * into a projector as `5 * 60_000` and then quietly doubled by whoever was on call
 * the night the reader fell behind. Written down here, changing it is a diff, and the
 * board a user saw in March is answerable against the policy that was in force then.
 *
 * Five minutes, and the reasoning is the product's own clock rather than a round
 * number: the measured median post-to-mint lag is under four minutes, so a coin can
 * be minted, run, and peak inside one freshness window. A price older than that is
 * not a slightly-late price on this product — it is a different coin's story. Longer
 * hides a stall in the reader behind a number that still looks live; much shorter
 * turns every ordinary gap between passes into a board full of dashes, and a board
 * that is always dashes teaches people to ignore the dash.
 */
export interface MarketPolicy {
  /**
   * How old a reading may be and still be shown as the CURRENT market. Past this the
   * projection publishes an absence with a reason and never the last number it holds:
   * a stale price presented as live is the one market error a user acts on directly.
   */
  readonly readingFreshnessMs: number;
  /**
   * How many assets one market pass reads. A bound on the vendor, not a judgement
   * about which assets matter — the pass takes the most recently seen first, because
   * a coin nobody has seen for a day is not the coin anybody is about to buy.
   *
   * It is here rather than in the service because the binding budget on a free
   * endpoint is its rate limit, and a rate limit spent is exactly as gone as money.
   */
  readonly maxAssetsPerPass: number;
}

/* ── RANK ─────────────────────────────────────────────────────────────── */

export interface RankPolicy {
  readonly alpha: number;
  readonly gamma: number;
  readonly t0Min: number;
  readonly slots: number;
  readonly tickS: number;
  /** Hysteresis. Without it a live-updating board flickers and no smoothing fixes it. */
  readonly swapEdge: number;
  readonly ticksToEnter: number;
  readonly ticksToLeave: number;
  readonly minDwellS: number;
  readonly maxPositionsMovedPerTick: number;
  /**
   * The escape hatch: a genuinely explosive entrant skips the dwell.
   *
   * ★ IT IS A BAR ON `burst`, THE fast/slow RATIO, and the name is now honest about
   * which quantity it means. The design note this comes from describes the hatch as a
   * hard threshold on the shrunk arrival RATE, and those are two different numbers
   * with two different units — a rate is per-minute and per-source, a ratio is
   * unitless and comparable anywhere. The hatch is a claim that something is bending
   * upward RIGHT NOW, made about subjects arriving from sources whose counters are
   * not comparable to each other, so the only quantity that can carry a single
   * threshold across all of them is the scale-free one. A rate bar would need a
   * per-source constant re-derived every time a vendor changed, which is precisely
   * what the ratio exists to avoid.
   */
  readonly newEntrantBurst: number;
  /**
   * ★ BOARD STABILITY HAS THREE BARS, NOT ONE, AND THAT IS THE POINT OF MEASURING IT.
   *
   * Rank correlation between consecutive ticks is two-sided: too low and the board
   * churns under the reader's cursor, too high and the ranker has stopped responding
   * to anything. A frozen board and a healthy board are pixel-identical, so a single
   * floor can never tell them apart and no screenshot ever will.
   *
   *   kendallTauFloor      0.90 — the target at a 20-second tick.
   *   kendallTauUnusable   0.85 — below this the board cannot be read at all. A
   *                               different alarm from missing the target, because
   *                               one is a tuning note and the other is an outage.
   *   kendallTauCeiling    0.98 — sustained above this, the ranker is dead and the
   *                               board is a screenshot of a working system.
   */
  readonly kendallTauFloor: number;
  readonly kendallTauUnusable: number;
  readonly kendallTauCeiling: number;
  /**
   * The share of board slots drawn from BELOW the cut, with the propensity recorded.
   *
   * ★ SEPARATE FROM explore.epsilon ON PURPOSE, and reusing that field here would be
   * a silent bug rather than a tidy-up. `explore.epsilon` is a draw over ARRIVALS at
   * admission; this is a draw over SLOTS on the board. Different populations,
   * different budgets, and separately costed — the 2.8 points of realised precision
   * epsilon is documented to cost is a statement about admissions and says nothing
   * about feed quality. Sharing one number would also write a wrong `propensity` on
   * every rank row, and a wrong propensity does not degrade a counterfactual
   * estimate, it makes it undefined.
   */
  readonly exploreSlotShare: number;
  /**
   * How old the newest input behind a subject's heat may be before RANK refuses to
   * rank it. Produces R5_features_stale, which is an ABSTAIN: a stale input is a
   * missing input, and a missing input is not a claim that the subject went quiet.
   *
   * ★ NOT tickS. The tick is how often we recompute; this is how stale the thing we
   * recompute FROM is allowed to be, and they differ by an order of magnitude on
   * purpose. The densest re-read tier is `track.tierMinutes[0]` — four minutes — so
   * anything under 240s would mark every subject on a perfectly healthy system stale.
   * This is one tier-0 interval plus a minute of slack, so it fires on a reader that
   * has stopped rather than on one that is merely between reads.
   */
  readonly maxFeatureAgeS: number;
}

/* ── FEATURES — the wide sets, which are not any one stage's ──────────── */

/**
 * The bars the WIDE feature builders read. They are separate from every stage block
 * because a wide vector belongs to no stage: the same item vector is logged by ADMIT
 * today and by whatever ranks items tomorrow, and hanging its constants off
 * `admit.*` would mean moving them the day a second consumer appears.
 */
export interface FeaturesPolicy {
  /**
   * How many items a source's trailing sample must hold before a percentile computed
   * against it is worth anything. Under this the percentile features are NULL, not
   * 0.5 and not 0 — "we have not seen enough of this source to say where this sits"
   * is an absence, and the corpus-size feature beside them is the reason.
   */
  readonly minCorpusItems: number;
  /**
   * The Gamma-Poisson prior an arrival rate is shrunk toward before its lower bound
   * is taken. This is the `rate_LCB` every downstream heat score consumes, and the
   * reason it exists is the small-sample problem: an item with one lucky reading
   * outranks an item with an hour of evidence unless the estimate is shrunk.
   */
  readonly ratePrior: {
    /** a₀ — the arrivals the prior is worth. */
    readonly priorArrivals: number;
    /** b₀ — the exposure the prior is worth, in minutes. */
    readonly priorExposureMin: number;
    /** The lower tail the bound is taken at. 0.10 is a one-sided 90% lower bound. */
    readonly lcbQuantile: number;
  };
  /** What "recently" means in the story vector's arrival-share terms. */
  readonly recentWindowMin: number;
}

/* ── EXPLORATION and BUDGET ───────────────────────────────────────────── */

export interface ExplorePolicy {
  /**
   * A deterministic policy has propensity 1 for what it did and 0 for everything
   * else, which makes counterfactual estimates undefined. Randomness must be
   * injected at decision time or off-policy evaluation is impossible in principle.
   *
   * The cost is written down on purpose: at a precision of 0.30 against a base rate
   * of 0.02, ten percent exploration costs about 2.8 points of realised precision.
   * A principle without a number does not survive a bad week.
   */
  readonly epsilon: number;
  /** Pre-gate, unrendered, uniform over arrivals. Cut epsilon before this, ever. */
  readonly holdoutRate: number;
  readonly holdoutSalt: string;
  /** Downsampling of routine drops beyond the full-fidelity window. */
  readonly dropLogSampleRate: number;
  readonly fullFidelityDays: number;
}

export interface BudgetPolicy {
  readonly dailyUsd: number;
  readonly discoveryUsdPerDay: number;
  readonly observeUsdPerDay: number;
  readonly judgeUsdPerDay: number;
  readonly quoteUsdPerDay: number;
  /** Stop spending on a vendor at this share of its line, leaving room to finish. */
  readonly softStopFraction: number;
}

/* ── the whole thing ──────────────────────────────────────────────────── */

export interface Policy {
  /** Bumped by hand on every edit. The hash is computed from the object, not this. */
  readonly version: string;
  readonly admit: AdmitPolicy;
  readonly track: TrackPolicy;
  readonly kinetics: KineticsPolicy;
  readonly detect: DetectPolicy;
  readonly group: GroupPolicy;
  readonly qualify: QualifyPolicy;
  readonly resolve: ResolvePolicy;
  readonly market: MarketPolicy;
  readonly rank: RankPolicy;
  readonly features: FeaturesPolicy;
  readonly explore: ExplorePolicy;
  readonly budget: BudgetPolicy;
  /**
   * A model, when one exists, arrives as a pure synchronous closure here. This is
   * the one field that makes "a rule today, a model tomorrow" a swap rather than a
   * rewrite — and it is why core never imports anything from ml/.
   */
  readonly scorers: Scorers;
}

/* ── the values ───────────────────────────────────────────────────────── */

/* Annotated as Policy before freezing, so every literal below is checked against the
   interface rather than inferred — an unknown key or a wrong unit fails here. */
const POLICY_V1: Policy = {
  /* v2 adds `market`. v3 adds the three `candidate*` fields to `resolve` — the document
     frequency ceiling that decides which of a story's own words are allowed to put a coin
     in the running. Bumped by hand, as the field's own comment requires: the hash already
     moved when the object grew a section, and a version string that did not move with it
     would make two genuinely different policies indistinguishable to a human reading a
     decision row. Any board built before this bump was built under a rule where the word
     "the" was evidence, and the version string is the only thing that says so.

     v4 adds `resolve.firstSightLookbackMs` — the backward reach of the candidate window
     for a story whose posts never carried a time. Bumped by hand for the same reason: a
     board built under v3 retrieved EVERY asset in the store for such a story, because the
     projector's "we cannot order this, so abstain" escape was spelled as a predicate that
     is true for every row. Rows built before this bump were judged against a window that
     was not a window, and the version string is the only thing that says so.

     v5 adds the five `group` fields the grouper could not be built without:
     `matchBar`, `matchWeights`, `minCarrierWeight`, `timeProximityTauMs` and
     `promoteMinDistinctSources`. Four of the ten M-codes named a threshold that did
     not exist anywhere — `M3_below_match_bar` had no bar to be below, and
     `M5_generic_carrier` had no floor to fall under — so the alternative to this
     bump was five numbers typed into core, which is the exact failure this file was
     created to end. Bumped by hand for the same reason as v3 and v4: any board built
     before this bump was built by a stage that could not join anything at all, and
     the version string is the only thing that says so.

     v6 adds the four `rank` fields the board could not be committed without —
     `kendallTauUnusable`, `kendallTauCeiling`, `exploreSlotShare`, `maxFeatureAgeS` —
     and the whole `features` block the wide vectors read. Three of the seven R-codes
     named a threshold that did not exist: `R5_features_stale` had no staleness bound
     to be older than, `R6_explore_slot` had no slot budget of its own and would have
     had to borrow ADMIT's draw over arrivals — a different population, a different
     cost, and a wrong `propensity` on every rank row — and the stability metric had a
     floor but not the ceiling its own file says is the half that catches a dead
     ranker. Bumped by hand for the same reason as v3, v4 and v5: any board built
     before this bump was built by a stage that could not rank anything at all, and
     the version string is the only thing that says so.

     v6 ALSO carries DETECT, TRACK and the author prior, which were built in the same
     window and share the hash. One version string, one hash, one changelog entry —
     splitting them into v6 and v7 would suggest a policy existed in between that never
     judged a decision.

       · DETECT gains `countWindowMin`, `dispersionByKind`, `dispersionFloor`,
         `selfBaselineReads` and `baselineShrinkage`, and REPLACES `absoluteFloor` with
         `absoluteFloorByKind`. `eta`'s two arguments are a count in a window and a mean
         in that window, and no field named the window — so `Baseline.expectation` had no
         unit, and two callers could have produced two different baselines from the same
         history with nothing recording which. The scalar floor is replaced rather than
         kept because 50 reproductions and 50 impressions are not the same claim, and
         `admit/stage.ts`'s first rule forbids exactly that shape.

       · TRACK gains the three lifecycle bars `kinetics/lifecycle.ts` says come from
         `Policy.track` — `lifecycleMargin`, `agreeingToRise`/`agreeingToFall`/
         `agreeingToDormant`, `minLifecycleDwellMs` — none of which existed, so
         `T3_terminal` could not be produced at all. It LOSES `track.holdoutRate`, which
         was declared, never read, and held a duplicate of `explore.holdoutRate`; the
         note on TrackPolicy says why a second copy of that particular number is worse
         than none.

       · ADMIT gains the whole `admit.roster` block. `admit.weights.authorRosterTier`
         is 0.3 — the largest weight in the admission score — and the function that
         produces the number it multiplies had no field to read, no shrink target it
         could see (it is handed one author and cannot compute a population mean), and
         no way to weight four outcome counts against each other. */
  version: 'policy.v6',

  admit: {
    maxAgeMin: 240,
    quantile: 0.88,
    quantileFloor: 0.7,
    quantileCeiling: 0.98,
    dailyAdmitTarget: 1200,
    weights: {
      authorRosterTier: 0.3,
      carrierAcceleration: 0.25, // corpus-relative: available at ZERO engagement
      hasMedia: 0.2,
      reproductionLevel: 0.15, // a LEVEL, not a rate
      namedSpanPresent: 0.1,
      engagementBait: -0.35,
      threadContinuation: -0.25,
    },
    roster: {
      shrinkageStrength: 10,
      halfLifeDays: 90,
      /* Not zero, and not the mean of any measured corpus yet, because no corpus of
         author outcomes exists — `internal.decisions` has never held a row, so there
         is nothing to average. It is set low enough that an unknown account cannot
         ride this term into an admission on its own (0.3 × 0.15 = 0.045 of a score
         whose bar is the 88th percentile of the day) and high enough that "we have
         never seen you" is visibly not the same as "we have seen you fail". */
      populationMean: 0.15,
      weights: {
        itemsJoinedStory: 0.2, // common and cheap
        storiesQualified: 0.3,
        storiesResolved: 0.5, // "sparse and slow" — prior.ts's own words
      },
    },
  },

  track: {
    tierMinutes: [4, 9, 14, 21, 30, 42, 58, 78],
    tierCutoffs: [0.9, 0.75, 0.6, 0.45, 0.3, 0.2, 0.1],
    /* holdoutRate deleted in v6 — see the note on TrackPolicy. explore.holdoutRate is
       the single source, and it is the one every live call site already read. */
    shedFromTier: 0,
    maxTrackedHours: 168,
    flatReadsToDemote: 3,

    lifecycleMargin: 0.1,
    /* 2 / 4 / 6. The ordering is the cost of being wrong on each edge, and the edges
       are not symmetric: entering `rising` buys a few extra reads, leaving it stops
       the dense reading at the moment density was worth paying for, and entering
       `dormant` ends the item's history at whatever length its early performance
       bought — which is the one error that cannot be undone by the next reading. */
    agreeingToRise: 2,
    agreeingToFall: 4,
    agreeingToDormant: 6,
    /* Ten minutes. The top of the read grid is four, so a dwell of ten spans at
       least two reads at every tier — which is what makes "consecutive readings
       agreed" a statement about elapsed time rather than about queue depth. */
    minLifecycleDwellMs: 600_000,
  },

  kinetics: {
    fastTauMin: 20,
    slowTauMin: 360,
    stepSafetyFactor: 1,
    minElapsedMs: 30_000,
    nonMonotonicTolerance: 0.02,
  },

  detect: {
    etaSelfBar: 3,
    etaPopulationBar: 2.5,
    /* Arrivals in countWindowMin, per kind. The old single `absoluteFloor: 50` is
       spread across the kinds here in the ratios their own meanings imply, holding
       `conversation` at the original 50 as the anchor:

         reproduction   25   the thesis counter, and the rarest. Twenty-five people
                             making their OWN version inside twenty minutes is not a
                             busy afternoon on any source, it is an event.
         conversation   50   the anchor — the shipped number, unchanged.
         retention      50   a private, deliberate act; roughly conversation's rate.
         rebroadcast   100   cheaper than a reproduction by exactly the authorship it
                             does not create, so it takes more of them to say as much.
         approval      250   one tap, the cheapest positive there is.
         reach       5_000   impressions-like, and the kind where a shared number is
                             least defensible — which is why it is last in
                             preferredCounters and only ever drives the statistic when
                             a source publishes nothing better.

       Not swept. There is nothing to sweep against: no observation corpus exists. */
    absoluteFloorByKind: {
      reproduction: 25,
      conversation: 50,
      retention: 50,
      rebroadcast: 100,
      approval: 250,
      reach: 5_000,
    },
    burstBar: 1.35,
    minBaselineReads: 2,
    /* rebroadcast and retention are absent on purpose. A rebroadcast creates no new
       authored object — vocabulary.ts calls the distinction "the product thesis
       expressed as a type" — and retention is invisible on most sources. Neither may
       be the counter a burst claim rests on while a better one is present. */
    preferredCounters: ['reproduction', 'conversation', 'approval', 'reach'],
    countWindowMin: 20, // equal to kinetics.fastTauMin; see the field's comment
    /* All below 2, all unmeasured, all erring toward overdispersion because that error
       costs silence and the other costs a false-positive generator pointed at exactly
       the accounts an adversary can create for free. */
    dispersionByKind: {
      reach: 0.6, // cascades: one large-audience resharer drags the whole distribution
      rebroadcast: 0.8,
      reproduction: 1,
      conversation: 1.2,
      approval: 1.5, // one-tap acts by individuals: closest to independent arrivals
      retention: 1.5,
    },
    dispersionFloor: 0.1,
    selfBaselineReads: 12,
    baselineShrinkage: 10,
  },

  group: {
    imageHashMaxDistance: 31,
    imageHashBits: 256,
    textHashMaxDistance: 3,
    textHashBits: 64,
    minShingles: 6,
    similarityBars: {},
    adjudicationBand: 0.05,
    matchBar: 0.3,
    /* Read these as "what would this signal alone be worth". Three properties are
       deliberate and are asserted in core/src/group/stage.test.ts, because a weight
       table with no properties is just seven numbers somebody typed:

         · lineage is the largest, because it is the only signal where the SOURCE
           says the two items are related. Everything else is us inferring it.
         · every carrier weight alone clears matchBar, so the free tiers each carry
           a join on their own and the paid tier is never a precondition for one.
         · sourceAgreement + timeProximity together do NOT clear matchBar. Two posts
           being close in time on a story that already spans sources is
           corroboration, not identity, and a pair of coincidences must never add up
           to a join by itself. That is the property that stops a busy hour from
           merging everything posted during it. */
    matchWeights: {
      imageCarrier: 0.55,
      textCarrier: 0.35,
      exactCarrier: 0.4,
      lineage: 0.6,
      representation: 0.35,
      sourceAgreement: 0.05,
      timeProximity: 0.1,
    },
    minCarrierWeight: 0,
    timeProximityTauMs: 21_600_000,
    persistenceBuckets: 14,
    persistenceDfFloor: 3,
    promoteMinMembers: 3,
    promoteMinDistinctAuthors: 2,
    promoteMinDistinctSources: 1,
    mergeCarrierOverlap: 0.6,
    maxMembersPerInterval: 200,
  },

  qualify: {
    minDistinctAuthors: 2,
    minMembers: 3,
    minNameLen: 3,
    minSpecificity: 0.35,
    authorBreadthFull: 12,
    passScore: 0.55,
    nameabilityCapFloor: 0.4,
    weights: {
      judgeConfidence: 0.4,
      specificity: 0.3,
      crossSource: 0.15,
      authorBreadth: 0.15,
    },
    batchSize: 10,
  },

  resolve: {
    minLagMs: 0,
    maxLagMs: 21_600_000, // six hours
    maxCandidates: 500,
    firstSightLookbackMs: 86_400_000, // one day; the sweep and the asymmetry are on the field

    /* SWEPT, not picked. Over the 205 assets currently in public.asset (192 real mints +
       13 seeded), holding the candidate set of all six stories fixed against a hand-labelled
       truth set of 33 pairs:

         K = 24+   no-op: the most common word in the corpus is "the" at df 23.
         K = 6..23 every story keeps its correct claimants; the soup row goes 17 → 6.
         K = 5     drops "soup" (df 5, because the soup story's own five coins are what made
                   it common) and takes five true claimants with it.
         K = 3     drops "chill" and hides a coin the row would otherwise have NAMED.
         K = 2     the chill row projects `none` while three CHILLGUY coins sit in the store.

       6 is the bottom of the safe band, chosen at the bottom because the errors are not
       symmetric: too loose inflates the claim count and the row says "unsure" and offers
       nothing, while too tight says "none" and offers CREATE on a coin that already exists.

       ★ WHAT WOULD CHANGE THESE NUMBERS, and it is a specific thing to watch for: a story's
       own success raises its own word's df. All five assets carrying "soup" are the soup
       story's coins. So this ceiling is also a cap on how many coins one moment may spawn
       before the rule stops seeing any of them. If a real moment ever spawns more than K
       coins, the answer is NOT to raise K — it is to bound the corpus in time (df over the
       last N mints, or the last 24h) so a story's cluster stays small against a denominator
       that no longer grows forever. At 205 documents that is not yet a live problem: "soup"
       occurred zero times in 192 unrelated real mints. */
    candidateDfFloor: 6,
    candidateDfFraction: 0.03,
    candidateMinTokenLength: 2,
    majors: [],
    probeNotionalUsd: 25,
    maxAllInBps: 1500,
    tauHigh: 0.72,
    deltaMargin: 0.15,
    minVenueLabels: 200,
    scoreWeights: {
      temporal: 0.3,
      symbol: 0.25,
      semantic: 0.25,
      image: 0.15,
      declared: 0.05,
    },
  },

  market: {
    readingFreshnessMs: 300_000, // five minutes
    maxAssetsPerPass: 300,
  },

  rank: {
    alpha: 0.85,
    gamma: 1.35,
    t0Min: 12,
    slots: 20,
    tickS: 20,
    swapEdge: 0.08,
    ticksToEnter: 2,
    ticksToLeave: 3,
    minDwellS: 90,
    maxPositionsMovedPerTick: 5,
    newEntrantBurst: 3,
    kendallTauFloor: 0.9,
    kendallTauUnusable: 0.85,
    kendallTauCeiling: 0.98,
    exploreSlotShare: 0.1,
    maxFeatureAgeS: 300, // one tier-0 re-read interval (4 min) plus a minute of slack
  },

  features: {
    /* Thirty is where a percentile stops being an anecdote. Under it the corpus terms
       are null and `corpusItems` beside them says why — a percentile over four
       samples is not a percentile, it is a rank with a decimal point on it. */
    minCorpusItems: 30,
    /* a₀ = 1 arrival over b₀ = 10 minutes: a prior mean of a tenth of an arrival a
       minute, deliberately low. The prior is doing one job — stopping a brand-new
       item with one lucky reading from outranking an item with an hour of evidence —
       and b₀ is the number that does it, because b₀ is denominated in the same units
       as the observation window and therefore sets how much a short window counts.

       What it costs, measured against the read grid it will actually meet: a rate
       observed over five minutes keeps about a quarter of its raw value once shrunk
       and bounded; the SAME rate sustained for an hour keeps about five sixths of it.
       That gap is not a side effect, it is the feature. b₀ sits at ten minutes so the
       first tier-0 re-read — four minutes in — is visibly discounted rather than
       trusted, which is the moment the small-sample error is largest and the moment
       the board is most tempted to believe it. */
    ratePrior: {
      priorArrivals: 1,
      priorExposureMin: 10,
      lcbQuantile: 0.1,
    },
    recentWindowMin: 30,
  },

  explore: {
    epsilon: 0.1,
    holdoutRate: 0.02,
    holdoutSalt: 'holdout.v1',
    dropLogSampleRate: 0.1,
    fullFidelityDays: 90,
  },

  budget: {
    dailyUsd: 12,
    discoveryUsdPerDay: 5,
    observeUsdPerDay: 4,
    judgeUsdPerDay: 2,
    quoteUsdPerDay: 1,
    softStopFraction: 0.9,
  },

  scorers: {
    admit: null,
    track: null,
    detect: null,
    group: null,
    qualify: null,
    resolve: null,
    rank: null,
  },
};

/** The policy in force. Frozen: a policy edited mid-run makes its own hash a lie. */
export const DEFAULT_POLICY: Policy = deepFreeze(POLICY_V1);

/**
 * Freezes in place and returns the same object. Recursive, because a shallow freeze
 * leaves every nested threshold writable and a mutated threshold makes the policy
 * hash on every decision it produced a lie.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
