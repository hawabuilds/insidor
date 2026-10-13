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
import type { JudgeEvidence } from './judgement.ts';

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
  /**
   * How old a post may be, in minutes at its last read, and still sit on each tier. A post
   * older than `ageTierMinutes[i]` is read no faster than tier `i + 1`. Same length as
   * tierMinutes − 1, ascending.
   *
   * ★ WHY AGE AND NOT ONLY SCORE. The score ladder needs a fresh score, and the only score a
   * post has today is ADMIT's, fixed at admission — so every post sat on one tier for its
   * whole life and a minutes-old post was read no more often than a day-old one. Views move
   * fastest in a post's first hours; this is the rule that spends reads there. It is a
   * FLOOR: the score ladder and flat-read demotion can still slow a post, never speed it
   * past what its age allows. The holdout ignores it, as it ignores every other ladder.
   */
  readonly ageTierMinutes: readonly number[];
  /**
   * The earlier build's snapshot tiers, for a post's first hours. Within `youngWindowMin`
   * of its post time, tracked posts are ranked by how fast their views are rising: the
   * fastest `velocityShares.hot` are re-read every `velocityMinutes.hot`, the next
   * `velocityShares.warm` every `.warm`, the rest every `.cold`. A post with no view rate
   * yet sits on warm — an absence is neither rewarded nor punished. After the window the age
   * ladder above takes over. Unlike the earlier build, nothing stops being read at the end
   * of the window and nothing cold is pruned: a history whose length depends on early
   * performance is conditioned on the outcome (see core/src/track/schedule.ts).
   */
  readonly youngWindowMin: number;
  readonly velocityShares: { readonly hot: number; readonly warm: number };
  readonly velocityMinutes: { readonly hot: number; readonly warm: number; readonly cold: number };
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
  /**
   * ★ HOW OFTEN A POST FROM A SOURCE THAT BILLS EVERY RE-READ AS A RUN IS RE-READ, once it is not
   * a young post growing fast (`paidFastMinReachPerMinute`), in minutes. A text post's re-read
   * costs $0.00015; a short video's is a scraper run at $0.001 plus $0.003 a post, twenty times as
   * much, and the four-minute top tier would spend the source's whole line on re-reads by midday.
   * Which posts go into a run, and how many: services/runner/src/work/paid-reads.ts.
   */
  readonly paidReadMinMinutes: number;
  /**
   * The closest together two re-read runs on such a source may go out, in minutes. Every post due
   * goes into the next run together, so one run's start fee covers them all and TRACK is not held
   * by a run that takes a minute or two more often than this.
   */
  readonly paidRunEveryMinutes: number;
  /**
   * ★ THE MOST POSTS ONE SUCH RUN READS, AND THE CAP THAT HOLDS RE-READS INSIDE THEIR SHARE OF THE
   * LINE. The short-video line is $3 a day; discovery may plan `feed.budgetShare` (60%) of it,
   * $1.80 — an ask of 20 at $0.101 every 81 minutes. Re-reads have the other $1.20: 48 runs a day
   * (one every `paidRunEveryMinutes`) × ($0.001 + 8 × $0.003) = $1.20. So 8, and a slower post
   * waits for a later run when young fast ones fill one.
   */
  readonly paidReadMaxPosts: number;
  /**
   * ★ A YOUNG SHORT VIDEO GROWING AT LEAST THIS MANY VIEWS A MINUTE IS RE-READ ON EVERY RUN, while
   * it is inside `rising.fypMaxAgeMs` — so the growth paths get the second and third readings
   * they need, instead of one three hours later. Views a minute between its last two readings, or
   * since it was posted when it has one. 250: the newest-first search on 2026-10-13 14:05 UTC
   * found its fastest under-an-hour videos at 280 to 480 a minute and the rest under 150; the
   * most-liked search's young ones were at 310 and 580. A raw view rate, not scaled by
   * `rising.shortVideoReachScale`: it is measured on this source alone.
   */
  readonly paidFastMinReachPerMinute: number;

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
  /**
   * Post images sent to the embedding vendor per discovery pass, newest first. The rest wait
   * for the next pass; the embeddings supplier line, paced over the day, is the real limit.
   */
  readonly imagesPerPass: number;
  /**
   * The picture evidence, read from image embeddings in one space (`space`):
   *
   *   similarity ≥ nearIdentical   the same picture, edited (cropped, captioned, filtered) —
   *                                joins on its own, as a near-copy hash would
   *   ≥ likely                     likely the same subject — joins only TOGETHER WITH a name
   *                                match (the judge's name for the post and the story's)
   *   ≥ borderline                 ask the judge "is the main subject the same?"; only "yes"
   *                                counts, and then as `likely` — still needing the name
   *   below                        no picture evidence at all
   *
   * ★ NOT YET CALIBRATED. These are starting values for a 1,024-wide multimodal space, set
   * before any real pair was measured. GROUP logs every similarity it reads, so they can be
   * fit from the first week's pairs; until then treat a join on them as provisional.
   * `pairChecksPerDay` caps the judge questions; pairs past it simply do not join.
   */
  readonly image: {
    readonly space: string;
    readonly nearIdentical: number;
    readonly likely: number;
    readonly borderline: number;
    readonly pairChecksPerDay: number;
  };
  /**
   * The judge's name for a post, as a carrier (core/src/group/name-span.ts). A post's
   * proposed name becomes an exact carrier only when the name is WRITTEN in the post's own
   * words (or as one hashtag-style word), so it is a named span the post carries, not the
   * judge's guess about a picture. Measured on 36h of named posts (817): 425 such names, and
   * nearly every group of two or more posts read as one moment; an old post resurfacing under
   * a name a new story also had is kept out by `maxPostAgeMs`. In a replay of 13 October
   * (04:00–14:15 UTC) 28 posts joined on a name and 2 were wrong ("swarm" as a slogan and as
   * a product; "bull" and "bear" market chatter). Proposed names only, never the alternates,
   * which is where the bare common words are.
   *
   * `minChars` is on the name with its spaces removed: "pig" or "cat" alone is a word many
   * unrelated posts share. `maxPostAgeMs` is the oldest post, by its own post time when
   * seen, whose name may carry it: a days-old post found today is not today's moment.
   */
  readonly name: {
    readonly minChars: number;
    readonly maxPostAgeMs: number;
  };
  /**
   * Tags that say how a post is written, not what it is about — worth nothing as a carrier,
   * like the generic coin symbols (core/src/group/carriers.ts). Lower case, no sigil. With the
   * candidate window holding the whole 12h, "#BREAKING" alone put a politics post into the
   * roller-coaster story in a replay of 12 October.
   */
  readonly genericSpans: readonly string[];
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
  /**
   * ★ THE LEAST CONFIDENCE A "COINABLE" ANSWER MUST CARRY, PER WHAT THE JUDGE LOOKED AT.
   *
   * Read only when the judge said coinable, and only after the gates above have passed —
   * confidence is self-reported and is never a gate on its own (see judgement.ts). Below
   * the bar the story drops with `Q10_judge_unsure`. A missing judgement never reaches
   * this: it abstains with `Q1_unjudged` first.
   *
   * Keyed by EVIDENCE (`JudgeEvidence`), not by source, because the difference between
   * the two bars is what the judge could see, and a source name has no place here.
   */
  readonly minJudgeConfidence: Readonly<Record<JudgeEvidence, number>>;
  readonly weights: {
    readonly judgeConfidence: number;
    readonly specificity: number;
    readonly crossSource: number;
    readonly authorBreadth: number;
  };
  /** Stories per judge call. Most of the spend is one static prompt, retransmitted. */
  readonly batchSize: number;
}

/* ── JUDGE ────────────────────────────────────────────────────────────── */

/**
 * ★ HOW THE JUDGE IS CALLED: its transport, its cost estimate, and when a story is asked
 * again. Every number the judge adapter and the runner's judging step use, so neither
 * holds a bare literal (tools/check-policy.mjs) and every decision row carries the hash
 * of the settings it was judged under.
 *
 * The money itself is NOT here. What may be spent is `budget.dailyUsd` and
 * `budget.perSourceUsdPerDay`, enforced by the meter before every call; these numbers
 * only shape the call and the estimate it is checked against.
 */
export interface JudgePolicy {
  /** Tries per batch, the first included. A small bound: each retry is a wait and, on some errors, a charge. */
  readonly maxAttempts: number;
  /** The wait before the first retry. Doubles on each one after. */
  readonly backoffMs: number;
  /** The longest any single wait may be, whatever a retry-after header asks for. */
  readonly maxWaitMs: number;
  /** One request's wall-clock ceiling. */
  readonly timeoutMs: number;
  /** `max_tokens` on the request. Also the output side of the pessimistic estimate. */
  readonly maxOutputTokens: number;
  /**
   * The same, for a batch of single posts being scored. Each answer is short — a yes or no,
   * a name, a confidence — so ten fit well inside this, and the meter's reservation for a
   * batch stays near what it really costs rather than at double. An answer cut off by it
   * makes the batch unavailable: those posts wait and are asked again next pass.
   */
  readonly postBatchMaxOutputTokens: number;
  /** The answer budget for the same-subject question: one word in a small JSON object. */
  readonly pairMaxOutputTokens: number;
  /** For the pre-call estimate only: characters per input token, set low so the estimate runs high. */
  readonly charsPerToken: number;
  /** For the pre-call estimate only: input tokens one video frame costs. */
  readonly tokensPerFrame: number;
  /** A frame larger than this is not sent; the story is unavailable rather than judged blind. */
  readonly maxFrameBytes: number;
  /** Member texts sent per story, and the characters kept of each. */
  readonly maxTextsPerStory: number;
  readonly maxCharsPerText: number;
  /**
   * ★ WHEN A JUDGED STORY IS ASKED AGAIN: once its member count has grown by at least
   * this share since the judgement on record. A story is judged once, and a restart
   * reads that record rather than asking again.
   */
  readonly rejudgeGrowth: number;
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

/* ── ASSETS ───────────────────────────────────────────────────────────── */

/**
 * How long since we last heard anything from the feed that reports new assets, before
 * that feed stops being described as live.
 *
 * ★ THIS IS A THRESHOLD AND IT IS HERE FOR THE SAME REASON `readingFreshnessMs` IS. It
 * is the number that decides whether a rail headed "coins as they are minted" is allowed
 * to look current, and it is exactly the kind of number that ends up typed into a
 * projector as `10 * 60_000` and quietly doubled by whoever was on call the night the
 * watcher fell over. Written down here, changing it is a diff, and the rail a user saw
 * in March is answerable against the policy that was in force then.
 *
 * ★ THE FLOOR IS ARGUED, NOT TYPED. The mint watcher's transport already carries its own
 * "this socket is dead" bar (MINT_STREAM_STALE_MS in .env.example, ninety seconds), and
 * a projector that declared a feed dead while the transport still considered it alive
 * would be two processes disagreeing out loud on one screen. So this must sit at or
 * above that bar. Fifteen minutes is well clear of it and is chosen against the product's
 * own clock rather than as a round number: the rail's window is six hours wide, so a feed
 * silent for a quarter of an hour has already missed the interval a user would call
 * "now", while a market genuinely quiet for fifteen minutes is a market this feed has
 * nothing to say about either way. Much shorter turns every ordinary reconnect into a
 * banner, and a banner that is always up is a banner nobody reads.
 *
 * ★ AND WHY THE JUDGEMENT IS MADE SERVER-SIDE. The same argument `currentMarket` makes:
 * a threshold is our machinery, the client must never be handed one, and what crosses the
 * wire is the already-labelled result. The app receives "the feed is not live" and the
 * instant behind it; it does not receive the bar, and so cannot re-derive it.
 */
export interface AssetPolicy {
  /**
   * How stale the last observation on an asset feed may be while that feed is still
   * published as live. Past this the projection says so, and the surface says so.
   */
  readonly feedFreshnessMs: number;
  /**
   * How far back the "is this ticker taken" check looks over our own launch records.
   *
   * A ticker is not unique on a launchpad — one meme has spawned hundreds of coins sharing
   * one — so "taken" can only ever mean "somebody launched under it recently". Older than
   * this and the coin is history rather than a rival for the same moment.
   */
  readonly tickerLookbackMs: number;
  /**
   * The share of that lookback our launch watch must have covered, without a gap, before
   * finding no launch under a ticker may be said as "you'd be first". Below it the answer
   * is that we cannot tell: an unwatched hour is not an hour in which nobody launched.
   */
  readonly tickerMinCoverage: number;
}

/* ── INGEST ───────────────────────────────────────────────────────────── */

/**
 * How long a source we ingest FROM may be silent before it stops being described as
 * answering.
 *
 * ★ A SEPARATE NUMBER FROM `assets.feedFreshnessMs` AND THEY MUST NOT BE MERGED, for the
 * reason that file already gives about `market.readingFreshnessMs`: these measure different
 * things and happen to share a unit. `feedFreshnessMs` is about ONE transport reporting
 * coin mints on a socket, where a ninety-second stale bar already exists downstream and
 * fifteen minutes is generously clear of it. This is about a set of PAID, POLLED APIs whose
 * pass intervals are a cost decision, not a transport property — and a bar tight enough to
 * fire on a deliberately infrequent pass turns "we chose to spend less" into "this is
 * broken", which is the exact conflation the three-way source state exists to prevent.
 *
 * ★ THE FLOOR IS ARGUED, NOT TYPED, and it is the same argument `feedFreshnessMs` makes.
 * The runner's own staleness rule is three cadences (`STALE_AFTER_CADENCES` in
 * services/runner/src/health.ts, `staleCadences` in the watchdog), and the stage cadences
 * this repository's own configuration examples use are measured in tens of seconds — so
 * three cadences is single-digit minutes. This must sit well above that, or the projector
 * would call a source dead while the loop that reads it still considers itself healthy, and
 * two processes would disagree out loud on one screen.
 *
 * ★ THE CEILING IS THE PRODUCT'S CLOCK. Half an hour is chosen against what this board
 * claims to be: a story that started thirty minutes ago and was never fetched is a story
 * the board is silently missing, and on a product whose whole pitch is earliness that is
 * already past any interval a user would call "now". Much longer and the indicator agrees
 * that a source is live through an outage long enough to have cost us the thing we sell;
 * much shorter and every ordinary gap between paid passes lights a fault, and an indicator
 * that is always red is an indicator nobody looks at.
 *
 * ★ AND WHY THE JUDGEMENT IS MADE SERVER-SIDE. The same argument `currentMarket` and
 * `projectFeedSource` both make: a threshold is our machinery, the client is never handed
 * one, and what crosses the wire is the already-labelled result. The app receives the word
 * "failing" and the instant behind it; it does not receive the bar, so it cannot re-derive
 * the call and disagree with us about it.
 */
/**
 * The catch-all search: no keywords, two lanes (everything, and posts with an image or a
 * video), each narrowed by an approval floor that moves to keep the day inside budget.
 *
 * ★ THE FLOOR IS A COST CONTROL, NOT ADMISSION. With no keyword the only thing standing
 * between a search and every post in the language is the floor, so the floor is what the
 * budget turns. ADMIT still decides on rates; a post that clears this floor has merely
 * been paid for.
 *
 * Ported from the earlier build's ingest (its query builder and adaptive lane floors), with
 * the per-pass read target derived from the daily budget instead of typed in.
 */
export interface FeedPolicy {
  /** How far back the main lanes reach, in minutes: posts in their first ten. */
  readonly windowMin: number;
  /**
   * The window at which the floor applies in full. A shorter window scales it down in
   * proportion: a post has had less time to collect approvals, so it is asked for fewer.
   */
  readonly fullWindowMin: number;
  /** Where each lane's floor starts before it has adapted. */
  readonly startFloor: number;
  readonly mediaStartFloor: number;
  /** The base floor never adapts below this, nor above floorMax. */
  readonly floorMin: number;
  readonly floorMax: number;
  /** The floor actually sent, after window scaling, is never below this. */
  readonly effectiveFloorMin: number;
  /** A lane that returned more than its target raises its floor by this factor. */
  readonly raiseFactor: number;
  /** A lane under `lowBand` × target lowers it by this factor. */
  readonly lowerFactor: number;
  readonly lowBand: number;
  /** A lane that returned nothing lowers it by this factor, at once. */
  readonly emptyFactor: number;
  /** The share of the daily budget catch-all search may plan to spend. Re-reads need the rest. */
  readonly budgetShare: number;
  /** The share of each pass's posts the media lane is aimed at. */
  readonly mediaShare: number;
  /**
   * Language codes a post may be in; empty for all. ★ A PRODUCT CHOICE WITH A COST: a language
   * filter makes every post in every other language invisible. English, plus `zxx` — the code the
   * platform gives a picture or video with no words, which is how 4 of the gold set's missed
   * origin posts were filtered out (eval/src/gold/recall-report.md; about $0.10 a day more).
   */
  readonly langs: readonly string[];
  /**
   * ★ THE OWNER'S HASHTAG WATCH (2026-10-13), edited here. A source that cannot search everything
   * — the short-video source can only enter by hashtag or account — watches these instead of a
   * catch-all lane, each a pass, newest first. Without a '#'; the adapter adds what it needs.
   */
  readonly hashtags: readonly string[];
  /** Posts asked for per hashtag ask: a run bills per post returned, so this is the ask's price. */
  readonly hashtagResults: number;
  /**
   * The oldest a watch-list post may be and still be judged and shown. The short-video search is
   * asked for its most-liked videos of the past day; anything older the vendor sends anyway is
   * stored and never credited to the watch lane (0061), so it never reaches the feed.
   */
  readonly watchMaxAgeMs: number;
  /**
   * Posts asked for per lane per pass: one page. Also the reservation the budget is
   * checked against before the call, since a source picks its own page size.
   */
  readonly pageLimit: number;
  /**
   * Pages per lane per pass, at most — the earlier build's three. A lane asks for its next
   * page only when the one before came back FULL and the source says there is more; a short
   * page means the window is exhausted. Each page is checked against the posts supplier's
   * paced line before it is asked for, so the line, not this number, is the limit on a busy
   * day.
   */
  readonly maxPagesPerLane: number;
  /**
   * ★ THE SLOW-BURN LANE — the earlier build's SLOW_BURN_EVERY_MS. The main lanes only see a
   * post in its first `windowMin`, so a post that takes an hour to cross the floor is never
   * seen at all. This lane looks back `windowMin` (hours, not minutes) every `everyMs`, with a
   * floor never below `floorMultiple` × the main lane's sent floor so it returns the posts
   * that kept going rather than the whole afternoon again. One page per time slice (`slices`),
   * on the same posts line.
   */
  readonly slow: {
    readonly windowMin: number;
    readonly everyMs: number;
    readonly floorMultiple: number;
    /**
     * ★ HOW THE SIX HOURS ARE ACTUALLY REACHED: in this many time slices, one page each. Asked
     * newest first over the whole window, three pages filled inside the newest hour (2026-10-13:
     * every pass returned 60, the oldest 66 minutes old), so nothing older was ever seen. Now
     * slice k asks for the posts aged k·(windowMin/slices) minus `everyMs` to k·(windowMin/slices)
     * minutes, at the lane's floor — six quarter-hour bands, one at each hour of age. The bands
     * move a quarter-hour each pass, so every post is looked at once as it turns one, two, … six
     * hours old. Six pages a pass where it was three: about $0.86 a day more at worst on the posts
     * line ($1.73 against $0.86), and the floor's target keeps the usual day near $1.20.
     */
    readonly slices: number;
    /**
     * The share of the catch-all's money its floor steers toward. The rest is the main
     * lanes'. A target, not a reservation: the paced line is still the only limit.
     */
    readonly share: number;
  };
}

/**
 * ★ WHERE A NARRATIVE STARTED, looked for once a story is promoted. We often catch a moment
 * late; the post that began it is usually one quote away, or posted an hour before our
 * first member. Each promoted story is backfilled once, and again only when new members
 * arrive; every number here bounds what one backfill may cost.
 */
export interface BackfillPolicy {
  /** Stories backfilled per pass, oldest promotion first. The rest wait. */
  readonly storiesPerPass: number;
  /** Backfills started per UTC day, at most. */
  readonly storiesPerDay: number;
  /** How many quotes back a chain is followed before we stop and call what we have the root. */
  readonly maxReproductionHops: number;
  /** Posts fetched by id per story, across every hop. */
  readonly maxReproducedPosts: number;
  /**
   * Posts asked for by the one search back for the story's name, ending at our earliest
   * post. The source returns the newest first, so this is the stretch just before we caught
   * the story; each later backfill (after new members, and an earlier earliest post) reaches
   * further back from there.
   */
  readonly searchResultCap: number;
}

/**
 * ★ THE COIN UNIVERSE: every new coin indexed, its metadata read, its origin checked. Every
 * number bounds how much one pass may do; the supplier lines bound what it may spend.
 */
export interface UniversePolicy {
  /** Coins whose metadata is read per pass, newest first, and how many at once. */
  readonly metadataPerPass: number;
  readonly metadataConcurrency: number;
  /** A metadata read is abandoned after this long, or this many bytes. */
  readonly metadataTimeoutMs: number;
  readonly metadataMaxBytes: number;
  /** Reads of a document the gateway could not serve, before it is left unread. */
  readonly metadataAttempts: number;
  /** Coins whose origin is checked per pass, newest first. */
  readonly checksPerPass: number;
  /** How far back a coin is still picked up, by when we first saw it. */
  readonly lookbackMs: number;
  /** How long before a coin's launch a post we hold may be its origin. */
  readonly matchWindowMs: number;
  /** Posts naming a coin compared per check, oldest first. */
  readonly candidatesPerCoin: number;
  /** An `unlinked`, `account_only` or `promo_only` coin is looked at once more after this. */
  readonly recheckAfterMs: number;
  /**
   * ★ THE SAME PICTURE LEADS BACK. Once a post that names the coin and shows its subject is
   * matched, the earliest post we hold with that post's own picture (group.image.nearIdentical),
   * named or not, becomes the origin — a repost rarely carries the coin's exact name. How far
   * before the launch such a post may be, and how many are read per coin, earliest first. A
   * picture without a named, pictured post never links anything.
   */
  readonly pictureLookbackMs: number;
  readonly picturePostsPerCoin: number;
  /**
   * ★ LOOKING UP COINS WE NEVER SAW MINTED. A promoted narrative or a For You post with no coin
   * has its name searched on the market data sources; launchpad coins launched within
   * `withinMs` go into the universe as CANDIDATES and through the same checks as any coin. A
   * search result alone never links anything.
   */
  readonly lookup: {
    /** Names searched per pass, and per UTC day at most. */
    readonly termsPerPass: number;
    readonly perDay: number;
    /** A name searched less than this long ago is not searched again. */
    readonly keepMs: number;
    /** How recent a launch a candidate may be. */
    readonly withinMs: number;
    /** Candidates kept per name, newest launch first. */
    readonly hitsPerTerm: number;
    /**
     * Names searched for one subject: the judge's proposed name, then its alternates. Each name
     * is a search on every source, so a pass takes `termsPerPass / namesPerSubject` subjects and
     * the per-minute rate holds in calls, not subjects.
     */
    readonly namesPerSubject: number;
    /**
     * Names searched per minute, across passes, so no source blocks us. The on-chain search runs
     * on the owner's paid market-data plan (500 calls a minute, shared with the read service's
     * and the projector's market reads); the other search source allows 300. Every post in the feed should be
     * looked up within about a minute of entering it, which this rate covers many times over.
     */
    readonly perMinute: number;
    /** A failed search is tried again this many times before it is given up. */
    readonly retries: number;
    /** A post still not looked up this long after entering the feed shows "Couldn't check". */
    readonly giveUpMs: number;
  };
  /**
   * ★ WHICH COINS THE UNIVERSE KEEPS. Every coin chainwatch sees is kept for `allMs`. After that a
   * coin stays only if it matters: a narrative or a post names it, it bonded, it is in the gold
   * set, or its market cap reached `marketCapUsd` — the rest are deleted. A coin is asked about
   * once, when it ages out; a coin no market lists was never traded and goes.
   */
  readonly keep: {
    readonly allMs: number;
    readonly marketCapUsd: number;
    /** Coins asked about per pass, and deleted per pass at most. */
    readonly checksPerPass: number;
    readonly deletesPerPass: number;
  };
  /**
   * The history pilot: coins still alive today, grouped into narratives, each narrative's origin
   * found once and kept forever (tools/history-pilot.ts). Alive means a market cap today of at
   * least `aliveMarketCapUsd`; the whole pilot may spend at most `pilotUsd`.
   */
  readonly history: {
    readonly aliveMarketCapUsd: number;
    readonly pilotUsd: number;
    /** The fake-coin filter (the owner's, 2026-10-13): a coin needs this much pool liquidity now… */
    readonly minLiquidityUsd: number;
    /** …and this many wallets holding it, or the pilot does not pay to look at it. */
    readonly minHolders: number;
  };
}

/**
 * Buying and selling (services/trade). Everything here is behind the TRADING switch, which is off
 * unless the deploy turns it on, and the allowlist of wallets, which is empty unless it names one.
 */
export interface TradePolicy {
  /** The most one buy may spend, in SOL. Sells are bounded by what the wallet holds. */
  readonly maxSolPerTrade: number;
  /** Slippage offered by default, and the most a person may choose, in basis points. */
  readonly defaultSlippageBps: number;
  readonly maxSlippageBps: number;
  /** Insidor's own fee on a trade, in basis points. Off; turned on only by the founders. */
  readonly platformFeeBps: number;
  /** The size asked about to tell whether a coin can be traded at all, in SOL. */
  readonly probeSol: number;
  /** The most a creator may buy of their own coin at launch, in SOL. */
  readonly maxDevBuySol: number;
}

/**
 * The Wallet tab (services/read, GET /wallet/:address): read-only chain data, cached and paced
 * so free RPC and parsing tiers last.
 */
export interface WalletPolicy {
  /** One wallet's answer is kept this long. */
  readonly keepMs: number;
  /** Reads one client may make per `windowMs`. */
  readonly perClient: number;
  readonly windowMs: number;
  /** Most coins shown, biggest value first; the rest are counted, not listed. */
  readonly holdingsShown: number;
  /** Recent transactions read for buy history. Older buys are not seen, and the screen says so. */
  readonly signaturesRead: number;
  /** The balance chart's spacing: a wallet adds a point at most this often (Trador's ten minutes). */
  readonly snapshotGapMs: number;
}

/**
 * The Search tab: a person's term, searched live against the market data sources and our own
 * rows. No new table; every answer is held in memory for `keepMs`.
 */
export interface SearchPolicy {
  /** One answer per term is kept this long, so a crowd typing the same ticker costs one call. */
  readonly keepMs: number;
  /** Searches one client may run per `windowMs`. Past it, the reply says to wait. */
  readonly perClient: number;
  readonly windowMs: number;
  /** The shortest and longest term searched. */
  readonly minTermLength: number;
  readonly maxTermLength: number;
  /** Rows per section. More than this and the reply says "Showing top results". */
  readonly storiesShown: number;
  readonly postsShown: number;
  readonly coinsShown: number;
  /** Curve accounts read per search, biggest coins first; the rest show their progress as a dash. */
  readonly curvesRead: number;
  /** How long a coin a search returned may be opened as a token page without being in the universe. */
  readonly openableMs: number;
}

/**
 * The rules that decide a coin's origin status (contracts/src/origin.ts).
 */
export interface OriginPolicy {
  /**
   * ★ AN ORIGIN IS POSTED BEFORE THE COIN, with this much grace for a launch made in the same
   * moment as its post — the founders' rule. A post later than the mint by more than this is
   * `viral_after_launch`: kept and shown, never counted as where the coin came from.
   */
  readonly launchAllowanceMs: number;
  /**
   * A creator-linked post by an account with at least this many followers, saying something
   * rather than showing a subject, is an influencer's or founder's statement — `influencer_origin`.
   * ★ UNCALIBRATED: a first guess, to be read against the gold set before RESOLVE is switched on.
   */
  readonly influencerFollowers: number;
  /**
   * A creator-linked post with a nameable subject and at least this much reach is the viral
   * meme the coin came from — `linked_by_creator`. ★ UNCALIBRATED, as above.
   */
  readonly viralReach: number;
}

/**
 * The For You and Popular feeds of single posts, and the per-post score that admits a post
 * to them. A post shows when the catch-all search found it AND the judge, shown that post
 * alone, called it coinable at or above `qualify.minJudgeConfidence` for what it looked at
 * — the earlier build's rule. See docs/rising-posts-plan.md for the projection.
 */
export interface RisingPolicy {
  /** How long a post stays eligible after it was posted, and how far back Popular counts. */
  readonly windowMs: number;
  /** Rows per feed. */
  readonly maxRows: number;
  /**
   * Posts sent to the judge per discovery pass, newest first. The rest wait for the next.
   * Above what one pass brings in, so the queue drains: at 20 a pass that found 180 posts left
   * 160 unscored for good. The judge's own line (`budget.supplierLines.judge`, paced over the
   * day) is what bounds the cost; a post the line cannot afford waits, hidden.
   */
  readonly postsPerPass: number;
  /**
   * ★ THE JUDGE'S OWN NAME TEST, HELD BY CODE. The prompt says a subject has a short name that
   * could become a ticker — "one word, or a few words run together". A single-post "yes" whose
   * proposed name is longer than this many words is a headline described, not a subject named
   * ("Kacey Musgraves dog shot response"), and does not reach the feed. No name at all fails too.
   */
  readonly maxNameWords: number;
  /**
   * ★ THE REACH BARS. A post reaches For You at `fypMinReach`, OR earlier when it is taking off:
   * `fypEarlyReach` within `fypEarlyWindowMs` of being posted, or `fypFastReachPerMinute` on
   * average at any reading inside `fypFastWindowMs`. Popular needs `popularMinReach`. A post
   * whose reach we have not read is on neither: an unread count is not a small one.
   *
   * The owner's numbers (2026-10-13), the growth paths tightened the same day (below). Checked against the gold sheets: a third of coins launch
   * within 30 minutes of their post, which only the growth paths can catch in time; 4 of 41
   * origin posts never passed 60k reach at all, and 40k shuts those out.
   */
  readonly fypMinReach: number;
  readonly fypEarlyReach: number;
  readonly fypEarlyWindowMs: number;
  readonly fypFastReachPerMinute: number;
  readonly fypFastWindowMs: number;
  readonly popularMinReach: number;
  /**
   * ★ FOR YOU IS FRESH. A post older than `fypMaxAgeMs` leaves For You unless it is still growing
   * fast: its newest view reading is under `fypGrowthWindowMs` old, and between it and the
   * earliest reading in the `fypGrowthWindowMs` before it — at least `fypGrowthMinSpanMs` apart —
   * it gained `fypStillGrowingPerMinute` views a minute or more (times `shortVideoReachScale` for a
   * short video). A stale newest reading says nothing about now, so it never keeps a post. Popular
   * has no age limit inside `windowMs`. The owner's rule (2026-10-13): six hours. Measured that day
   * on the 14 For You posts: 8 were over six hours old, gaining 11 to 2,079 views a minute over
   * their last hour; at 1,000 a minute one stays (1.1M views, 2,079 a minute) and 7 leave. At 500
   * a minute a second (567 a minute) would stay.
   */
  readonly fypMaxAgeMs: number;
  readonly fypGrowthWindowMs: number;
  readonly fypGrowthMinSpanMs: number;
  readonly fypStillGrowingPerMinute: number;
  /**
   * ★ WHICH UNJUDGED POSTS GET PAID RE-READS. The judge only sees a post once its reach clears a
   * For You bar, and only a re-read can show that it has. A catch-all post nobody has judged yet
   * is re-read inside `fypFastWindowMs` of being posted while its reach is averaging at least
   * this many a minute; slower ones keep the reading discovery paid for. Without it a new post
   * kept one reading forever and the feed starved (2026-10-13). A quarter of the fast bar: it
   * keeps about a quarter of new posts, roughly 110 an hour, a couple of dollars a day of reads.
   */
  readonly watchMinReachPerMinute: number;
  /**
   * ★ THE SHORT-VIDEO SOURCE'S BARS: every reach bar above times this, for its posts only. Its
   * views run an order of magnitude above a text post's: measured 2026-10-13, its posts aged one to
   * 24 hours had a median of 74k views and a 90th percentile of 1.4M, and 52% were over For You's
   * 40k — against 2% of text posts under an hour old. At 12.5 a short video needs 500k for For You
   * (250k in fifteen minutes, or 25k a minute in its first half hour) and about 3.1M for Popular.
   */
  readonly shortVideoReachScale: number;
  /**
   * A promoted narrative stays on the board only while at least this many of its posts pass the
   * same per-post rules as For You (scored, memeable, confident, a short name). Below it the board
   * hides it; above it, only its passing posts are listed. The owner's rule (2026-10-13).
   */
  readonly narrativeMinPassingPosts: number;
  /**
   * ★ A NARRATIVE'S STAGE ON THE BOARD, from facts a reader could count: how many posts it
   * lists, and how many views its most-viewed post has. Early: fewer than `formingMinPosts`
   * posts. Forming: at least that many. Big: at least `bigMinPosts` posts, or a Forming one
   * whose top post has `bigMinReach` views. A name for a count, never a score: the same two
   * numbers give the same stage, whatever we think of the narrative (services/project
   * narrative-stage.ts).
   */
  readonly narrativeStages: {
    readonly formingMinPosts: number;
    readonly bigMinPosts: number;
    readonly bigMinReach: number;
  };
  /**
   * ★ THE PICTURE BOOST. It lifts only a post the judge was unsure about NEAR THE BAR, and never
   * a "no". "Near the bar" is exact: the judge said YES, named it in a short name, and its
   * confidence fell short of the bar for what it looked at (`qualify.minJudgeConfidence`) by at
   * most `boostBarMargin` — at 0.1, a "yes" at 0.60–0.69 on text or a picture, 0.65–0.74 with a
   * video frame. Such a post still reaches the feed when its picture is at least
   * `boostMinSimilarity` alike (cosine, in the image space) to a picture of a post that was
   * actually coined (internal.coined_picture). It must still answer the kind question like any
   * passing post, and a held kind stands whatever the picture.
   *
   * Why no "no" is ever lifted (the owner's rule, 2026-10-13: "never a clear no"): the post
   * question gives a "no"'s confidence no meaning, and the model uses 0.15 for a firm no as often
   * as for a doubtful one. Live, 551 of 1,790 "no" answers sat at or below 0.3; the old rule
   * (a "no" at or below 0.3) lifted 20 posts the owner had marked "not a meme", every one a
   * "no" at 0.15, and put a tiger-mauling news post on For You — the same 0.15 it gave the two
   * gold posts it rescued. A number that cannot tell those apart cannot say "unsure".
   *
   * The similarity bar was tuned 2026-10-13 on the gold origin posts; the number never reaches a
   * screen.
   */
  readonly boostMinSimilarity: number;
  readonly boostBarMargin: number;
  /**
   * ★ RE-SCORING AFTER A PROMPT CHANGE. A post inside the window whose newest answer came from
   * another version of the post question is judged again by the live scorer, at most this many a
   * pass, after the never-judged posts. A prompt change (a wording edit, a re-tune's new examples)
   * makes every judged post in the day stale at once; capped, the re-score drains over hours on
   * the live judge line instead of landing as one burst.
   */
  readonly rescorePerPass: number;
}

export interface IngestPolicy {
  /**
   * How long since a configured source last answered, past which it is published as
   * failing rather than live. Nothing here is admitted or rejected by it; it decides one
   * word on one indicator, and that word is the difference between "nobody turned this on"
   * and "you are paying for this and it is broken".
   */
  readonly sourceFreshnessMs: number;
  /**
   * Consecutive failed calls at which a configured source is called failing rather
   * than unlucky.
   *
   * ★ WHY THE FRESHNESS BAR ABOVE IS NOT ENOUGH ON ITS OWN, which is the only
   * interesting thing about there being two numbers here. `sourceFreshnessMs` catches
   * the SLOW shapes — a source whose calls hang, or one nobody is asking any more
   * because the loop that asks it died — precisely because neither of those ever
   * produces an error to count. It cannot catch the FAST shape: a wrong key is
   * refused on every single call, instantly, and would go on reading as live for the
   * whole freshness window while answering nothing. That window is half an hour, and
   * half an hour of a lit indicator over a source that answered nothing is the exact
   * lie the indicator exists to stop telling.
   *
   * Three, because one is a blip and two is a coincidence — and because the count is
   * reset by any success, so three in a row means nothing has worked since the last
   * thing that did. Lower and one flaky minute turns the indicator red; higher and a
   * credential that is simply wrong takes longer to say so than it needs to.
   *
   * What would change it: the real consecutive-failure distribution of a source that
   * is up. Nothing has run yet, so this is a judgement rather than a measurement, and
   * `internal.source_health` is where the measurement will come from.
   */
  readonly failingAfterFailures: number;
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

/**
 * Spend, as one daily cap AND a line per capability — deliberately not one pot.
 *
 * A single daily number is spent in arrival order, which means the cheapest, most
 * numerous calls consume it first and the pipeline dies from the far end: discovery
 * exhausts the day, nothing is judged, nothing is quoted, and the board is empty for a
 * reason no dashboard shows. Per-capability lines make the failure local — discovery
 * stops and everything downstream of what was already discovered still completes.
 *
 * `softStopFraction` is the other half of that: stopping a vendor AT its line strands
 * work in flight, so the stop lands early enough to finish what was started.
 *
 * ── ★ WHICH OF THESE NUMBERS ACTUALLY REFUSES A CALL ───────────────────────
 *
 * `dailyUsd`, `perSourceUsdPerDay` and `softStopFraction`. Those three are handed to
 * the meter and consulted by `mayspend` BEFORE the request leaves the process, so a
 * call past the line is not made. The four per-capability lines are NOT enforced:
 * they are constructed into a `Budget`, handed to every adapter, and read by none of
 * them. That is written here rather than left to be discovered because a number that
 * looks like a cap and is not is worse than no number — somebody will lower
 * `judgeUsdPerDay` believing they have bounded the judge.
 *
 * ── ★ AND WHY THE DAILY NUMBER IS SMALL ────────────────────────────────────
 *
 * It is sized so that a person with no money can start this system, walk away for an
 * hour, and come back to a bill they could have absorbed by accident. The measured
 * worst case for one paid source at the shipped cadence is about $4.31 a day (287
 * discovery passes, one page each, at a page of 100 posts at $0.00015). A cap of 12
 * therefore never binds on that configuration — it is a cap in the sense that a door
 * frame is a door. A cap of 3 binds, and the failure it produces when it binds is a
 * thin board with a recorded reason, which is recoverable. The failure a loose cap
 * produces is an invoice, which is not.
 */
export interface BudgetPolicy {
  readonly dailyUsd: number;
  readonly discoveryUsdPerDay: number;
  readonly observeUsdPerDay: number;
  readonly judgeUsdPerDay: number;
  readonly quoteUsdPerDay: number;
  /**
   * ★ THE LINE ONE SOURCE MAY SPEND, so the first vendor asked cannot eat the day.
   *
   * This is the field that makes the paragraph above true rather than aspirational.
   * The per-capability lines describe an intent no code could enforce — an adapter
   * receives a `Budget` and no adapter reads it — whereas this number is passed to
   * the meter as a per-vendor cap and is consulted by `mayspend` before every request.
   *
   * The failure it prevents is specific and is the one a small budget meets first:
   * sources are asked in one order, every pass, and without a per-source line the
   * source at the front of that order spends the whole day and the ones behind it
   * are refused every call from mid-morning onward — which reads on the board as two
   * dead sources rather than as one expensive one.
   */
  readonly perSourceUsdPerDay: number;
  /** Stop spending on a vendor at this share of its line, leaving room to finish. */
  readonly softStopFraction: number;
  /**
   * ★ WHETHER A SUPPLIER'S LINE STOPS ITS CALLS. False by the owner's rule (2026-10-13): nothing is
   * ever skipped — not discovery, scoring, pictures, short video or a re-tune — so a line is a
   * number to warn against at `warnAt`, with how much to raise it, and only a book's daily total
   * (`dailyUsd`, `jobLines.dailyUsd`, `learningLines.dailyUsd`) stops spending.
   */
  readonly vendorLinesStop: boolean;
  /**
   * What a line holds over its measured cost: lines are set at real full-day cost times this, and
   * a warning's suggested raise brings the line to the day's projected spend times this.
   */
  readonly lineBuffer: number;
  /**
   * ★ ONE LINE PER SUPPLIER, BY WHAT IT DOES FOR US — the owner's caps from the earlier
   * build. Named by role because contracts may not name a vendor; the runner maps each role
   * to the adapter that bills under it. A supplier with no line here is bounded by
   * `perSourceUsdPerDay`, and every line by `dailyUsd`.
   *
   *   posts       the post source we search and re-read (75,000 posts a day at its price)
   *   judge       the language model behind QUALIFY and the per-post score
   *   video       the short-video source
   *   actors      a scraping service, for any use beyond the short-video source
   *   embeddings  the image embedding service (Part 1)
   */
  readonly supplierLines: { readonly posts: number; readonly judge: number; readonly video: number; readonly actors: number; readonly embeddings: number };
  /** Shares of a supplier's line at which the owner is warned (a push and a log line), once each a day. */
  readonly warnAt: readonly number[];
  /**
   * ★ ONE-OFF JOBS' OWN MONEY: re-scoring, the history pilot, the pass-rate and gold tools. Kept
   * in a separate book on the same ledger (rows labelled as a job's), so a job can never spend
   * the live feed's lines and the live feed never spends these. `dailyUsd` caps the jobs' day.
   */
  readonly jobLines: { readonly dailyUsd: number; readonly posts: number; readonly judge: number; readonly video: number; readonly embeddings: number };
  /**
   * ★ THE LEARNING WORK'S OWN MONEY: the twice-daily re-tunes, fetching the owner's missed posts,
   * and adding gold from live. Its own book on the ledger (rows labelled `learn:`), apart from the
   * live feed and from one-off jobs. Prompt caching makes a re-tune mostly cache reads.
   */
  readonly learningLines: { readonly dailyUsd: number; readonly posts: number; readonly judge: number; readonly video: number; readonly embeddings: number };
  /*
   * ★ NO PACING, BY THE OWNER'S CHOICE (2026-10-13). Lines were once paced over the UTC day, so a
   * busy morning could not spend the day by breakfast. In practice the pace paused discovery and
   * scoring for hours after midnight whenever anything had spent early. The live runner now runs
   * at full speed every pass; the lines are emergency brakes set above its measured full-speed
   * cost, and the owner is warned at 80% and 95% of each (`budget.warnAt`).
   */
  /**
   * ★ HOW OFTEN A SPENDING PROCESS RE-READS TODAY'S LEDGER. The runner and a one-off paid job
   * share these lines; each re-reads what the other spent this often. Between reads the gap
   * above `softStopFraction` absorbs the other's spending, so this must stay short beside how
   * long either takes to spend that tenth of a line — a minute is cents against a dollar.
   */
  readonly ledgerRefreshMs: number;
  /**
   * ★ FREE BEFORE PAID: ask the sources that cost nothing first, every pass.
   *
   * A POLICY AND NOT AN OPTIMISATION, which is why it is a field here rather than a
   * sort somebody added to a loop. Ordering decides who gets refused when the cap
   * binds, and the two orders produce opposite products from the same budget: asked
   * cheapest-first, a day that runs out of money has already taken everything the
   * free sources had and loses only the paid tail; asked in registry order, the paid
   * source drains the line before the free one is reached and the day loses the half
   * that was never going to cost anything. The second is strictly worse and is what
   * you get by default, because registry order is declaration order.
   *
   * Turning it off is legitimate — it is how you check whether a paid source is
   * actually earning its line — and that is why it is a switch and not a constant.
   */
  readonly freeSourcesFirst: boolean;
  /**
   * ★ AND THE STRONGER HALF: do not pay for a term a free source already answered.
   *
   * `freeSourcesFirst` only reorders; this skips. When a free source returns items
   * for a term, the paid sources are not asked for that term at all in the same pass,
   * and the skip is RECORDED — `deferred`, with the source that covered it — so it is
   * never mistaken for a paid source that was asked and had nothing.
   *
   * ★ THE COST IS REAL AND IS STATED HERE SO IT IS NOT DISCOVERED LATER. Two sources
   * do not hold the same posts. Skipping the paid one because the free one answered
   * loses whatever only the paid one had, and on a term where the free source is
   * chatty and the paid source is where the signal actually lives, that is most of the
   * value. It ships ON because the owner's constraint is money rather than coverage,
   * and the day that inverts, this is the first field to turn off.
   */
  readonly paidOnlyWhenFreeIsEmpty: boolean;
}

/* ── OUTCOMES ─────────────────────────────────────────────────────────── */

/**
 * ★ WHAT AN OUTCOME IS, AS NUMBERS. The half of the learning loop that settles days
 * after the decision it grades.
 *
 * WHY THESE ARE IN POLICY AND NOT IN THE LABELLER. Every field below is a bar that
 * decides what a row in `internal.labels` MEANS, and the labeller is not the only thing
 * that will ever want to know: a backfill, an audit of the censoring rate, and the
 * eventual re-derivation of the bar by quantile all need the same numbers, and three
 * copies of a threshold is three chances to grade two populations under one name.
 *
 * ★ AND WHY `definition` LIVES IN THIS BLOCK RATHER THAN IN THE CODE THAT WRITES IT.
 * It is the string stored in `internal.labels.label_version`, and it names exactly the
 * numbers beside it. Move any threshold in this block WITHOUT moving `definition` and
 * you have two different measurements sharing one name, pooled by every consumer, with
 * nothing on disk that can tell them apart afterwards — the same failure as an
 * un-bumped policy version, one layer down and much harder to see, because the rows
 * look fine individually. Keeping the string in the same object as the numbers makes
 * the omission visible in the diff.
 */
export interface LabelPolicy {
  /**
   * The stored `label_version` these numbers constitute. See above: this moves whenever
   * anything else in this block moves.
   */
  readonly definition: string;

  /**
   * ★ THE HORIZON. How long after a subject's own clock the outcome window stays open.
   *
   * EVIDENCE, AND THE TWO NUMBERS THAT ARE CONSTANTLY CONFUSED WITH IT. Our own
   * measurement puts the median post-to-peak at about SIX DAYS, and 0% of large coins
   * peak within an hour of the post. Six days is therefore the MEDIAN, not the window:
   * a window closed at the median grades half the population before it finished
   * happening, and every one of those rows enters training as a small number that is
   * not a small outcome but no outcome at all. Thirty days is roughly five times the
   * median, which puts the great majority of the mass inside the window, and it is the
   * figure the architecture already committed to.
   *
   * The other number in the same neighbourhood is the post-to-asset median of 3.8
   * MINUTES — the front of the pipeline, not the back. It bounds how quickly a subject
   * acquires something to measure; it says nothing about when that thing is done moving.
   *
   * The cost of the choice, stated: a thirty-day horizon means a decision made today
   * cannot enter a training set for a month, and for the first month of live running
   * the resolved population is empty by construction. That is the correct shape. The
   * alternative — a short window so that rows appear sooner — buys rows by mislabelling
   * them, and there is no later repair for a table full of them.
   */
  readonly windowDays: number;

  /**
   * ★ WHAT COUNTS AS A PEAK: the bar `y` is taken at, as a multiple of the first price
   * we ever observed for the asset inside the window.
   *
   * EVIDENCE. On 866 labelled coins from the previous build's measurement, winners had
   * a median peak of 18× and losers 1.19×. A bar at 5× sits far above the body of the
   * loser distribution and far below the winner median, so it is not sitting on top of
   * either mode — which is what makes it robust to being slightly wrong.
   *
   * ★ IT IS A BOOTSTRAP VALUE AND IT IS SUPPOSED TO MOVE. The research instruction is
   * to set this by quantile so positives land at 1–3% of admissions and to recompute it
   * monthly, and neither is possible until a resolved population exists — which is what
   * the labeller is for. When it moves, `definition` moves with it, because a row graded
   * at 5× and a row graded at 12× are not the same measurement.
   */
  readonly peakMultipleThreshold: number;

  /**
   * ★ THE WASH-TRADE GUARD, half one: how close to the maximum a reading has to be to
   * count as supporting it.
   *
   * Ported unchanged from the previous build's peak-multiple query, where it was one of
   * two choices singled out as the reason that measurement separated cleanly. A single
   * print at ten times the surrounding prices is not a peak, it is somebody trading with
   * themselves, and a measurement that cannot tell those apart teaches a model to chase
   * the second one.
   */
  readonly peakSupportFraction: number;

  /**
   * ★ THE WASH-TRADE GUARD, half two: how many readings within `peakSupportFraction` of
   * the maximum are required before the maximum may be called a peak.
   *
   * Two, and the reason is that one is exactly the number a wash trade produces. A
   * maximum standing alone is still recorded — as a CENSORED lower bound, not as a
   * resolved measurement and not as a zero — because "the only evidence we have is one
   * print we do not believe" is a statement about our evidence, not about the coin.
   */
  readonly minPeakSupportReadings: number;

  /**
   * ★ HOW MUCH COVERAGE LOSS MAKES AN OBSERVATION CENSORED.
   *
   * The fraction of the outcome window that the coverage log must positively account
   * for before a measurement over it may be called resolved. Below this, the window was
   * partly unwatched: whatever peak we measured is a LOWER BOUND on one we may have
   * missed, and the row is censored carrying that bound.
   *
   * WHY IT IS NOT 1.0. The coverage log records contiguous observed windows written on
   * reconnect, so the boundary between two of them is a sub-second seam that is real,
   * routine, and not a period during which anything could have been missed. A bar at
   * exactly 1.0 would censor essentially every window over a healthy stream, and a
   * censoring rate that is always 100% is the same as no censoring signal at all —
   * which matters, because a RISING censoring rate is the earliest sign the pipeline is
   * rotting and it can only rise from somewhere. 0.99 over a thirty-day window admits
   * about seven hours of seam and refuses anything larger.
   *
   * ★ THIS IS THE SECOND OF TWO TESTS, NEVER THE ONLY ONE. A window any part of which
   * the watcher DECLARED dark is censored outright whatever this fraction says: a
   * declared gap is knowledge that we were not looking, and no amount of coverage
   * elsewhere in the window buys it back.
   */
  readonly minCoveredFraction: number;
}

/* ── the whole thing ──────────────────────────────────────────────────── */

/**
 * The social layer: profiles, follows, comments and likes (services/social), and the ranks a
 * person earns from them — Trador's ranks, its numbers kept exactly. A rank is earned from
 * other people's likes on one's comments, each like weighed by the voter's own rank; nothing
 * about a coin or a post is scored here.
 */
export interface SocialPolicy {
  /** The rep each rank starts at. GOAT also needs the top `goatPercentile` of the season. */
  readonly rankRep: { readonly intern: number; readonly analyst: number; readonly quant: number; readonly wolf: number; readonly goat: number };
  /** What a like from someone of each rank multiplies the vote by (Trador's ×1 to ×2). */
  readonly rankMultiplier: { readonly intern: number; readonly analyst: number; readonly quant: number; readonly wolf: number; readonly goat: number };
  /** One like from a holder, before multipliers. */
  readonly votePoints: number;
  /** A comment carrying a proof link: an X post by its author, or a transaction that touched the coin. */
  readonly proofBoost: number;
  /** The author bought the coin early: first buy under `earlyBuyMultiple` times its earliest price. */
  readonly earlyBoost: number;
  readonly earlyBuyMultiple: number;
  /** A voter earns others rep on at most this many likes a UTC day. */
  readonly dailyVoteCap: number;
  /** GOAT is the top this fraction of the season's ranked people, at least one. */
  readonly goatPercentile: number;
  /** Season one starts here (UTC); every season is one calendar month. */
  readonly seasonEpochMs: number;
  /** Comments one person may post per `commentWindowMs`. */
  readonly commentsPerWindow: number;
  readonly commentWindowMs: number;
  readonly maxCommentChars: number;
  readonly maxBioChars: number;
  /** Distinct people reporting a comment before it is hidden from everyone pending review. */
  readonly reportsToHide: number;
  /** A holder check is kept this long: one like, one chain read. */
  readonly holderKeepMs: number;
  /** The season standings (for GOAT and the leaderboard) are kept this long. */
  readonly standingsKeepMs: number;
  readonly leaderboardSize: number;
  /** Reads and writes one person may make per `windowMs`. */
  readonly perClient: number;
  readonly windowMs: number;
}

/**
 * Alerts (services/notify): what fires, how often, and the defaults a person starts with.
 * Every alert is a fact about the world — a price, a curve, a post, a person — and fires once
 * per person, kind, subject and level.
 */
export interface NotifyPolicy {
  /** The multiples a holding or a watched coin can alert at, in order. */
  readonly milestones: readonly number[];
  /** The multiples switched on for someone new. */
  readonly defaultMultiples: readonly number[];
  /** "Close to graduating": the curve has passed this fraction. */
  readonly graduatingSoonAt: number;
  /** A holding smaller than this many dollars does not alert. */
  readonly minPositionUsd: number;
  /** Pushes one person gets in an hour, by default; past it, alerts land in the list only. */
  readonly defaultPerHour: number;
  /** The most a person may raise their own hourly limit to. */
  readonly maxPerHour: number;
  /** Rows the Alerts list shows. */
  readonly inboxLimit: number;
  /** How often the price, multiple and curve checks run. */
  readonly marketLoopMs: number;
  /** How often the pipeline is read for new rising posts, narratives and coin links. */
  readonly pipelineLoopMs: number;
  /** A wallet's buy history (its cost basis) is re-read at most this often: buys are rare, parse calls are not free forever. */
  readonly positionsKeepMs: number;
  /** How often queued alerts are delivered. */
  readonly deliverLoopMs: number;
  /** A push undelivered after this long is dropped by the push service. */
  readonly pushTtlS: number;
  /** Reads and writes one person may make per `windowMs`. */
  readonly perClient: number;
  readonly windowMs: number;
}

/**
 * ★ WHO THE OWNER IS. Owner-only controls (the "Not a meme" / "Is a meme" buttons, feedback on coin
 * matches and names, "Add missed posts") and owner-only alerts go to a signed-in person whose
 * wallet or X handle is listed here — never anyone else, whatever the app shows them.
 */
export interface OwnerPolicy {
  /** Wallet addresses, as the sign-in's embedded or linked wallet reports them. */
  readonly wallets: readonly string[];
  /** X handles without '@', lower-case. */
  readonly xHandles: readonly string[];
}

/**
 * ★ HOW THE JUDGE LEARNS FROM THE OWNER. Twice a day the learned-examples block (the owner's taps,
 * missed posts and feedback) is rebuilt and tested; it is applied only if every gate holds,
 * otherwise the current block stays. Gold is the floor every re-tune is held to.
 */
export interface LearningPolicy {
  /** Local times the re-tune runs, in `timeZone`. */
  readonly retuneAt: readonly string[];
  readonly timeZone: string;
  /**
   * How long before each `retuneAt` a run starts, so it is finished by then: measured 2026-10-13,
   * one run with its batched test and a baseline took about 17 minutes.
   */
  readonly startAheadMs: number;
  /** Gold origin posts that must still pass. */
  readonly minGoldPass: number;
  /** Held-out live non-memes that may pass, at most. */
  readonly maxLiveNegativePass: number;
  /** The owner's missed posts that must pass ("most"). */
  readonly minMissedPass: number;
  /** Labelled posts in the examples block, at most: newest first, yes and no balanced. */
  readonly maxExamples: number;
  /** Missed-post links the owner may paste at once. */
  readonly maxMissedPerPaste: number;
}

export interface Policy {
  /** Bumped by hand on every edit. The hash is computed from the object, not this. */
  readonly version: string;
  readonly admit: AdmitPolicy;
  readonly track: TrackPolicy;
  readonly kinetics: KineticsPolicy;
  readonly detect: DetectPolicy;
  readonly group: GroupPolicy;
  readonly qualify: QualifyPolicy;
  readonly judge: JudgePolicy;
  readonly resolve: ResolvePolicy;
  readonly market: MarketPolicy;
  readonly assets: AssetPolicy;
  readonly ingest: IngestPolicy;
  readonly feed: FeedPolicy;
  readonly rising: RisingPolicy;
  readonly backfill: BackfillPolicy;
  readonly origin: OriginPolicy;
  readonly universe: UniversePolicy;
  readonly search: SearchPolicy;
  readonly trade: TradePolicy;
  readonly wallet: WalletPolicy;
  readonly social: SocialPolicy;
  readonly owner: OwnerPolicy;
  readonly learning: LearningPolicy;
  readonly notify: NotifyPolicy;
  readonly rank: RankPolicy;
  readonly features: FeaturesPolicy;
  readonly explore: ExplorePolicy;
  readonly budget: BudgetPolicy;
  /**
   * The other half of the loop. Every stage above decides; this block is what says
   * whether the decision was right, and under which definition of right.
   */
  readonly labels: LabelPolicy;
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

  /* v7 adds `assets.feedFreshnessMs` — the bar past which the feed of new assets stops
     being described as live. Bumped by hand for the same reason as v3 through v6, and the
     reason is sharper here than usual: before this bump there was no bar at all, so a rail
     over a transport that had been silent for a hundred and forty-one hours rendered
     exactly as a rail over a transport that answered a second ago. Nothing was wrong with
     any individual row; the screen simply had no way to say that nothing had arrived in
     six days, and a dead feed is not a quiet market. Any frame committed before this bump
     was committed by a projector that could not make the distinction, and the version
     string is the only thing that says so. */

  /* v8 adds `ingest.sourceFreshnessMs` — the bar past which a source we ingest FROM stops
     being described as answering. Bumped by hand, and the reason is v7's reason pointed at
     a different input: before this bump there was no bar at all for a social source, so a
     board fed by one live source and a board fed by three rendered identically. Nothing was
     wrong with any individual row; the screen simply had no way to say that two thirds of
     what feeds it was dark, and a board missing two sources is not a quiet world. Any frame
     committed before this bump was committed by a projector that could not make the
     distinction, and the version string is the only thing that says so. */

  /* v8 ALSO carries `ingest.failingAfterFailures`, added in the same window and sharing
     the hash. One version string, one hash, one changelog entry — splitting them into v8
     and v9 would suggest a policy existed in between that never judged a decision. It is
     the other half of the distinction above: the freshness bar catches a source that went
     quiet, and this catches one that is refusing every call as fast as we can make it.
     Without it a wrong credential reads as live for a full freshness window. */

  /* v9 adds the whole `labels` block — the first thresholds in this file that describe an
     OUTCOME rather than a decision. Bumped by hand for the reason v3 through v8 give, and
     with one addition that is particular to this block: before this bump the horizon, the
     bar that turns a peak into a `y`, and the coverage loss that makes an observation
     censored all lived nowhere at all. `internal.labels.window_days` is a per-row column
     with only `check (window_days > 0)`, so whoever wrote the row chose the window, and
     two runs under two windows would have produced rows that are indistinguishable on
     disk and are not the same measurement. Nothing was wrong with any individual row; the
     table simply had no way to say what it had been graded against.

     ★ AND THE `labels.definition` FIELD IS PART OF THE SAME ARGUMENT ONE LAYER DOWN. The
     policy version says which thresholds judged a DECISION; `labels.definition` says which
     thresholds graded an OUTCOME, and it is stored on every label row. Any label written
     before this bump — there are none — would have been graded against numbers that were
     not written down anywhere, and the definition string is the only thing that would say
     so. */

  /* v10 is the first bump in this file that LOWERS a threshold rather than adding one,
     and the first whose subject is what the system is allowed to spend rather than what
     it is allowed to believe. It changes `budget.dailyUsd` from 12 to 3 and adds three
     fields: `perSourceUsdPerDay`, `freeSourcesFirst` and `paidOnlyWhenFreeIsEmpty`.

     Bumped by hand for the reason v3 through v9 give, and with one addition particular
     to this block. The other bumps all say "a stage could not do X before this"; this
     one says the opposite — every stage could do X, and the numbers describing what it
     would cost were not connected to anything. `dailyUsd: 12` was passed to the meter
     and never bound, because the configuration that could reach it costs under five
     dollars a day; the four per-capability lines were handed to adapters that do not
     read them. So a decision made before this bump was made by a process whose spending
     was bounded by its own cadence and by nothing else, and a decision made after it was
     made by one that will stop and say it stopped. Those are not the same system, and
     the version string is the only thing on a decision row that says which one produced
     it.

     ★ AND THE TWO BOOLEANS ARE POLICY AND NOT PLUMBING, which is why they are here and
     not in a service. They decide WHICH SOURCE gets asked and which gets skipped, so
     two runs under the same terms and the same budget can hold different posts
     depending on them. A board built with `paidOnlyWhenFreeIsEmpty` on saw a different
     world from one built with it off, and nothing else on the row would say so.

     v11 adds `assets.tickerLookbackMs` and `assets.tickerMinCoverage`, the two numbers
     behind the Create screen's "you'd be first". No stage decides on them; they are here
     because the line that says "you'd be first" is a claim about the world, and the
     coverage it rests on has to be a number somebody can find.

     v12 adds `track.ageTierMinutes`: how often a post is re-read now depends on its age, not
     only on a score that never changed after admission. Every TRACK row after this bump was
     scheduled under a different rule from every row before it.

     v13 adds `feed`: discovery searches for whatever is moving, with no keyword, behind an
     approval floor that adapts to the budget. Every post arriving after this bump was found
     by a different question from every post before it.

     v14 adds `track.youngWindowMin`, `velocityShares` and `velocityMinutes`: a post's first
     three hours are read on the earlier build's hot, warm and cold tiers, ranked by view rate.

     v15 adds `rising`: single posts found by the catch-all search are scored alone by the
     judge, and those at or above the meme-score bar make the For You and Popular feeds.

     v16 lowers `track.maxTrackedHours` from 168 to 48, and TRACK now re-reads only posts on
     screen (in a narrative, or on the For You and Popular feeds); everything else keeps the
     one reading taken at discovery. A post's history after this bump is at most two days.

     v17 raises `budget.dailyUsd` from 3 to 21 with a line per supplier (`supplierLines`) and
     once paced every line over the day (no longer — see `supplierLines`) — the owner's caps from the earlier build,
     approved 2026-10-12. Re-reads go to the top 60 rows of each feed and to promoted
     narratives only, every 6 / 15 / 30 minutes by view rate, for 24 hours.

     v18 adds `feed.maxPagesPerLane` (up to 3 full pages per catch-all lane per pass, the
     posts line still the limit) and `judge.postBatchMaxOutputTokens` (800 per batch of
     single posts, so the judge line is reserved near the real cost).

     v19 adds `group.imagesPerPass`: each new post's picture is embedded once, for GROUP's
     image evidence. v20 adds `group.image` (its bars, uncalibrated) and
     `judge.pairMaxOutputTokens` for the same-subject question.

     v21 narrows the catch-all window to 10 minutes (each post comes back about 5 times
     rather than 15, so the same money finds about three times the new posts), adds the
     slow-burn lane (`feed.slow`), and raises the judge line to $8 and embeddings to $2.

     v22 adds `backfill`: following a promoted story's quotes back to where it started.
     v23 adds `backfill.searchResultCap`, for the one search back for its name.

     v24 adds `origin.launchAllowanceMs`: an origin is posted before the coin, with ten
     minutes' grace; later is `viral_after_launch`. v25 adds `origin.influencerFollowers` and
     `origin.viralReach`, the creator-link check's two bars (uncalibrated).

     v26 adds `universe`: how many new coins a pass reads and checks, and how far back.

     v27 adds `universe.lookup`: searching the market data sources for coins we never saw
     minted, as candidates only.

     v28 adds `search`: the Search tab's cache, per-client limit and list lengths.

     v29 adds `universe.keep`: every coin for fourteen days, then only the coins that matter.

     v30 adds `universe.history`: the pilot's alive bar and its total spend cap.

     v31 adds `trade`: the per-trade cap, slippage, the platform fee (off) and the probe size.

     v32 adds `wallet`: the Wallet tab's cache, per-client limit, list length and history depth.

     v33 adds `wallet.snapshotGapMs`: the balance chart's spacing.

     v34 adds `trade.maxDevBuySol`: the cap on a creator's first buy at launch.

     v35 adds `social` (Trador's ranks and rep, comment limits) and `notify` (alerts: the
     multiples, the curve mark, the hourly limit, the loops).

     v36 adds `universe.history.minLiquidityUsd` and `minHolders`: the pilot's fake-coin filter. */
  version: 'policy.v63',

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
    /* Under an hour old: every 4 minutes. Then 9, 14, 21, 30, 42 and 58 minutes as the post
       passes 1h, 3h, 6h, 12h, 1 day and 2 days; past 4 days, every 78. */
    ageTierMinutes: [60, 180, 360, 720, 1440, 2880, 5760],
    /* The earlier build's snapshotter tiers, at the owner's paid intervals: first 3 hours,
       top 20% by view rate every 6 min, next 40% every 15, the rest every 30. After the first
       3 hours nothing is read more often than the cold tier. */
    youngWindowMin: 180,
    velocityShares: { hot: 0.2, warm: 0.4 },
    velocityMinutes: { hot: 6, warm: 15, cold: 30 },
    /* holdoutRate deleted in v6 — see the note on TrackPolicy. explore.holdoutRate is
       the single source, and it is the one every live call site already read. */
    shedFromTier: 0,
    /* 24 hours. A post's views move in its first day; the owner's caps pay for a day. */
    maxTrackedHours: 24,
    flatReadsToDemote: 3,
    paidReadMinMinutes: 180,
    paidRunEveryMinutes: 30,
    paidReadMaxPosts: 8,
    paidFastMinReachPerMinute: 250,

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
    imagesPerPass: 40,
    image: { space: 'multimodal-3.1024', nearIdentical: 0.95, likely: 0.82, borderline: 0.72, pairChecksPerDay: 200 },
    name: { minChars: 4, maxPostAgeMs: 86_400_000 },
    genericSpans: ['breaking', 'breakingnews', 'justin', 'news', 'update', 'viral', 'trending', 'trend', 'fyp', 'foryou', 'foryoupage', 'meme', 'memes', 'memecoin', 'memecoins', 'crypto', 'cryptocurrency', 'funny', 'video', 'thread', 'usa'],
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
    /* FROM A BACKTEST OF THE PREVIOUS BUILD, docs/meme-score-comparison.md and, in the
       old repo, docs/rescore-threshold-analysis.md: 629 narratives from the text-led
       source, scored after the fact with that build's coinability prompt. At or above 0.70
       a coin with a matching name was later found 72.9% of the time (207 narratives);
       below it, 1.9% (422). Above 0.70 the rate was flat, so a higher bar only cut volume.

       WHAT IT DID NOT PROVE. It measured "a coin with a matching name was launched", not
       whether that coin did well. It matched loosely, on the old model's own suggested
       ticker, which builds part of the gap into the method. It judged one post, not a
       story, on a different prompt and a different 0–1 scale from this judge's
       confidence. So 0.70 is a starting point carried over, not a calibration of this
       judge; measure it again once the judge runs.

       videoFrame is NOT CALIBRATED. The old backtest had no usable video judgements (they
       were capped, not judged). 0.75 is a placeholder, set stricter than text on purpose,
       until there is data. */
    minJudgeConfidence: {
      text: 0.7,
      /* A picture is more to go on than text alone, not less: held to the text bar. */
      picture: 0.7,
      videoFrame: 0.75,
    },
    weights: {
      judgeConfidence: 0.4,
      specificity: 0.3,
      crossSource: 0.15,
      authorBreadth: 0.15,
    },
    batchSize: 10,
  },

  judge: {
    maxAttempts: 3,
    backoffMs: 2_000,
    maxWaitMs: 30_000,
    timeoutMs: 60_000,
    /* Ten answers of a yes/no, a short name, a number and a few short strings each fit in
       well under this. Set with room so a long answer is not cut off mid-JSON, which
       would make the whole batch unavailable. */
    maxOutputTokens: 2_048,
    postBatchMaxOutputTokens: 800,
    pairMaxOutputTokens: 64,
    /* Typical English runs about four characters a token; three makes the estimate the
       meter checks against run high, which is the safe direction. */
    charsPerToken: 3,
    /* A ~1.15 megapixel image is about 1,600 input tokens (width × height / 750). */
    tokensPerFrame: 1_600,
    maxFrameBytes: 5_000_000,
    maxTextsPerStory: 8,
    maxCharsPerText: 400,
    /* Half again as many members. A story of 4 is asked again at 6, a story of 20 at 30. */
    rejudgeGrowth: 0.5,
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

  assets: {
    /* Fifteen minutes. Deliberately NOT the same number as market.readingFreshnessMs
       above, and the two must not be merged: five minutes is how long a PRICE stays true,
       which is a statement about one coin's market, and this is how long a SILENCE stays
       ordinary, which is a statement about a transport. They are different quantities
       measured over different things and they happen to share a unit. */
    feedFreshnessMs: 900_000,
    tickerLookbackMs: 604_800_000, // seven days
    tickerMinCoverage: 0.95,
  },

  ingest: {
    /* Thirty minutes. Deliberately NOT the same number as assets.feedFreshnessMs above,
       and the two must not be merged: fifteen minutes is how long a SOCKET may be silent
       before its transport is presumed dead, and this is how long a POLLED, PAID API may go
       unanswered before we stop claiming it is feeding the board. The first is bounded
       below by another process's own stale bar; the second is bounded below by how rarely
       we choose to spend money, which is a different quantity entirely. */
    sourceFreshnessMs: 1_800_000,
    failingAfterFailures: 3,
  },

  /* The earlier build's numbers, kept: a 30-minute window, floors starting at 100, never
     adapting below 100 nor above 50,000, at least 30 after window scaling, +20% when a
     lane overshoots its target, −20% under 60% of it, −40% when it returns nothing, and
     about a quarter of reads to the media lane. */
  feed: {
    windowMin: 10,
    fullWindowMin: 60,
    startFloor: 100,
    mediaStartFloor: 100,
    floorMin: 100,
    floorMax: 50_000,
    effectiveFloorMin: 30,
    raiseFactor: 1.2,
    lowerFactor: 0.8,
    lowBand: 0.6,
    emptyFactor: 0.6,
    budgetShare: 0.6,
    mediaShare: 0.25,
    langs: ['en', 'zxx'],
    hashtags: ['meme', 'memes', 'funny', 'fyp', 'viral', 'cat', 'dog', 'animals', 'pet', 'cute', 'trend', 'crypto', 'memecoin', 'solana'], // vocab-allow: solana  — a hashtag the owner chose to watch, not a chain this code knows
    /* 20, sorted by most liked over the past day: a live run on 2026-10-13 returned 20 videos, all
       under 24 hours old, the top five at 1.5M to 3M views, for $0.101 once its charges settled
       ($0.071 was read before they had). Asks now alternate newest-first and most-liked. */
    hashtagResults: 20,
    watchMaxAgeMs: 86_400_000, // a day
    pageLimit: 20,
    maxPagesPerLane: 3,
    slow: {
      windowMin: 360, // six hours
      everyMs: 900_000, // every 15 minutes
      floorMultiple: 5,
      slices: 6, // one band at each hour of age
      /* 0.2: a fifth of the search money, uncalibrated. The lane's floor adapts to it, so
         a wrong share moves the floor, not the bill. */
      share: 0.2,
    },
  },

  backfill: {
    storiesPerPass: 2,
    /* 100: at about 20 posts fetched for a cent each worst case, a few dollars a day at
       most, and far more promotions than a normal day produces. */
    storiesPerDay: 100,
    /* 5: a quote of a quote of a quote is already rare; a chain longer than this is a
       thread, not a meme travelling. */
    maxReproductionHops: 5,
    maxReproducedPosts: 20,
    /* 20: one page. Most of what a name search returns is unrelated; GROUP keeps only what
       matches, so a bigger page buys mostly rejections. */
    searchResultCap: 20,
  },

  origin: {
    launchAllowanceMs: 600_000, // ten minutes
    influencerFollowers: 50_000,
    viralReach: 50_000,
  },

  universe: {
    /* 80 a pass at a pass a minute is 115,000 a day: several times the launchpad's busiest
       day, so the queue drains rather than grows. */
    metadataPerPass: 80,
    metadataConcurrency: 8,
    metadataTimeoutMs: 8_000,
    metadataMaxBytes: 16_384, // a document is a few hundred bytes
    metadataAttempts: 3,
    checksPerPass: 80,
    lookbackMs: 604_800_000, // a week
    matchWindowMs: 172_800_000, // two days before launch
    candidatesPerCoin: 20,
    recheckAfterMs: 86_400_000, // a day
    /* 30 days: the owner's 4nMTfs origin was posted 22 days before its coin and its reposts of
       the same picture days before; 20 posts, earliest first, so the first of them is the one. */
    pictureLookbackMs: 2_592_000_000,
    picturePostsPerCoin: 20,
    lookup: {
      /* 60 a pass, a pass a minute: every new feed post looked up within a minute. */
      termsPerPass: 60,
      /* 20,000: the sources are free; the per-minute rate is what keeps us unblocked. */
      perDay: 20_000,
      keepMs: 21_600_000, // six hours
      withinMs: 604_800_000, // seven days
      hitsPerTerm: 10,
      /* 4: the proposed name and up to three alternates; the judge gave three or more in 487 of
         its 660 yes answers on 2026-10-13. */
      namesPerSubject: 4,
      /* 100: a fifth of the Analyst plan's 500 a minute, the rest left to market reads. */
      perMinute: 100,
      retries: 3,
      giveUpMs: 600_000, // ten minutes
    },
    keep: {
      allMs: 1_209_600_000, // fourteen days
      /* $25k: the history plan's bar, a third of the way to bonding. Below it almost no coin has a story. */
      marketCapUsd: 25_000,
      /* 300 a minute: ten calls of thirty, so ~42,000 launches a day are asked about in under three hours. */
      checksPerPass: 300,
      deletesPerPass: 1_000,
    },
    history: {
      aliveMarketCapUsd: 100_000,
      /* $25: the founders' cap for the whole pilot, every paid call counted against it. */
      pilotUsd: 25,
      /* The fake-coin filter: a market cap alone is easy to fake with one wallet and a thin pool. */
      minLiquidityUsd: 20_000,
      minHolders: 300,
    },
  },

  trade: {
    /* 0.05 SOL: a first real trade is a test of the plumbing, not a position. */
    maxSolPerTrade: 0.05,
    defaultSlippageBps: 300,
    /* 15%: past this a launchpad coin's quote says little about what the trade will fill at. */
    maxSlippageBps: 1_500,
    platformFeeBps: 0,
    probeSol: 0.001,
    /* 0.05 SOL, the same as a buy: a first launch is a test of the plumbing, not a position. The
       founders' presets go to 2 SOL; the app offers only those at or under this cap. */
    maxDevBuySol: 0.05,
  },

  social: {
    /* Trador's ladder (config/ranks.ts), unchanged. GOAT's floor is Wolf's: the percentile decides. */
    rankRep: { intern: 0, analyst: 250, quant: 1_000, wolf: 5_000, goat: 5_000 },
    rankMultiplier: { intern: 1, analyst: 1.25, quant: 1.5, wolf: 1.75, goat: 2 },
    votePoints: 10,
    proofBoost: 1.25,
    earlyBoost: 1.5,
    earlyBuyMultiple: 3,
    dailyVoteCap: 20,
    goatPercentile: 0.01,
    /* 2026-10-01T00:00:00Z: Season 1 is October 2026. */
    seasonEpochMs: 1_790_812_800_000,
    /* Ten an hour: room to talk, not room to flood. */
    commentsPerWindow: 10,
    commentWindowMs: 3_600_000,
    maxCommentChars: 1_000,
    maxBioChars: 160,
    reportsToHide: 3,
    holderKeepMs: 60_000,
    standingsKeepMs: 30_000,
    leaderboardSize: 50,
    perClient: 60,
    windowMs: 60_000,
  },

  owner: {
    wallets: ['A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL'],
    xHandles: ['hawabuilds'],
  },

  learning: {
    retuneAt: ['08:00', '20:00'],
    timeZone: 'Europe/London',
    startAheadMs: 1_200_000, // twenty minutes
    minGoldPass: 0.65,
    maxLiveNegativePass: 0.05,
    minMissedPass: 0.5,
    maxExamples: 120,
    maxMissedPerPaste: 10,
  },

  notify: {
    /* Trador's rungs (lib/notifications/milestones.ts). */
    milestones: [2, 3, 5, 10, 25, 50, 100],
    defaultMultiples: [2, 5, 10],
    graduatingSoonAt: 0.9,
    minPositionUsd: 10,
    /* Six an hour by default: a busy day still reads as alerts, not noise. */
    defaultPerHour: 6,
    maxPerHour: 30,
    inboxLimit: 40,
    /* Two minutes: free price and curve reads for a handful of people, well inside the free tiers. */
    marketLoopMs: 120_000,
    pipelineLoopMs: 60_000,
    /* Thirty minutes: two parse calls per wallet per half hour stays far inside a free tier. */
    positionsKeepMs: 1_800_000,
    deliverLoopMs: 5_000,
    pushTtlS: 86_400,
    perClient: 60,
    windowMs: 60_000,
  },

  wallet: {
    keepMs: 30_000,
    perClient: 30,
    windowMs: 60_000,
    holdingsShown: 50,
    /* 200 transactions: two parse calls of a hundred, well inside a free parsing tier. */
    signaturesRead: 200,
    /* Ten minutes: fine enough to see a real move, coarse enough that a day is 144 points. */
    snapshotGapMs: 600_000,
  },

  search: {
    keepMs: 60_000, // a minute
    /* 20 a minute: a person typing; a script hammering two free sources gets told to wait. */
    perClient: 20,
    windowMs: 60_000,
    minTermLength: 2,
    maxTermLength: 32,
    storiesShown: 10,
    postsShown: 10,
    coinsShown: 30,
    curvesRead: 10,
    openableMs: 3_600_000, // an hour
  },

  rising: {
    windowMs: 86_400_000, // a day
    /* 60: the rows on each feed, and so the posts on it that are re-read. */
    maxRows: 60,
    postsPerPass: 200,
    maxNameWords: 3,
    fypMinReach: 40_000,
    /* Tightened 2026-10-13: at 10k-in-15m / 1,000-a-minute-in-an-hour, 34 of the day's 140 shown
       posts got in by growth and then stalled under 40k (14k–29k at half an hour). At 20k / 2,000 a
       minute in the first 30 minutes, 7 do; the 57 that reached 40k are untouched. */
    fypEarlyReach: 20_000,
    fypEarlyWindowMs: 900_000, // fifteen minutes
    fypFastReachPerMinute: 2_000,
    fypFastWindowMs: 1_800_000, // the first half hour
    popularMinReach: 250_000,
    fypMaxAgeMs: 21_600_000, // six hours
    fypGrowthWindowMs: 3_600_000, // the last hour of readings
    fypGrowthMinSpanMs: 1_200_000, // twenty minutes between the two readings compared
    fypStillGrowingPerMinute: 1_000, // half the early-growth bar
    watchMinReachPerMinute: 500,
    shortVideoReachScale: 12.5,
    narrativeMinPassingPosts: 2,
    /* 3 posts is where GROUP promotes a story; 8 posts, or a top post at 5M views (125 times
       the For You views bar), is a narrative most of the timeline has seen. */
    narrativeStages: { formingMinPosts: 3, bigMinPosts: 8, bigMinReach: 5_000_000 },
    boostMinSimilarity: 0.44,
    /* A "yes" up to a tenth under its bar: 0.60 on text or a picture, 0.65 with a video frame. */
    boostBarMargin: 0.1,
    /* 15 a pass, with a pass every minute or two: about 600 an hour. The ~2,100 posts judged in a
       day (2026-10-13) re-score in about 3.5 hours after a prompt change, near $0.70 an hour at
       the measured $0.0012 a post, on the live judge line and under its cap. */
    rescorePerPass: 15,
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

  /* Every number here is enforced or is marked as not enforced on the interface above.
     The three that refuse a call are `dailyUsd`, `perSourceUsdPerDay` and
     `softStopFraction`; the four per-capability lines describe an intent no adapter
     reads. Read the ★ block on BudgetPolicy before moving any of them. */
  budget: {
    /* 3, not 12. At the shipped cadence one paid source costs about $0.86 a day and
       cannot exceed $4.31, so 12 could never bind and 3 can — which is the whole
       difference between a cap and a comment. It is also the number a person who is
       low on funds can lose without it mattering. */
    /* 21, with a line per supplier: the owner's caps from the earlier build, approved
       2026-10-12 to replace the $3 starter cap. Every line is paced over the day. */
    /* $23.25: the lines below, as brakes. Measured 2026-10-13 02:33–03:30 UTC at full speed with the
       cost cuts on: X $5.72/day, judge $4.48, short video $2.34, pictures $0.09. Lines are that, ×1.5
       for daytime volume, +25%. With the jobs' $6.50 the day is $29.75, under the owner's $30. */
    /* $21.50 from 2026-10-13 13:00 UTC, the owner's call: discovery is never cut to pay for learning.
       X $10, short video $2 + $1, the judge $7.50 as before; pictures up from $0.50 to $1 (they paced
       $0.91 and had stopped). With jobs $3.75 and learning $7.25 the day is $32.50, under the
       owner's $33 (approved 2026-10-13; it was $30). */
    dailyUsd: 21.5,
    discoveryUsdPerDay: 5,
    observeUsdPerDay: 4,
    judgeUsdPerDay: 2,
    quoteUsdPerDay: 1,
    /* 1.5 — half the day, so a single source cannot take the whole line and leave the
       others refused from mid-morning. With one source configured this never binds and
       `dailyUsd` is the only ceiling; with two it is what keeps them both alive. */
    perSourceUsdPerDay: 1.5,
    /* 0.97: the lines are brakes now, set above the measured cost; stopping at 90% wasted a tenth
       of each and meant the owner's 95% warning could never fire. */
    softStopFraction: 0.97,
    vendorLinesStop: false,
    lineBuffer: 1.25,
    supplierLines: { posts: 10, judge: 7.5, video: 2, actors: 1, embeddings: 1 },
    warnAt: [0.8, 0.95],
    /* $6: tonight's measuring and re-scoring had already spent $4.44 of the judge by 02:00 UTC. With the live $21 the day's total is $28, under the owner's $30; $7 lets the smaller-picture test run tonight. */
    /* $8.75 from 2026-10-13 05:30 UTC: $1.25 moved from the live posts line ($11.25 → $10; measured
       full-speed X is $5.72 a day) and $1 from the live judge ($8.50 → $7.50; measured $4.48), so the
       judge can be re-tuned on the live negative set today. The day stays $29.75. */
    /* $4.75 from 2026-10-13 07:00 UTC, with the learning work moved to its own $4 line below. Live
       $21 + jobs $4.75 + learning $4 = $29.75 a day, under the owner's $30. */
    jobLines: { dailyUsd: 3.75, posts: 0.5, judge: 2.75, video: 0.25, embeddings: 0.25 },
    /* $5: $1 moved from jobs on 2026-10-13 so today's re-tune could finish and re-check the feed. */
    /* $7.25 from 2026-10-13 12:50 UTC: the 07:00 run was not tested ($1.15 left of the judge, the
       test's worst case $2.97), and two runs today need room for that worst case each. Paid by
       raising the day's total, never by the live lines. */
    /* $10.50 from 2026-10-13 13:20 UTC (the owner's one-off re-tune on top of the two scheduled
       ones): a run with its baseline cost $1.45, and each run must have its test's worst case
       (~$3) left when it starts. Paid by raising the day to $35.75 under the owner's $38, never
       by the live lines. */
    /* $12.75 from 2026-10-13 14:00 UTC: today's after-audit measurements (the clean baseline, coin
       matching on gold, the slow-lane and short-video tests) are paid here, because the jobs book spent
       its line this morning. The day is $38.00, the owner's approved ceiling. */
    learningLines: { dailyUsd: 12.75, posts: 1.5, judge: 10, video: 0.5, embeddings: 0.75 },
    ledgerRefreshMs: 60_000,

    /* Both on, because the owner's binding constraint is money. `paidOnlyWhenFreeIsEmpty`
       is the one with a coverage cost, stated on its field, and is the first thing to
       turn off the day the constraint becomes coverage instead. */
    freeSourcesFirst: true,
    paidOnlyWhenFreeIsEmpty: true,
  },

  /* The numbers whose reasons are on `LabelPolicy` above. Read them there; every one of
     them carries the measurement it came from, and none of them is a round number chosen
     because it looked reasonable. */
  labels: {
    definition: 'v1',
    windowDays: 30,
    peakMultipleThreshold: 5,
    peakSupportFraction: 0.9,
    minPeakSupportReadings: 2,
    minCoveredFraction: 0.99,
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
