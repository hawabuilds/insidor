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
   * ★ 10 SINCE 2026-10-14 (the owner approved up to $1 a day more on the scraping line for it, which
   * is now $4): the two places beyond `paidReadMaxSlowPosts` go only to young videos growing fast.
   * Worst case 48 × ($0.001 + 10 × $0.003) = $1.49 a day, inside the re-reads' $1.60.
   */
  readonly paidReadMaxPosts: number;
  /**
   * The most of a run's places that posts other than the young fast ones may take: the 8 a run held
   * before 2026-10-14, so the extra places are for videos under `rising.fypMaxAgeMs` that are climbing.
   */
  readonly paidReadMaxSlowPosts: number;
  /**
   * ★ A YOUNG SHORT VIDEO GROWING AT LEAST THIS MANY VIEWS A MINUTE IS RE-READ ON EVERY RUN, while
   * it is inside `rising.fypMaxAgeMs` — so the growth paths get the second and third readings
   * they need, instead of one three hours later. Views a minute between its last two readings, or
   * since it was posted when it has one. 250: the newest-first search on 2026-10-13 14:05 UTC
   * found its fastest under-an-hour videos at 280 to 480 a minute and the rest under 150; the
   * most-liked search's young ones were at 310 and 580. A raw view rate, not scaled by
   * `rising.shortVideoReachScale`: it is measured on this source alone.
   * ★ 500 SINCE 16:40 UTC THAT DAY, when the newest-first actor began finding about 120 videos a
   * run every 43 minutes: at 250, 5 of 58 measured young videos were "fast" (about 10 a run)
   * against 8 re-read places every half hour, and the growth path they are re-read for needs
   * 1,500 a minute (`rising.shortVideoFastReachPerMinute`). At 500, 3 of 58 (1,821, 930 and 707
   * a minute; about 6 a run). Fastest first, so the ones that can clear the path are read first.
   * ★ 250 AGAIN FROM 2026-10-14, with two more places a run for them: of 328 videos first read
   * under two hours old on 2026-10-13, 2.7% were at 500 a minute and 5.8% at 200, and the two
   * that went on past 150k views were at 564 and 1,240 on their first reading. Re-read from 250,
   * a video on its way to the growth paths gets the readings it needs.
   */
  readonly paidFastMinReachPerMinute: number;
  /**
   * ★ THE OFF-FEED CUT (the owner, 2026-10-16: "cut re-reads of posts over 12h old that aren't on
   * FYP"). A post from the two paid-read sources older than this, by its own post time, that is not
   * on For You — neither in the live frame nor a member of the scroll — gets no more re-reads,
   * whatever else would keep it (a passing answer, an unjudged catch-all post, a shown narrative).
   * Its last reading stands. Measured 2026-10-16: about 2,400 such reads a day on each source, some
   * $0.36 a day of the text source's reads and about $0.30 of the short-video source's. A post with
   * no post time is not shown to be old and keeps its reads. At or over `maxTrackedHours` the cut
   * changes nothing.
   *
   * What it gives up: a post over this age that would still climb onto For You late (fyp-freshness's
   * still-growing exception) is no longer re-read to show the climb, so it does not join.
   */
  readonly offFeedMaxAgeMs: number;
  /**
   * ★ THE THREE-HOUR CUT FOR A SOURCE BILLED PER POST RETURNED (the owner, 2026-10-20). The same
   * cut as `offFeedMaxAgeMs`, sooner, and only where every re-read is its own charge: a post older
   * than this by its post time that is not on For You (frame or scroll) nor in Popular's live frame
   * gets no more re-reads, whatever else would keep it. A source billed by the run keeps the
   * twelve-hour cut: its re-reads are already rationed in runs (`paidReadMaxPosts`).
   *
   * Measured over 2026-10-19 13:00–18:00 UTC: of about 2,600 such re-reads of posts never admitted
   * to For You, 4 came before an admission; replayed over that window the cut takes about 2,200 of
   * TRACK's 8,860 text-source re-reads and 1 of the 240 that came before an admission.
   *
   * What it gives up: a post between this age and For You's own age limit (`rising.fypMaxAgeMs`)
   * that would still have cleared the reach bar late is no longer re-read to show it, so it does
   * not join. It also applies to the holdout, as the twelve-hour cut does: the holdout's re-reads
   * of a post off For You end at this age too.
   */
  readonly offForYouPerPostMaxAgeMs: number;
  /**
   * ★ A YES IS READ UNTIL IT JOINS (the coordinator's brief, 2026-10-20, for the owner). A post a lane
   * found that the judge said yes to — its newest answer passing the per-post rule — and that is not on
   * For You keeps being re-read until it joins or is this old by its post time, whatever its views
   * rate: it is pulled first, read first inside the re-read day, and the three-hour cut above does not
   * stop it before this age. Measured over 13-20 Oct: about 259 such text posts a day, 85 of them
   * never read again after the yes (the Laura video: judged yes at 0.8, its views last read 47 minutes
   * before, never again). Their full grid to six hours is about 4,500 more reads a day ($0.68), taken
   * inside the re-read day's own allowance, ahead of the reads that are not a yes.
   */
  readonly judgedYesMaxAgeMs: number;
  /**
   * ★ WHICH RE-READS GO FIRST WHEN THE RE-READ DAY IS SHORT (policy.v183, the owner, 2026-10-26: For
   * You got worse at the same spend). TRACK pulls and spends in tiers (the runner's track-gate.ts
   * `rereadTier`): a found yes not on For You; then posts on a feed and found posts still waiting on
   * their answer; then posts by an account with at least `bigAccountFollowers` followers (public.author);
   * then the rest — mostly narrative members read for their pages. The rest may spend only `restShare`
   * of the paced re-read allowance (`feed.searchDay.rereadDailyUsd`); the tiers above it the whole.
   *
   * Measured over 24–26 Oct 2026: TRACK took 36,386 X re-reads (~$2.73 a day at $0.00015 a post), 46%
   * of them the rest, and the re-read day was spent by mid-morning — 48 paused batches by 08:50 UTC on
   * the 26th — so the yeses found after that waited. A post the judge said no to was already not
   * re-read (none of the 36,386 came after a no), so the money is in the order, not in a new cut.
   *
   * What breaks if changed carelessly: a `restShare` of 1 is the old behaviour, the rest free to take
   * the last of the day; near 0, narrative pages' member views go stale whenever the day is busy.
   * `bigAccountFollowers` too low makes tier 2 everyone, the same as no tier.
   */
  readonly rereadOrder: { readonly bigAccountFollowers: number; readonly restShare: number };
  /**
   * ★ A "NO" THAT IS CLIMBING FAST IS STILL READ (policy.v188, the owner, 2026-10-26). A post the
   * judge said no to (or held as politics or showbiz) is otherwise never re-read (above), so the
   * viral exception's bars (`judge.viral`, early and late) see only the one or two readings taken
   * before its answer: @PopBase's Nicki Minaj post was read at 3 and 6 minutes and next at 5 hours.
   * A post the viral exception is for, younger than `maxAgeMs`, with a reading inside `withinMs` of
   * its post time averaging `minReachPerMinute` or more, keeps its re-reads at TRACK's young cadence
   * (6, 15 or 30 minutes by its view rate, `velocityMinutes`) and is pulled with the big accounts
   * (`rereadOrder` tier 2). At most `maxPosts` at once, the fastest first.
   *
   * The bound, inside the paced re-read day (`feed.searchDay.rereadDailyUsd`, nothing added to it):
   * `maxPosts` posts read at most every 6 minutes is 3,600 reads a day, $0.54 at $0.00015 a read — the
   * ceiling; ~400 posts a day clear 5k a minute (7 days to 2026-10-26), so the cap is usually full.
   * 5k is half the early ask's bar: a post first read at 5–10k a minute is read again to see whether it
   * gets there. Off: TRACK is as in v183.
   */
  readonly fastClimb: { readonly on: boolean; readonly minReachPerMinute: number; readonly withinMs: number; readonly maxAgeMs: number; readonly maxPosts: number };
  /**
   * ★ A POST ON FOR YOU WAITS THIS MANY TIMES ITS INTERVAL between TRACK's re-reads (the owner,
   * 2026-10-20): its tier's minutes, or in its first hours its hot, warm or cold minutes. Its views
   * on screen are kept current by the readings loop (`feed.readings`, every 4 to 30 minutes while it
   * is on For You), which every TRACK schedule counts as a read; TRACK's own read of it buys little
   * more. 1 is the old cadence. The holdout keeps its full grid.
   */
  readonly onForYouIntervalFactor: number;

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
    /**
     * ★ THE EMBEDDING SWITCH. The space every picture vector is written in and read from — and the
     * runner builds the embedding port whose space this is (services/runner wiring.ts
     * `embedPortFor`), so changing it changes which model embeds. Every bar in this policy that
     * compares vectors (the three below, `postCoin.picture.minSimilarity`, the projector's
     * `boostMinSimilarity`, the narrative and story-coin meaning bars, the judge's
     * `holdNotSimilarity`) was measured in ONE space: change this and those bars in the same edit,
     * from that space's own copy test.
     */
    readonly space: string;
    /**
     * A POST's vector (its words and picture read together) in the same representation: its own
     * space, never compared with a picture-only vector. Read by every post-vector lookup (the
     * judge's precedents, the namer's examples, narratives, the projector's story match and For
     * You's variety), so a vector of another model's posts is never one of their neighbours.
     */
    readonly postSpace: string;
    /**
     * ★ THE NEXT POST SPACE, FILLED BEFORE ANYTHING READS IT (policy.v180). Null: none. Named, the
     * runner's boot fill (services/runner reembed-on-boot.ts) embeds the stored posts, labels and name
     * examples into it, while every reader still reads `postSpace` and every decision still uses the
     * bars below — nothing decides on it. The switch is a later version that sets `postSpace` to it,
     * writes `postSpaceNextBars` over the bars they name, and sets both of these back to null; the
     * fill then tops up the posts judged since in the new `postSpace`.
     */
    readonly postSpaceNext: string | null;
    /**
     * The post-space bars measured for `postSpaceNext`, keyed by each bar's path in this policy
     * ('narrative.sameMeaning'). Read by no decision: carried here rather than in a comment so the
     * switch copies values a test has checked — every key names a post-space bar that exists, and
     * every post-space bar has a key — instead of numbers retyped from prose.
     */
    readonly postSpaceNextBars: Readonly<Record<string, number>> | null;
    /**
     * ★ THE FILL INTO OUR OWN MODEL'S SPACE (policy.v171; the owner, 2026-10-24): with this on and the
     * embed service configured, the runner re-embeds what is stored once at each boot, in its own
     * process (services/runner reembed-on-boot.ts over work/reembed.ts). Resumable and idempotent;
     * turn it off once the switch has settled.
     */
    readonly backfill?: boolean;
    readonly nearIdentical: number;
    readonly likely: number;
    readonly borderline: number;
    readonly pairChecksPerDay: number;
    /**
     * ★ A COIN PICTURE ALREADY EMBEDDED IS COPIED, NOT PAID FOR AGAIN (services/runner
     * work/picture-reuse.ts): the coin universe and the coin-match step, before embedding a coin's
     * picture, copy the vector already stored for the same address — only an address that names
     * its content, so the same address is the same bytes. Measured on 2026-10-17, last 24 hours:
     * 12,670 coin pictures embedded, 5,967 at an address already embedded for another coin (copycat
     * coins launch with the picture they copy), 1,889 of them content-named; the 45,054 stored
     * pairs at those addresses agree to 0.999 cosine (the lowest 0.99899), while one mutable
     * host's pairs fell to 0.88. At 900 to 1,400 tokens a picture the 1,889 are $0.20 to $0.30 a
     * day. Nothing read changes: every
     * coin that was embedded still has its vector, bit for bit the stored one. Off until the owner
     * switches it on.
     */
    readonly reuseContentAddressed: boolean;
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
/** Which model asks one of the judge's other questions (JudgePolicy.askWith); `off` asks none. */
export type AskWith = 'open' | 'main' | 'off';

/** What our own model is taught to predict (JudgePolicy.coinModel; 0099's CHECK spells the same list). */
export const COIN_MODEL_TARGETS = ['coined', 'viral'] as const;
export type CoinModelTarget = (typeof COIN_MODEL_TARGETS)[number];

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
  /**
   * ★ WHICH KIND ANSWERS KEEP A POST OFF FOR YOU. The second question names a kind for every post
   * the first passes (core/src/qualify/kinds.ts lists the labels); a post is held back only when
   * the label it got is in this list. A policy field so the owner can widen or narrow it without a
   * code change. Chosen by measurement on 2026-10-13 (tools/retune.ts measure --rows, rules
   * alone, ten posts a call), three held sets on the same answers: no kind gate passed hand gold
   * 22/50 and live non-memes 25/93; ads only 21/50 and 20/93; these five 20/50 and 12/93; missed
   * posts 3/7 under all three. The kind gate costs hand gold one or two posts and keeps eight to
   * thirteen non-memes off For You, so the five old categories hold. Tragedies and company or
   * media news are named by the kind question but not held.
   */
  readonly heldKinds: readonly string[];
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
  /**
   * ★ THE OWNER'S LABELLED POSTS, SHOWN AS PRECEDENT IN EVERY POST-JUDGE CALL (the owner,
   * 2026-10-13). Each post sent to the feed's judge is embedded (its words and picture together)
   * and its `k` closest labelled posts — the owner's "is a meme" / "not a meme" calls, coined
   * posts, gold — go in the call with the owner's label. Every label is a candidate, not a capped
   * block. `maxChars` of each example's words are sent. `labelsPerPass` new labels are embedded a
   * pass, so a tap reaches the next calls within minutes.
   *
   * ★ `holdNotSimilarity`: a post at least this close to one the owner called "not a meme" is held
   * (kind label NOT_MEME_MATCH, in `heldKinds`). Chosen on the labelled set itself, leave one out:
   * the lowest bar at which not one gold, coined or owner-meme post would be held. See the
   * measurement on the value.
   */
  readonly precedents: {
    readonly k: number;
    readonly maxChars: number;
    readonly holdNotSimilarity: number;
    /** The not-a-meme hold's bar for a post with no words: its picture alone, held only when near-identical (policy.v184). */
    readonly holdNotSimilarityNoWords: number;
    readonly labelsPerPass: number;
    /**
     * Of the `k`, up to this many go to the closest labels from the post's own source, shown first
     * (core `ownSourceFirst`; the owner, 2026-10-16: the short-video judge uses short-video
     * examples first). 0 is off: the closest `k` of any source, as before. $0 a day either way.
     */
    readonly sameSourceFirst: number;
    /**
     * ★ THE OPEN JUDGE'S OWN NUMBER (the owner, 2026-10-16: "Gemma gets the 30–50 most similar
     * examples from all my history"). The open model is sent each post's `openK` closest labels,
     * the main judge its `k`; the labels are the same set (every owner tap, missed post, gold post
     * and coined post, internal.label_embedding), and each labelled post goes once per call however
     * many posts it is near. `openMaxInputTokens` caps a call's pessimistic input estimate: over
     * it, every post in the call keeps fewer, the farthest dropped first, so a call always fits the
     * model's window.
     */
    readonly openK: number;
    readonly openMaxInputTokens: number;
  };
  /**
   * ★ WHICH OF THE TWO FEED JUDGES ANSWERS FIRST (the owner, 2026-10-16: "switch the judge to the
   * open model this evening"). `main` is the judge the system was built on (JUDGE_MODEL); `open` is
   * the open model behind a chat-completions host (OPEN_JUDGE_MODEL). Named by role because
   * contracts may not name a vendor; the runner maps each to its adapter. Both are asked the same
   * question with the same learned block, precedents, close-match hold and kind question. Applies to
   * the feed's post question; the kind question, the narrative question, the namer, the translator
   * and the same-subject question follow `askWith` below. With no key for the open model, `open`
   * here still runs `main`, and the boot says so.
   */
  readonly primary: 'main' | 'open';
  /**
   * The open model on its first host is the only judge: the main judge and the open model's second
   * host are left dormant at boot whatever keys are set (the owner, 2026-10-20: "openrouter only as
   * judge"). Their failover had kept billing the second host ($5.97 in a day and a half) and kept
   * asking the main judge, whose account is empty.
   */
  readonly openOnly: boolean;
  /**
   * ★ EACH OPEN MODEL'S OWN YES/NO CUTOFF (the owner, 2026-10-17: "switch the live post judge to
   * Nemotron at cutoff 0.70, Gemma 3 as its automatic fallback"). A confidence is a model's own
   * scale: Nemotron's yeses on hand gold sit at a median 0.88, so the 0.90 the evening re-tune chose
   * on Gemma's answers passes 39% of gold for it, against 63% at 0.70. So an answer is held to the
   * cutoff of the model that gave it, read per answer because every failover puts both models'
   * answers on the feed side by side. Named by place, because contracts may not name a vendor:
   * `primary` is the model that answers the post question first, `fallback` the one behind it; the
   * judge adapter says which stored judge ids are which (setup.ts `answerSide`), by the model, so a
   * model's answers keep their cutoff whichever order the runner asks them in.
   *
   * Each number is that model's bar until a re-tune has chosen one on its own answers: the re-tune
   * grades with the primary and stores the cutoff it chose WITH the block and the model it was
   * chosen on (0086, 0094), and from then on that model's answers are held to the block's. null:
   * the applied block's cutoff. Like the block's, either only ever raises the policy's own bars
   * (core `withJudgeCutoff`), never lowers them.
   */
  readonly cutoffs: {
    readonly primary: number | null;
    readonly fallback: number | null;
  };
  /**
   * ★ THE FEED NEVER WAITS ON ONE SUPPLIER (the owner, 2026-10-16: "if it errors, is slow, or runs
   * out of credit, the other takes over straight away, and the other way round too"). A batch the
   * primary judge fails — an error, no answer for any post, a billing refusal, or no reply within
   * `deadlineMs` — is asked of the other judge at once, and the primary rests for `coolDownMs`
   * (`creditCoolDownMs` after a billing refusal, which a person has to fix) before it is tried
   * again; while it rests the other answers every batch. `deadlineMs` is the whole batch's wall
   * clock, retries included: the open model's slowest tenth of calls took about 7.7 s a post, 77 s
   * for ten, on 2026-10-15. 135 s from 2026-10-16: the open judge's worst case by `open` (a first
   * round under 60 s, then a re-ask round of two 35 s tries) is 132 s, and at 90 s a batch whose
   * first provider hung was cut off just as its second provider was answering. Off: the primary
   * alone, as before.
   */
  readonly failover: {
    readonly on: boolean;
    readonly deadlineMs: number;
    readonly coolDownMs: number;
    readonly creditCoolDownMs: number;
  };
  /**
   * ★ THE OTHER JUDGE, ASKED BESIDE THE LIVE ONE AND NEVER SHOWN (the owner, 2026-10-16: "the open
   * model judges every live post alongside the live judge until the switch"). Every batch of posts
   * the live judge answers is sent, unchanged, to the judge that did not answer it; its answers go
   * to their own table (0089), which nothing on the feed reads. Spent on the live book and stopped
   * for the UTC day at `dailyUsd` (kept in the capped lanes' ledger, so a restart does not refill
   * it). At most `maxInFlight` batches wait on it at once; a batch past that is skipped and counted,
   * so a slow shadow can never hold up the live judge.
   */
  readonly shadow: {
    readonly on: boolean;
    readonly dailyUsd: number;
    readonly maxInFlight: number;
  };
  /**
   * ★ THE JUNK FILTER BEFORE THE POST JUDGE (the owner, 2026-10-16: "posts it's confident are junk
   * skip the judge; tune it so it never drops gold or missed posts"). A logistic regression over the
   * post's words-and-picture vector (the precedents' own) says how sure it is the post is junk; with
   * `on`, a post at or over the applied fit's threshold is not asked the post question and is
   * recorded as not asked (internal.junk_skip, 0091) — never as a "no". A post with no vector, or
   * no applied fit, is judged as before. The fit and its threshold are refitted at each re-tune
   * (tools/lib/junk-filter.ts) and stored in internal.junk_filter; these are the bars it is fitted to:
   * `l2` its ridge, `folds` the held-out split, `margin` added above the highest held-out score of
   * any hand gold or missed post, and `minProtected` the fewest such posts with a vector for a
   * threshold to be trusted at all.
   */
  readonly junkFilter: {
    readonly on: boolean;
    readonly l2: number;
    readonly folds: number;
    readonly margin: number;
    readonly minProtected: number;
  };
  /**
   * ★ OUR OWN COIN MODEL, A SAFETY NET BEHIND THE JUDGE (the owner, 2026-10-18: "if the judge says
   * no but our model is sure the post will get coined, the post still goes to For You"). A
   * class-weighted logistic regression over the post's words-and-picture vector (the precedents'
   * own space) and a few dozen facts we already hold at the moment the judge answers — reach for
   * age, reach a minute, how fast that rises, replies and approvals so far, post type, source,
   * language, account size, catchphrase hints from the words (core `coinModelFeatures`). It is fitted
   * on our own rows at each re-tune (tools/lib/coin-model.ts) and stored in internal.coin_model
   * (0096) with the threshold it chose; the runner scores each post the judge did not pass, once,
   * in its own loop, and stores the score (internal.coin_model_score).
   *
   * `shadow` scores and stores only: nothing reaches For You. `on` lets the projector take a post
   * the judge did not pass when its stored score is at or over the threshold and every other gate
   * still passes (held kinds and the close-match hold, the owner's Not a meme, the reach bar, age).
   * `threshold` overrides the fit's own when set; null takes the fit's.
   *
   * The fit: `l2s` the ridges tried (chosen on the newest `validationShare` of the training time,
   * never on the test), `negativeShare` of never-coined posts kept by a hash of the id (all coined,
   * labelled and owner posts are kept), a post counted coined when a coin was launched `lateMs` or
   * more after it by an account that does not coin its own posts (`deployerWindowMs`,
   * `deployerMinPosts`, as `learning.coinedYes`). The threshold is the lowest at which, on the
   * validation slice, For You's junk (the old judges' labels) rises at most `maxJunkRise` and the
   * extra posts stay at or under `maxExtrasPerHour`. A refit replaces the applied one only when it
   * catches more of the owner's held-out missed posts with no more junk (`tools/lib/coin-model.ts`).
   *
   * The runner: each pass scores at most `maxPerPass` posts answered in the last `lookbackMs`. It is
   * refitted at the re-tune slots in `refitAt` only.
   * `text` sizes the catchphrase hints: a quoted phrase of at most `maxQuotedWords` words, a word in
   * capitals of at least `minCapsLetters` letters, a text of at most `shortWords` words.
   *
   * ★ TWO TARGETS (the owner, 2026-10-18: "retrain it to predict memeable and about to go viral";
   * 0099). `coined` is fit 1's: a coin launched for the post late, by others. `viral` is the owner's
   * measure: the post went over the scorecard's viral line from under it (tools/lib/scorecard.ts
   * `VIRAL_LINE`) and he never tapped it Not a meme, or he called it a meme (gold, his meme taps,
   * his taught missed posts); his Not a meme taps and his no calls are no, and so is a post that
   * never went viral. A coin known by the decision is one input of the viral fit, never its label.
   * `targets` are the ones the re-tune refits and the runner scores, each with its own latest applied
   * fit and one score a post; `liveTarget` is the one whose would-add `on` lets onto For You — a
   * target not live is shadow only, whatever `on` says, and scores with its newest fit even one that
   * failed the gate (the gate decides whether a fit may act, not whether it is watched); the live
   * target scores with its applied fit only. `viral.settleMs`: a post decided less than
   * this long ago has not had its day to go viral, so it is neither fitted nor tested on.
   */
  readonly coinModel: {
    readonly on: boolean;
    readonly shadow: boolean;
    readonly targets: readonly CoinModelTarget[];
    readonly liveTarget: CoinModelTarget;
    readonly viral: { readonly settleMs: number };
    readonly threshold: number | null;
    readonly l2s: readonly number[];
    readonly validationShare: number;
    readonly negativeShare: number;
    readonly lateMs: number;
    readonly deployerWindowMs: number;
    readonly deployerMinPosts: number;
    readonly maxJunkRise: number;
    readonly maxExtrasPerHour: number;
    readonly maxPerPass: number;
    readonly lookbackMs: number;
    /** The re-tune slots (London clock, as `learning.retuneAt`) at which it is refitted. */
    readonly refitAt: readonly string[];
    readonly text: {
      readonly maxQuotedWords: number;
      readonly minCapsLetters: number;
      readonly shortWords: number;
    };
  };
  /**
   * ★ HOW THE OPEN JUDGE ASKS (measured 2026-10-16 on 58 real posts from the shadow's own batches,
   * after it left 19% of shadow posts and most of the evening's live batches unanswered). Ten posts
   * a call made the model skip posts (the text-only posts among pictured ones) or repeat posts, and
   * took 15–60 s, so a hung provider or a slow one ran a batch past the failover's deadline. Five
   * posts a call skipped none on the first provider, and the calls of one batch go side by side
   * (`parallel`), so ten posts take about one five-post call. A post a reply still skipped or cut
   * off is asked again `reask` times, but only while the batch is under `reaskWithinMs`, so the
   * re-ask cannot carry it past the deadline. `timeoutMs` and `maxAttempts` are per call, each
   * retry starting at the next pinned provider (the adapter's `rotated`): two tries of 35 s, plus
   * one re-ask round, stay inside `failover.deadlineMs`. 35 s and 60 s rather than 40 s and 45 s
   * from the second copy test: a first provider that hung for 40 s and then a second that looped
   * ended the first round at 72 s, past a 45 s re-ask limit, and five posts went unanswered; at
   * 35 s and 60 s, 116 of 116 were answered, 1.1 s a post median (most five-post calls take
   * 6–30 s). `answerTokensPerPost` sizes the answer
   * budget to the batch (about 80 used a post), so a looping provider is cut off at 900 tokens, not
   * 1,200, and its posts are re-asked.
   *
   * ★ `answerTokensPerPost` FROM THE MEASURED ANSWERS (2026-10-20): 20 of the live judge's own
   * ten-post calls, rebuilt from the stored posts and asked of the router's provider, answered in a
   * median of 74 tokens a post, 84 at the 90th percentile and 92 at most, with no reasoning tokens.
   * 120 a post, one post spare, is about 1.6 times the median call and 1.3 times the longest; a
   * full call of ten stays at `postBatchMaxOutputTokens`. What it bounds: at the provider's $0.50 a
   * million output tokens, a call that runs to its cap costs about $0.0006 more than its input,
   * against about $0.003 for the whole of a normal ten-post call, so no answer can make a call cost
   * more than about 1.2 times normal. What it gives up: a call whose answers are longer than this
   * (long name lists) stops at the cap and its posts are asked again, then left unanswered.
   */
  readonly open: {
    readonly batchSize: number;
    readonly parallel: number;
    readonly reask: number;
    readonly reaskWithinMs: number;
    readonly timeoutMs: number;
    readonly maxAttempts: number;
    readonly answerTokensPerPost: number;
    /**
     * Posts a call for the primary open model (Policy.judge.cutoffs `primary`), in place of
     * `batchSize`: measured 2026-10-17 on 120 hand-gold posts at ten a call, Nemotron answered all
     * 120 in 14 calls, re-asks included, in 26 s (0.22 s a post), so ten a call costs one call where
     * five would cost two and send the same 40 precedents twice.
     */
    readonly primaryBatchSize: number;
  };
  /**
   * ★ WHO ASKS EACH OF THE OTHER QUESTIONS (the owner, 2026-10-16: "move everything that can run on
   * the open model to it", then "no main-judge API at all from now on, not even as a fallback"):
   *   names        the coin names a post will be launched as (Policy.names)
   *   translate    a feed post's words in English (Policy.translate)
   *   sameSubject  whether two borderline pictures show the same subject (GROUP, coin matching)
   *   kind         the feed's second question, which kind of post
   *   stories      QUALIFY's question about a narrative
   * `open`: the open model (OPEN_JUDGE_MODEL), with the backup open model behind it through the
   * same failover (`failover` above), and the main judge nowhere in the chain. `main`: the main
   * judge as before (kind: by `primary`'s roles). `off`: not asked — a name or translation is
   * absent, a post's kind is not asked (its first answer stands), a narrative abstains
   * (Q1_unjudged), a pair carries no picture evidence. With no key for the model named, the
   * question is not asked either, and the boot says which model each question went to.
   */
  readonly askWith: {
    readonly names: AskWith;
    readonly translate: AskWith;
    readonly sameSubject: AskWith;
    readonly kind: AskWith;
    readonly stories: AskWith;
  };
  /**
   * ★ EARLY JUDGING (the owner, 2026-10-16: "build early judging with Gemma"). A catch-all post is
   * judged only once its views clear For You's bar (rising, core `clearsReachBar`), so a post that
   * clears it waits a judging pass before it can show, and a post coined in the minutes before it
   * clears is never shown first. This judges the likeliest of them before the bar: a never-judged
   * post a lane in `lanes` found, posted at most `maxAgeMs` ago, not yet over the bar, whose views
   * have averaged at least `minReachPerMinute` a minute since it was posted (times
   * `rising.shortVideoReachScale` for the short-video source) at a reading of at least `minReach`, and
   * which has at least `minApprovals`. Fastest first, at most `maxPerPass` a pass, every `everyMs`, in
   * its own loop (never in the discovery pass), and at most `dailyUsd` a UTC day of judge and
   * embedding spend, kept in internal.lane_spend (lane `judge_early`) and failing closed. The answer
   * is filed as any other; the reach bar still decides whether the post is shown.
   *
   * Measured 2026-10-16 over the three days before (scratch early/sim2.mjs): lanes all, slow and
   * media were where every coined post found before its coin and not judged before it was found
   * (27 of 27); the short-video lanes had none. At 400 a minute within two hours about 3,700 posts a
   * day are asked early, about 2,000 of which the reach bar would never have sent to the judge; 11
   * of those 27 coined posts would have been judged before their coin (6 at 1,000 a minute, 14 at
   * 250 for 3,200 extra posts a day).
   */
  readonly early: {
    readonly on: boolean;
    readonly lanes: readonly string[];
    readonly maxAgeMs: number;
    readonly minReach: number;
    readonly minReachPerMinute: number;
    readonly minApprovals: number;
    readonly maxPerPass: number;
    readonly everyMs: number;
    readonly dailyUsd: number;
  };
  /**
   * ★ THE QUOTE BOOST (the owner, 2026-10-20, after the "going up forever, Laura" miss). A post we
   * already stored, by another account, that a big account has just reproduced — quoted it
   * (public.item.reproduction_of) or posted the same picture or video (the same first media address)
   * — is judged at once, whatever its views, and credited to the 'quoted' lane (0116) so TRACK
   * re-reads it and For You may show it when it clears the bar. Big: at least `minFollowers`
   * followers as last read, or an account on the account watch's list (feed.accountWatch). Once: an
   * original with any judgement is never asked again.
   *
   * Read every early pass (its loop, `early.everyMs`), whether or not `early.on`: the reproducing
   * posts first seen in the last `windowMs`, originals posted in the last `maxOriginalAgeMs`, at most
   * `maxPerPass`, ahead of the early picks. Charged to internal.lane_spend lane 'quoted', at most
   * `dailyUsd` a UTC day, failing closed. The junk filter is not applied: a big account's choice is
   * stronger evidence than the fit.
   *
   * Why: AlexesNakamoto's post (2026-10-20 12:56 London) was stored at 1,007 views at 13:09 and never
   * judged or re-read; Michael Saylor (5.2M) reposted its video at 13:37 and only his post was
   * judged. Measured over the three days to 2026-10-20: about 50 stored, never-judged originals a
   * day are reproduced by 1M+ accounts (quotes ~13, same media ~37), ~$0.0005 a post judged with its
   * precedents' embeddings: ~$0.03 a day. The cap is a busy day's.
   */
  readonly reproductionBoost: {
    readonly on: boolean;
    readonly minFollowers: number;
    readonly windowMs: number;
    readonly maxOriginalAgeMs: number;
    readonly maxPerPass: number;
    readonly dailyUsd: number;
  };
  /**
   * ★ THE VIRAL EXCEPTION (the owner, 2026-10-26: "let viral politics/showbiz through", after
   * @PopBase's "Trump says Nicki Minaj has a beautiful a**" — judge no, 2.96M views — and @elonmusk's
   * "So beautiful" — judge no, 590k in 51 minutes). A post the post question said no to, or the kind
   * question held as one of `liftsKinds`, whose views clear a huge-and-fast bar, is asked a second,
   * narrower question (the judge adapter's viral-moment prompt: is the post itself a moment people
   * coin?) and then the kind question. It reaches For You — For You only, never Popular — when the
   * moment answer is a yes at `minConfidence` or more with a name of at most `rising.maxNameWords`
   * words AND the kind answer is one of `passKinds`: a TRAGEDY, an ad, sport, fandom, company or
   * media news never pass this way, whatever the moment answer said. The owner's "Not a meme" (on the
   * post, or a close match to one: NOT_MEME_MATCH), a shill and every other held kind still hold.
   *
   * The bar: some view reading within `maxAgeMs` of the post at `minReach` or more, at an average of
   * `minReachPerMinute` or more since the post. Chosen 2026-10-26 on the seven days before
   * (read only; posts found through a coin's link left out): at 500k and 8k a minute, judge-"no"
   * posts were coined within six hours as often as judged-yes posts over For You's own 40k bar (17%
   * and 17%), but that share is almost all automated launches on one account's every post (6% with
   * it left out) and none of them ran to $200k (5 judged-yes posts did) — so the bar alone does not
   * earn For You, and the second question does the choosing. ~73 posts a day clear it. Both posts
   * above clear it. Asked of 50 of that week's posts on Nemotron ($0.0076, ~$0.00015 a post): two
   * moment yeses, the Nicki Minaj post ("BEAUTIFUL ASS", 0.93) and once, unsurely, a renaming of New
   * Mexico; every sports, injury and death post a no; "So beautiful" a no even with the quoted video
   * beside it. ~$0.01 a day, ~$0.35 a month.
   *
   * Asked in the early loop (work/viral-moments.ts), at most `maxPerPass` posts a pass, charged to
   * internal.lane_spend lane 'viral' and stopped at `dailyUsd` a UTC day (failing closed). One ask a
   * post, its answer in internal.viral_moment (0138): never in post_judgement, so no reader of a
   * post's newest answer is changed by it. Off: nothing is asked and nothing passes this way.
   */
  readonly viral: {
    readonly on: boolean;
    readonly minReach: number;
    readonly minReachPerMinute: number;
    readonly maxAgeMs: number;
    readonly liftsKinds: readonly string[];
    readonly passKinds: readonly string[];
    readonly minConfidence: number;
    readonly maxPerPass: number;
    /** Times the kind question is asked about one "yes" moment before it is left unanswered (0138 kind_asks). */
    readonly maxKindAsks: number;
    readonly dailyUsd: number;
    /**
     * ★ ASKED WHILE THE POST IS FRESH (policy.v188, the owner, 2026-10-26: "i dont want to catch that
     * post 6 hrs later i want to catch it when it was fresh"). A post this exception is for is asked
     * the same two questions as soon as a reading within `withinMs` of its post time shows it averaging
     * `minReachPerMinute` views a minute or more since it was posted — not only once it is huge.
     * Everything else is as above: one ask a post, the same caps, the same pass rule. The moment
     * question is the filter; this bar only says when to ask it.
     *
     * Chosen 2026-10-26 on the seven days before (read only; coin-link finds left out; @elonmusk left
     * out, his every post is coined by a bot): of the judge's "no"s and politics/showbiz holds, the
     * share with a coin launched AFTER the moment they would have been asked, against judged-yes posts
     * over For You's 40k bar with a coin launched after their answer (6.0%):
     *     10k a minute within 30 min   128 posts a day   6.9%
     *      5k                          400               3.4%
     *     an account of 1M+ followers  2,683             1.1%   (3M+: 1.4%, 10M+: 1.3%)
     * With the accounts whose posts are coined half the time or more left out on both sides: 2.6%
     * against 3.8%. No follower count alone comes near, so there is no follower trigger: a big account
     * still has to show the climb. 10k a minute is the lowest bar whose posts are coined as often as
     * judged yeses are; ~128 asks a day at ~$0.00023 an ask (0138's measured cost), ~$0.03 a day.
     * Asked of 100 of that week's posts over it on Nemotron ($0.011): one moment yes (0.7, a name too
     * long to pass), so none passes; the 28 of them coined were bot-coined accounts' posts (@elonmusk,
     * @Polymarket, @SpaceX…), every one a no. The question, not the bar, keeps For You clean.
     */
    readonly early: { readonly on: boolean; readonly minReachPerMinute: number; readonly withinMs: number };
  };
  /**
   * ★ A MEGA ACCOUNT BRINGS AN OLD POST BACK (the owner, 2026-10-26, after @elonmusk quoted
   * @tetsuoai's 16-day-old "hello, world" video with "So beautiful" at 06:58 UTC). An account with at
   * least `minFollowers` followers as last read quoting a stored post (public.item.reproduction_of),
   * or posting the same picture or video under its own name (the same first media address, as the
   * quote boost reads it), makes that post a moment NOW, whatever its age. The original is asked the
   * post question again with the share beside it (JudgeSubject.sharedBy: who, their followers,
   * quoted or posted the same media, and their words), filed like any answer and held to the usual
   * bar; the owner's labels, the not-a-meme match and the kind question apply as on every ask. If
   * that answer passes, For You counts the post's age from the share's time, not its own, for its
   * usual six hours (`rising.fypMaxAgeMs`), and the card says who shared it. Every other gate — the
   * owner's "Not a meme", held kinds, shills, the junk bar, variety, promotions — holds as for any
   * post. The card's own post time stays the post's: that is a fact.
   *
   * Asked once per share (internal.resurfacing, 0139), in the early loop before the quote boost (so
   * a young, never-judged original meets the share first), at most `maxPerPass` a pass, for shares
   * first seen in the last `windowMs`; charged to lane 'resurface' in internal.lane_spend and stopped
   * at `dailyUsd` a UTC day, failing closed.
   *
   * Measured 2026-10-26 over the 14 days before (read only): 23 quotes by 10M+ accounts of stored
   * posts more than twelve hours old (1.6 a day; 21 of them @elonmusk's; no same-media repost at
   * 10M+), and 348 of younger ones. A coin linked to the original or the share was made after the
   * share for 20 of the 23 — the launchers that coin every big account's post — and none of those
   * coins reached $50k (5M–10M accounts: 95 old originals, 17 coined after, 1 reached $50k). Being
   * shared by a huge account all but guarantees a coin and, alone, is no sign of one that runs, so
   * the bar is NOT lowered: the judge decides with the share in view, at its usual bar. Asked of
   * those 23 with the share beside them (Nemotron, the applied block, no precedents; $0.007): one
   * yes (@cz_binance's quote, "FOUR", 0.8); "hello, world" a no at 0.9 with and without the quote,
   * three times each — the share is shown, never a lift. One post
   * question with precedents is ~$0.0005: ~$0.03 a month at 1.6 a day, ~$0.40 at every 10M+ share
   * of any age (~25 a day).
   *
   * Off: nothing is asked, and the projector counts every post from its own time.
   */
  readonly resurface: {
    readonly on: boolean;
    readonly minFollowers: number;
    readonly windowMs: number;
    readonly maxPerPass: number;
    readonly dailyUsd: number;
    /**
     * THE KEY ACCOUNTS (the owner, 2026-10-26, Dandy): the platform adapter's list of crypto accounts
     * whose share counts whatever their follower count (adapters/platform/x key-accounts.ts). A post
     * one of them shares (a repost included, 0140) is asked again with the share in view, and when the
     * answer passes it joins For You without the views bar: a post minutes old cannot clear it, and
     * the share is the evidence its views would be. False is the rollback.
     */
    readonly keyAccountsOn: boolean;
  };
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
  /**
   * How long a coin's aggregator answer (a route, or "no route") is reused before the
   * aggregator is asked again. Only for a coin off its curve: a curve's state is read
   * again on every pass, because a curve that just finished can no longer be traded on
   * it and a card must not say otherwise. A route that appears or vanishes shows on the
   * cards within this window, which is the price of not asking a rate-limited quote
   * service about the same coin every five minutes.
   */
  readonly poolRouteReuseMs: number;
  /**
   * How many coins one pass may ask the aggregator about. Coins over it are written as
   * not asked (not tradable, nobody named as quoting), never as "no route". The coins on
   * screen are read first, so they are the last to be dropped at this bound.
   */
  readonly maxPoolProbesPerPass: number;
  /**
   * ★ THE FIRST HOUR, READ DENSELY (policy.v165, services/market db.ts `firstHourCoins`): every
   * candidate launched in the last `withinMs` that a post or narrative ties by a link, its stated
   * name or its picture, read on every pass — the coins of posts on For You first, then the made
   * ties, the newest launch first — at most `perPass`. And a second, light pass (`light`) every
   * `light.everyMs` that reads only these coins and asks the aggregator at most `light.maxProbes`.
   */
  readonly firstHour: {
    readonly on: boolean;
    readonly withinMs: number;
    readonly perPass: number;
    readonly light: { readonly on: boolean; readonly everyMs: number; readonly perPass: number; readonly maxProbes: number };
  };
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
  /** The second way launches arrive: a listing read beside the socket. See `LaunchListingPolicy`. */
  readonly launchListing: LaunchListingPolicy;
}

/**
 * ★ THE LAUNCH LISTING, read by the launch watcher beside its socket (2026-10-19).
 *
 * The relay's socket does not send launches made in version-1 transactions: on 19 Oct it
 * delivered 66 of 155 launches a listing named over six minutes, and every traced miss but one
 * was version 1. A free listing of the chain's newest pools names them a few minutes after launch
 * (it indexes about three minutes behind and caches each page up to a minute); without it they
 * arrived only when a post's name search happened to find them, a median of about an hour later.
 *
 * It is a SECOND source, never a coverage claim. The coverage log stays the socket's, because a
 * listing minutes behind with a few pages of horizon cannot vouch that a window is complete.
 *
 * - `on`: false stops the reads; the socket is unaffected.
 * - `everyMs`: how often a pass runs. Every 30 s, because the source's pages change at most once
 *   a minute; asking more often buys the same answer.
 * - `pagesPerPass`: how far back a pass may read. A page holds 20 pools (about 30 s of launches
 *   at a busy hour) and a pass reads until it meets the previous one, plus one page for the
 *   cache's skew: two to four pages in ordinary traffic. Each page is one request on a free API
 *   that allows about 30 a minute per address, shared with whatever else runs there — or, with
 *   the plan's key, one credit, counted against `dayCapPages`.
 * - `maxAgeMs`: a listed launch older than this is not added. The listing is for launches the
 *   socket missed now, not a backfill of history.
 * - `timeoutMs`: one request's limit, listing or chain read alike.
 *
 * What breaks if changed carelessly: `everyMs` far below 30 s spends the shared free limit on
 * cached answers and gets refused (the pass then skips; nothing is lost but time); `pagesPerPass`
 * too low for a busy minute and the pass notes that it fell behind, and launches between its last
 * page and the previous pass are not listed.
 */
export interface LaunchListingPolicy {
  readonly on: boolean;
  readonly everyMs: number;
  readonly pagesPerPass: number;
  readonly maxAgeMs: number;
  readonly timeoutMs: number;
  /**
   * ★ THE CHAIN READS' DAY (2026-10-20). A pass's chain read (one per `ACCOUNTS_PER_CALL` new coins,
   * so one a pass in any traffic a pass's pages can hold) costs `creditsPerCall` of the key the
   * trade feed uses, whose free day is about 33k credits and whose feed already takes 8–14k. At most
   * `dayCapCredits` a UTC day; past it, listed coins are still added, without a metadata link.
   */
  readonly creditsPerCall: number;
  readonly dayCapCredits: number;
  /**
   * ★ THE LISTING'S OWN DAY (2026-10-20), when it reads with the market data plan's key. Keyless,
   * from the host's shared address, it was refused (429) often enough to fall behind; keyed, each
   * page is one credit of a monthly plan (500k) whose other readers already take about 8.4k a day.
   * At most `dayCapPages` pages a UTC day, and never more than an even pace through the day plus
   * `paceSlackPages`: a pass that would run ahead is held, and the next one reads further back, so
   * a busy hour spaces the passes out instead of raising the day. Not applied keyless.
   */
  readonly dayCapPages: number;
  readonly paceSlackPages: number;
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
 * ★ A SEARCH LANE'S OWN DAILY CAP (0088's ledger). The live book's `budget.dailyUsd` stops every
 * call when the day is spent, and the supplier lines only warn (`budget.vendorLinesStop`), so
 * without this a new lane can spend as much of the day as its posts cost. With it, a lane asks
 * nothing more once its search bill plus the judging it brings in reaches `dailyUsd`, and the rest
 * of the live book is untouched.
 *
 * The judging is charged to the lane at the moment it finds the posts, as an estimate: each post
 * no lane had found before, times `judgeUsdPerPost`, times `judgedShare` (the share of such posts
 * the judge is asked about at all; the rest stay under For You's reach bar). The judge's own bill
 * is metered where it happens and is not split by lane, so this is the only place a lane's
 * judging can be stopped before it is incurred.
 *
 * What breaks if changed carelessly: a `judgedShare` well under the real share lets the lane's
 * true day run past its cap by the difference, on the judge's line. It is measured per lane.
 */
export interface LaneCapPolicy {
  readonly dailyUsd: number;
  readonly judgeUsdPerPost: number;
  readonly judgedShare: number;
}

/** One catch-all search's paging (`FeedPolicy.paging`). Only `full` is read while it is false. */
export interface SearchPagingPolicy {
  readonly full: boolean;
  readonly maxPages: number;
  readonly passDeadlineMs: number;
  /** Its search bill a UTC day, at most: today's measured spend when it was set. */
  readonly dailyUsd: number;
  /**
   * ★ SPREAD OVER THE DAY (policy.v158): with `paced`, the search may have spent only `dailyUsd` ×
   * (the share of the UTC day gone, plus `feed.searchDay.aheadMs`) at any moment (core
   * `pacedDailyUsd`), so it asks less often instead of stopping for the day. A pass held back is not
   * lost: its band's next window starts where the last answered one ended (core `bandWindow`).
   * Without it the newest band spent its $1.55 by 14:40 UTC on 23 Oct, and posts found after were
   * found at a median 52 minutes old instead of 9.
   */
  readonly paced?: boolean;
}

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
   * origin posts were filtered out (eval/src/gold/recall-report.md; about $0.10 a day more). And
   * Portuguese, for a missed post of the owner's (2026-10-14).
   * ★ EACH LANGUAGE IS ITS OWN SEARCH (2026-10-18, services/runner/src/work/languages.ts): the posts
   * supplier answers an OR of languages with the last one only, so every search here is asked once a
   * language, and a language added costs at least one billed page on every ask of every lane.
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
   * ★ WATCH WORDS PER ASK on the short-video source's newest-first search: consecutive words of
   * `hashtags`, rotated by the clock, each searched at once in its own run. At 4 an ask is quoted
   * at $0.0546 (4 × ($0.00022 to start + $0.00233 for the word + 30 × $0.00037 a video)), so
   * `budgetShare` of the $3 line ($1.80) spaces asks 44 minutes apart: 33 asks a day, each of the
   * 14 words searched every 2.6 hours, and 83 to 117 new videos an ask as measured (some words come
   * back short or empty). More words an ask is the same money in fewer, larger asks.
   * ★ 2 FROM 2026-10-14, with `watchAskEveryMs` at 15 minutes: 96 asks a day of 2 words, each of
   * the 8 words searched every hour. Measured at $0.0099 a word's run, $1.90 a day against $1.54.
   */
  readonly watchWordsPerAsk: number;
  /**
   * ★ HOW OFTEN THE WATCH WORDS ARE ASKED, when set: every this many milliseconds, in place of the
   * spacing derived from `budgetShare` of the line (discover.ts `watchEveryMs`). The meter still
   * checks every ask against the line. Null keeps the derived spacing. The owner asked for every 15
   * minutes on 2026-10-14 and approved up to $1 a day more on the scraping line for it.
   */
  readonly watchAskEveryMs: number | null;
  /**
   * ★ EXTRA WATCH WORDS, LESS OFTEN (the owner's missed short videos, 2026-10-15). With `on`, every
   * `everyAsks`-th watch ask (by the clock's ask slot, so it survives a restart) also searches
   * these words, each in its own run, on top of the ask's `watchWordsPerAsk` words of `hashtags`.
   * For words whose search returns the most-watched videos of the last several hours rather than
   * the newest minutes: asking them every quarter-hour would buy the same videos four times. Each
   * extra word is one more run on the short-video line every `everyAsks` × the ask spacing. Off:
   * the asks are exactly `hashtags` as before.
   */
  readonly watchExtra: { readonly on: boolean; readonly words: readonly string[]; readonly everyAsks: number };
  /**
   * The oldest a watch-list post may be and still be judged and shown. The short-video search is
   * asked for its most-liked videos of the past day; anything older the vendor sends anyway is
   * stored and never credited to the watch lane (0061), so it never reaches the feed.
   */
  readonly watchMaxAgeMs: number;
  /**
   * ★ THE SHORT-VIDEO SOURCE'S SECOND VENDOR FOR RE-READS AND CREATOR PAGES (the owner's approval,
   * 2026-10-15). With `on`, a video re-read and a creator's latest page go to the second vendor first
   * (one credit each) and the first scraper is the automatic backup: `failAfter` failures in a row
   * (an error or an empty answer), or a refusal to pay, move the work to it and the owner is told
   * once; the second vendor is tried again every `retryAfterMs`. From `backupUntil` (an ISO instant,
   * a week after the switch) there is no backup. The owner is also told when the vendor's balance,
   * read off its answers each `balanceEveryMs`, is under `lowCredits`. Keyword search is not moved:
   * the second vendor's newest-first search returns far older videos (adapter header). Off: every
   * call goes to the first scraper, exactly as before.
   */
  readonly secondVendor: {
    readonly on: boolean;
    readonly failAfter: number;
    readonly retryAfterMs: number;
    readonly backupUntil: string;
    readonly lowCredits: number;
    readonly balanceEveryMs: number;
  };
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
    /**
     * ★ ITS MONEY A DAY, when set (the owner's re-split, 2026-10-19): the floor steers toward this
     * many dollars of posts a day over its passes in place of `share` of the line. Null: `share`.
     */
    readonly dailyUsd: number | null;
    /**
     * ★ THE LANGUAGES IT AND THE LATE BANDS (`fresh.late`) ASK, when set, each as its own search;
     * null asks `feed.langs`. Every language is one more billed page on every slice of every pass,
     * so this is what keeps the older searches from multiplying with the languages.
     */
    readonly langs: readonly string[] | null;
    /**
     * ★ EACH SLICE AT A FLOOR SCALED TO ITS AGE (policy.v181; core `sliceFloor`): the slice at k
     * hours asks k / (windowMin / 60) of the lane's floor, so the two-hour slice asks a third of the
     * six-hour one's. False: every slice asks the lane's floor, as before. The lane's floor adapts to
     * the same target either way, so the money is the same; it moves from posts found at six hours,
     * For You's own age limit, to the same kind of post found at two to four.
     */
    readonly ageScaledFloor: boolean;
  };
  /**
   * ★ FRESH DISCOVERY (the owner's "find text posts sooner at the same cost", 2026-10-14). OFF by
   * default: with `enabled` and `cutStale` false nothing below is read and discovery and re-reads
   * are exactly as before.
   *
   * Why: the main lanes ask "the 20 newest posts over the floor in the last ten minutes" every
   * pass, and the posts line is paced so a second page is almost never affordable. Measured
   * 2026-10-13 23:46 UTC, eight posts a minute clear the ten-minute floor, so the page fills with
   * posts four to eight minutes old and a post that crosses the floor later is never seen by them:
   * 104 of the 187 text posts that reached For You after 15:00 were found by the slow lane, a
   * median 234 minutes after posting. The same page also returns each young post two or three
   * times, and the media lane re-asks a subset of the same posts.
   *
   * With `enabled`, the main search becomes `bandAgesMin` age bands in place of the 'all' and
   * 'media' lanes: band k asks for the posts that turned `bandAgesMin[k]` minutes old since its
   * last ask — contiguous posting-time windows, newest first, at the lane's floor scaled to that
   * age — so every post under an hour is looked at once at each age, with no gap and no overlap.
   * A window never reaches back more than `maxWindowMin` (a restart). The bands' posts together
   * steer the 'all' floor toward the main lanes' combined target × `targetScale`; the slow lane
   * drops the time slices the bands already cover. Unjudged catch-all posts climbing at least
   * `rereadMinReachPerMinute` are re-read until `rereadMaxAgeMs` old, so the speed bar
   * (`rising.speedBar`) gets readings while it can fire.
   *
   * With `cutStale`, TRACK stops re-reading a post older than `staleAfterMs` that has not passed
   * the bar (no judgement) and is not on a feed: measured, 51 such posts in a day, none reached
   * For You. And a post older than `staleAfterMs` is not re-judged after a prompt change (about
   * 1,000 re-judges a day, $1.34): its first answer stands.
   */
  readonly fresh: {
    readonly enabled: boolean;
    readonly bandAgesMin: readonly number[];
    readonly maxWindowMin: number;
    readonly targetScale: number;
    readonly rereadMaxAgeMs: number;
    readonly rereadMinReachPerMinute: number;
    readonly cutStale: boolean;
    readonly staleAfterMs: number;
    /**
     * ★ LATE BANDS (the owner's missed posts, 2026-10-15). With `on` and `enabled`, each band asks
     * for the posts that turned `ageMin` minutes old since its last ask — tiled like the fresh
     * bands, so every post is looked at once at that age — at a FIXED floor of `minApproval`,
     * never above the slow lane's sent floor. The slow lane's floor drifts with its target
     * (4,382 to 10,700 likes on 2026-10-14), so a post that climbs to a few thousand likes over
     * hours is seen or not depending on the hour; this band sees it regardless. The slow lane's
     * time slice at the same age is dropped (it asks the same posts at a floor at least as high).
     * A late band's posts never move a lane's floor: its floor is fixed so its cost is the count
     * of posts over it, about 1.4 a minute of posting time at 6,500 likes and five hours old.
     * Off: nothing here is read and discovery is exactly as before.
     */
    readonly late: {
      readonly on: boolean;
      readonly bands: readonly { readonly ageMin: number; readonly minApproval: number }[];
      /**
       * ★ HOW OFTEN EACH LANGUAGE OF A LATE BAND IS ASKED (policy.v185), as `langSplit` spaces the
       * newest bands (core `langBandWindow`): once its window holds `everyMs` of posting time, reaching
       * back `fresh.maxWindowMin` beyond it, so a held-back pass is bought late rather than lost.
       * Absent or 0: every pass, the window since the last ask (core `bandWindow`), as before.
       *
       * Why: a late ask is one search per language, and the supplier bills an empty or short page
       * the price of a post. Asked every two-minute pass, 7 languages × ~9.4 pages, 63% of the late
       * band's bill on 25 Oct 07:00–08:00 UTC was those minimums, and its $1.30 day ran out at
       * 20:57 UTC on 25 Oct, after which nothing looked at a post at five hours until midnight.
       * What breaks if changed carelessly: above `fresh.maxWindowMin` minutes nothing is lost but a
       * post is seen that much later than its age; a share of the day is still the floor's lever.
       */
      readonly everyMs?: number;
      /**
       * The languages the late bands ask (policy.v185); `slow.langs` when absent. Their own list
       * because a language here costs one spaced search an ask (about 150 a day at `everyMs` ten
       * minutes, ~$0.02 at the one-post minimum) where `slow.langs` also asks it in four slices
       * every quarter-hour (384 a day).
       */
      readonly langs?: readonly string[];
    };
  };
  /**
   * ★ THE MIDDLE LANE (the owner's approval, 2026-10-16). Every `everyMs`, the catch-all search for
   * every post `minAgeMin` to `maxAgeMin` minutes old with at least `minApproval` likes, paged until
   * the window is exhausted (at most `maxPages` pages), credited to the 'middle' lane (0088).
   *
   * Why: the fresh bands look at a post at 6 and 50 minutes at a floor of a few hundred likes, and
   * the slow lane once an hour of age at a floor that drifts with its target (5,929 likes on
   * 2026-10-16). A post that passes a couple of thousand likes between those looks is seen by
   * nobody until hours later, if ever: 187 coined posts in three days did exactly that. This lane
   * asks the whole window at a FIXED floor, so such a post is found within a pass of crossing it.
   *
   * Unlike the bands it does not tile: a post over the floor is returned on every pass while it is
   * in the window (up to eleven times at a quarter-hour), because a like count only grows and the
   * search cannot be asked "crossed since". That repeat is most of its bill, and why the floor is
   * fixed and the lane has its own cap (`cap`, `LaneCapPolicy`): it never moves a lane's floor and
   * asks nothing more once its day is spent. The slow lane's time slices that lie wholly inside
   * this window are dropped while the lane is on and its floor is no higher than theirs.
   * Off: nothing here is read and discovery is exactly as before.
   */
  readonly middle: {
    readonly on: boolean;
    readonly minAgeMin: number;
    readonly maxAgeMin: number;
    readonly minApproval: number;
    readonly everyMs: number;
    readonly maxPages: number;
    /**
     * ★ HOW LONG ONE MIDDLE PASS MAY PAGE, from its start. Reached: no further page is asked, what
     * the pages so far returned is stored, judged and charged as usual, and the next pass (its own
     * loop, every `everyMs`) asks the window again from its newest end. A post the cut-off pass did
     * not reach is still in the window then, for up to `maxAgeMin`.
     *
     * Why: on 2026-10-16 the lane ran inside the discover pass, whose last step is the live judge,
     * and with the posts supplier slow and refusing calls for credit a pass went from 1.5-5 minutes
     * to 15-26, so every new post waited that long to be judged. The lane now has its own loop, and
     * this bounds that loop's pass too, so a slow supplier costs the lane depth, never time.
     * What breaks if changed carelessly: near `everyMs` the loop is never idle and a stuck supplier
     * holds the posts line's paging for the whole quarter-hour.
     */
    readonly passDeadlineMs: number;
    readonly cap: LaneCapPolicy;
    /**
     * ★ READ WHILE THE SOURCE SAYS THERE IS MORE (true), or stop at the first page that is not full
     * (false, the old rule). True, the pass stops only at `maxPages`, `passDeadlineMs`, `cap`, the
     * meter, or `paging.maxEmptyRun` empty pages in a row. See `paging` for why.
     */
    readonly fullPaging: boolean;
  };
  /**
   * ★ PAGING PAST SHORT PAGES (the owner, 2026-10-18). Since about 23:15 UTC on 2026-10-16 the
   * posts supplier's search answers pages of 1 to 12 posts while still saying there are more
   * (probe: five middle pages of 6, 12, 3, 5 and 1, every one with more to come). The old rule
   * took a short page as the end of the window, so every catch-all search read one page a pass and
   * the adaptive floors fell to their lowest while the window went mostly unread.
   *
   * A search listed in `searches` with `full` reads on while the source says there is more, up to
   * its `maxPages` and `passDeadlineMs` (from the ask's start), within its own day `dailyUsd` (its
   * search bill only, kept in the capped lanes' ledger as lane `search:<name>`, 0088), the meter,
   * and `maxEmptyRun` empty pages in a row (each still billed the supplier's floor). A search not
   * listed, or listed without `full`, keeps the old rule and is not capped here, as before.
   *
   * Names: `band_<age>` a fresh band, `late_<age>` a late band, `slow` the slow lane's slices (one
   * page each under the old rule), and `all` / `media` the main lanes when fresh discovery is off.
   * The middle lane has its own switch (`middle.fullPaging`) and cap.
   *
   * What breaks if changed carelessly: a search's bill is per post returned, so reading on costs
   * the posts the old rule left unread. A `dailyUsd` below what the search needs for a whole day
   * stops it mid-day, which loses more than the short pages did; that is why each one is on only
   * once its day fits.
   */
  readonly paging: {
    readonly maxEmptyRun: number;
    readonly searches: Readonly<Record<string, SearchPagingPolicy>>;
    /**
     * ★ A PACE IS CHECKED BEFORE AN ASK, NOT BETWEEN ITS PAGES (policy.v185). With it, a paced
     * search's day (`SearchPagingPolicy.paced`) and the X search day's pace (`searchDay`) decide
     * whether an ask starts; once started, its pages are held only to the hard totals (the search's
     * whole `dailyUsd`, the X day's `dailyUsd`), its `maxPages` and its deadline. The next pass waits
     * until the pace has caught up. Absent or false: every page is checked against the pace, as before.
     *
     * Why: a search's pages come newest first and each language's window is marked read when the
     * ask ends, so a pace that closed after a language's first page dropped the older rest of that
     * window unread, and raised that language's floor 20% as if its posts had cost too much
     * (core `nextFloor`'s `cut`). On 25 Oct 17:00–23:59 UTC the 6-minute band ended 95 of its 165
     * asks that way and 199 of the languages' 497 floor moves were such cuts; Portuguese, cut after
     * 1 to 5 posts an ask, climbed 28,150 → 50,000 (the most) in about an hour. A pace still holds
     * the day: an ask starts only inside it, so it is over by one ask at most (`maxPages` pages,
     * about $0.03 at 9 to 15 pages of 20 posts), and a hard total is never crossed.
     */
    readonly paceBeforeAskOnly?: boolean;
  };
  /**
   * ★ THE X SEARCH DAY, ONE HARD TOTAL PACED OVER THE UTC DAY (the owner, 2026-10-19: "a HARD daily
   * total for X search across all lanes and languages, spread evenly through the day, not
   * front-loaded"). With `on`, every catch-all search page — the newest bands, the late band, the
   * slow lane's slices and the middle lane, in every language — is asked only while the posts
   * supplier's metered search bill today (internal.spend, endpoint `search`, since 00:00 UTC) plus
   * the page's quote stays within `dailyUsd` × (the share of the UTC day gone, plus `aheadMs`), and
   * never above `dailyUsd` (core `searchDayAllowanceUsd`). The narrative-name and quote searches are
   * not held to it — each keeps its own cap — but their pages are on the same bill, so the catch-all
   * gets what they leave.
   *
   * Why the metered bill and not a ledger of our own: every search the posts supplier bills lands
   * there whoever asked it, so a lane added later cannot spend outside the total by forgetting to
   * write to a ledger. Read once a pass and kept up to date in the pass from each page's own bill; two
   * loops (discover, middle) each read it at their own start, so the day can overrun by at most one
   * pass of the other loop — the pace's `aheadMs` is the margin for that.
   *
   * What breaks if changed carelessly: the floors still steer what each search costs; this is the
   * stop when they cannot. A `dailyUsd` the floors' targets do not fit under turns into refusals at
   * the end of every pace step, and a refused band reaches back further at its next ask
   * (`fresh.maxWindowMin`, `langSplit.maxEveryMs`) and loses what is older than that.
   * Unreadable bill: no catch-all search is asked (the middle lane's rule).
   */
  /**
   * `countFromMs` (a time in ms, or null): on the UTC day it falls in, the day's bill and its pace start there
   * instead of at 00:00 (the owner, 2026-10-19: the cap went live mid-day after a night's overspend had
   * used the day, and X search was restarted "from now" at the normal pace). Other days ignore it.
   */
  /**
   * `rereadDailyUsd`: the part of the X day re-reads may take, paced the same way (core
   * `rereadAllowanceUsd`). From 2026-10-19 20:00 London the day's bill counts re-reads and replies too,
   * not search alone: the owner's $7 is the whole X day. Re-reads left out of it spent $8.75 on
   * 2026-10-19, ran into the $17 posts line and stopped every search from 19:43.
   */
  readonly searchDay: { readonly on: boolean; readonly dailyUsd: number; readonly aheadMs: number; readonly countFromMs: number | null; readonly rereadDailyUsd: number };
  /**
   * ★ EACH LANGUAGE ITS OWN FLOOR AND ITS OWN SHARE OF THE NEWEST-POSTS MONEY (the owner, 2026-10-19:
   * "make the languages proportionate"). With `on` (and `fresh.enabled`), each language of `langs` is
   * asked by the fresh bands at its OWN adaptive floor (internal.feed_lang_floor, 0111), moved after
   * every pass toward its own target: its share of `bandsDailyUsd` a day, as posts, over the minutes
   * of posting time its asks covered (core `langTarget`). So a busy language cannot raise another's
   * floor, and money follows `shares` — the share of coined viral posts in each language
   * (tools/lang-shares.ts prints them; normalised over `langs`, a language missing here has none).
   *
   * Why per minute of posting time and not per pass: the bands tile posting time, so what a day of
   * them returns is fixed by the floor whatever the number of passes; a per-pass target (the shared
   * floor's) spends more the faster passes run, which is part of how 19 Oct 2026 overspent once the
   * database came nearer (discover passes from 3 to 6 an hour to 12 to 23).
   *
   * ★ A SMALL SHARE ASKS LESS OFTEN, NEVER NOT AT ALL. Every ask of a band costs at least one billed
   * post, even empty. A language is asked on a band only once its window holds the posting time its
   * share pays `minPostsPerAsk` posts for — every `MS_PER_DAY × bands × minPostsPerAsk ÷ its posts a
   * day`, never slower than `maxEveryMs` (core `langEveryMs`) — and its window then reaches back that
   * far, so nothing between asks is skipped; it is found up to that much later instead. A language
   * whose share pays for a page every pass is asked every pass.
   *
   * What breaks if changed carelessly: shares that do not cover `langs` give the missing languages
   * only `maxEveryMs` and the floor's minimum; a `bandsDailyUsd` larger than what `searchDay`
   * leaves after the other searches turns the day's pace into the limit, which refuses whole passes instead of raising floors.
   * Off: the languages share the 'all' floor and the per-pass target, exactly as before.
   */
  readonly langSplit: {
    readonly on: boolean;
    readonly shares: Readonly<Record<string, number>>;
    readonly bandsDailyUsd: number;
    readonly minPostsPerAsk: number;
    readonly maxEveryMs: number;
  };
  /**
   * ★ VIEW READINGS OFTEN ENOUGH FOR THE SHEET'S CHART: every post on For You is read again on a
   * cadence set by its age, and a post whose sheet was just opened is read again when its newest
   * reading is over `openReadMinGapMs` old (services/runner/src/work/readings.ts, its own loop).
   * Every reading is appended to public.observation with the time the source gave it, as TRACK's are.
   *
   * Why its own loop and ledger, not a tier in TRACK: TRACK's grid is about which posts are worth
   * money, and a loop that grew to read sixty posts a minute inside it would slow every other track
   * decision; the runner has been broken twice by a loop that a new job slowed. Here a pass is bounded
   * in time (`passDeadlineMs`) and money (`dailyUsd`, kept in internal.lane_spend as lane 'readings',
   * so a restart does not hand it a fresh day), and stops while the live book has under
   * `bookReserveUsd` left, so it never takes the last dollars discovery and the judge need. A post
   * read here is not due for TRACK until its own tier comes round, so TRACK's reads of For You fall
   * as this one's rise.
   *
   * A source whose re-read costs more than `maxUsdPerRead` a post (a scraper billed by the run, when
   * the short-video source falls back to it) is not read here at all: at a minute's cadence a run
   * per pass would cost more than the rest of the lane together. TRACK still reads it as before.
   * What breaks if changed carelessly: a step list that is not in rising `underMs` order reads the
   * first match, so a later, finer step would never apply.
   */
  readonly readings: {
    readonly on: boolean;
    /** The loop's own cadence; a post's step is met to within this and `dueSlackMs`. */
    readonly everyMs: number;
    /** The text source, and any source with no cadence of its own. */
    readonly cadence: ReadingCadence;
    /** The short-video source: each read is a paid credit, so its cadence is its own. */
    readonly shortVideoCadence: ReadingCadence;
    /** A reading this much short of a step still counts as due, so a one-minute step is not read every ninety seconds. */
    readonly dueSlackMs: number;
    /** A sheet opened with a reading younger than this asks for nothing. */
    readonly openReadMinGapMs: number;
    /** An open older than this, still unanswered, is dropped: the person has closed the sheet. */
    readonly openAskMaxAgeMs: number;
    /** At most this many opened posts read in one pass, over the ones For You's cadence owes. */
    readonly openMaxPerPass: number;
    /** At most this many posts read in one pass in all; the oldest-read go first. */
    readonly maxPostsPerPass: number;
    readonly maxUsdPerRead: number;
    readonly passDeadlineMs: number;
    readonly dailyUsd: number;
    readonly bookReserveUsd: number;
    /**
     * ★ THE SORTS' TOP POSTS KEPT FRESH (the owner, 2026-10-18: yes for the text source's top 20,
     * about $0.13 a day; yes for the short-video source's top 10, about $0.46 a day). Every
     * `recomputeMs` the runner ranks For You's scroll on each list the app offers (Trending now, Most
     * viewed Today and This week: rising.forYouSorts, the owner 2026-10-18) as if every post were read just now (core
     * rank/post-sorts.ts). A text-source post in a list's top `topN`, or a short video in a list's top
     * `shortVideoTopN` (each re-read is a paid credit, so fewer), whose newest reading is `everyMs` old
     * or more is due: at most `maxPerPass` text posts and `shortVideoMaxPerPass` short videos a pass,
     * inside this lane's `dailyUsd`. So a post that would top a list is never left below it for want of
     * a reading (rising.forYouSorts.freshMs).
     */
    readonly sortTop: {
      readonly on: boolean;
      readonly topN: number;
      readonly everyMs: number;
      readonly recomputeMs: number;
      readonly maxPerPass: number;
      readonly shortVideoTopN: number;
      readonly shortVideoMaxPerPass: number;
      /** Most viewed's lists' short-video top, under Trending's `shortVideoTopN`: see the cap below. */
      readonly shortVideoViewedTopN: number;
    };
  };
  /**
   * ★ THE NARRATIVE-NAME SEARCH (the owner, 2026-10-18): every `everyMs`, each open narrative on the
   * board searched on the text source by its name, forward from that narrative's last search (or one
   * `everyMs` back on its first), at `minApproval` likes and in EVERY language: one search a name with
   * no language filter, not one per language of `feed.langs` (the owner, 2026-10-18). Since the
   * supplier stopped honouring an OR of languages (16 Oct) a filtered name would be five asks, five
   * times the requests under the same $0.35; a name is already narrow, and the posts that carry it in
   * any language are the ones we want, so it is asked once across all of them. Posts found are credited
   * to the 'narrative_name' lane (0097), judged like any found post, and may reach For You — unlike
   * the story-name backfill (`BackfillPolicy`), whose posts are judged and never shown.
   *
   * THE NAME (services/runner/src/work/narrative-names.ts): a phrase of 1 to `maxWords` words from the
   * narrative's title or its posts' judged names that appears, word for word, in the text of at least
   * `minMemberPosts` of its posts. Of two or more words, the last and at least one must not be in
   * `commonWords` ("tesla roadster", "the hi"); a single word must be a name the judge gave a post,
   * not in `commonWords`, of `minWordLetters` letters ("vaquita", never a title's "police"). A phrase
   * is preferred to a single word, then the one in more posts. A narrative with no such name is not
   * searched: a generic word ("cat", "Elon") would bring an hour of everything about it.
   *
   * Its own loop (loops/name-search.ts) and its own day in internal.lane_spend: `cap`, read before
   * every page (work/lane-search.ts). A pass is bounded by `passDeadlineMs` and each name by
   * `maxPagesPerAsk`; narratives searched longest ago go first, so a pass cut short resumes fairly.
   * What breaks if changed carelessly: a floor much under the middle lane's lets every generic name
   * fill its pages with posts the judge must then be paid for; the cap stops it, an hour early.
   */
  readonly narrativeNames: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly minApproval: number;
    readonly maxNarratives: number;
    readonly maxPagesPerAsk: number;
    readonly passDeadlineMs: number;
    readonly minMemberPosts: number;
    readonly membersRead: number;
    readonly maxWords: number;
    readonly minWordLetters: number;
    readonly commonWords: readonly string[];
    readonly cap: LaneCapPolicy;
  };
  /**
   * ★ THE MEME-WAR WORD SEARCH (the owner, 2026-10-24, policy.v159): each live meme war (a narrative
   * whose `fight` the titler or the owner set, with a post inside `narrative.fight.activeMs`) is
   * searched in each side's own language for the other country's name — 土耳其 in Chinese, "çin" in
   * Turkish, "japon" in French, フランス in Japanese — from `narrative.fight.native.names`, the first
   * `wordsPerSide` words of each (a word's `*` dropped: the source matches whole words). Every
   * `everyMs`, over the last `lookbackMs` of posts, at `minApproval` likes, one language a search.
   * Its posts are credited to the 'narrative_name' lane, judged like any found post, and joined to
   * their war by `narrative.fight.native`. A seed still waiting for the titler is not searched.
   *
   * Runs in the narrative-name search's loop, every `everyMs` (that search keeps its own cadence).
   * Its own day in internal.lane_spend ('search:fight_words', `cap`), and every ask also inside the
   * X search day's pace (`searchDay`) and the meter's line: it never raises either.
   *
   * ★ A LANGUAGE MAY HAVE ITS OWN BAR (`byLang`, policy.v169): its like floor and how many of its
   * words are asked, in place of `minApproval` and `wordsPerSide` for that language's asks only. A
   * side whose posts draw fewer likes is asked lower (Japanese answering the French, 2026-10-24).
   *
   * ★ PHRASES AND NAMED WARS (policy.v175): a live war's `narrative.fight.native.phrases` are asked
   * too, all their words in one ask (`ベジータ アルジェリア lang:ja`), the first `phrasesPerSide` of
   * each language (a language's own in `byLang`). The wars of `narrative.fight.native.named` are
   * asked by their words even before a narrative holds them, inside `maxWars` with the live ones.
   *
   * What breaks if changed carelessly: `lookbackMs` against `everyMs`. A post is returned (and billed)
   * on every ask while it is inside the window; three asks a post at 90 minutes and 30.
   */
  readonly fightWords: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly lookbackMs: number;
    readonly minApproval: number;
    readonly wordsPerSide: number;
    readonly phrasesPerSide: number;
    readonly byLang: Readonly<Record<string, { readonly minApproval: number; readonly wordsPerSide: number; readonly phrasesPerSide?: number }>>;
    readonly maxWars: number;
    readonly maxPagesPerAsk: number;
    readonly passDeadlineMs: number;
    readonly cap: LaneCapPolicy;
  };
  /**
   * ★ THE QUOTE SEARCH ON BIG ACCOUNTS (the owner, 2026-10-18): a held text post by an account with
   * at least `minFollowers` followers whose likes have reached `minApproval` has its quotes searched
   * at about each age in `askAtMin` (within `askGraceMin` after it), at `reproductionMinApproval` likes. The
   * quotes are credited to the 'quote' lane (0097), judged like any found post, and may reach For You.
   * A quote of a giant account's post is where its meme is often made (the Tesla 7:55 post).
   *
   * Its own loop (loops/quotes.ts) and its own day in internal.lane_spend: `cap`. A pass asks at most
   * `maxPostsPerPass` posts, most liked first, each at most `maxPagesPerAsk` pages, and stops at
   * `passDeadlineMs`. Which ages a post was asked at is kept in the process: a restart may ask one
   * post's current age once more, inside the cap. What breaks if changed carelessly: a grace as long
   * as the gap between two ages asks every post at both on every restart.
   */
  readonly reproductions: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly minFollowers: number;
    readonly minApproval: number;
    readonly reproductionMinApproval: number;
    readonly askAtMin: readonly number[];
    readonly askGraceMin: number;
    /** Big posts in the asking windows read from the store per pass, most liked first. */
    readonly maxCandidates: number;
    /** A reading under `minApproval` this old, at an asking age, is read again by id before deciding. */
    readonly rereadAfterMin: number;
    readonly maxRereadsPerPass: number;
    readonly maxPostsPerPass: number;
    readonly maxPagesPerAsk: number;
    readonly passDeadlineMs: number;
    readonly cap: LaneCapPolicy;
  };
  /**
   * ★ THE ACCOUNT WATCH (2026-10-20, "find viral posts sooner without raising the X day"). Every
   * `everyMs`, the newest posts of the text source's accounts whose posts get coined again and
   * again, asked `accountsPerAsk` accounts to a search, forward from each account's last answered
   * ask, credited to the 'account' lane (0115), judged like any found post and free to reach For You.
   *
   * WHICH ACCOUNTS (store repo/watch-accounts.ts, re-read every `listEveryMs`): those with at least
   * `minCoinedPosts` posts of `minReach` views or more that a coin launched within `coinWithinMs` of
   * the post named, inside the last `lookbackMs`, most such posts first, at most `maxAccounts`. From
   * our own coin links, never a list typed in, so an account that stops being coined drops off.
   *
   * Why: replayed on the coined posts of 2026-10-13 to 2026-10-20 that reached 100k views (1,003,
   * coins 0 to 48 hours after the post), 304 were by accounts already on this list when they posted,
   * and the catch-all searches found most of those only after their coin, many only through the
   * coin's own link: a big account's post clears every floor, yet its coin often comes before a band
   * asks. Asked every 3 minutes, about 99 more of them would have been found before their coin and
   * about 54 more would have been on For You before it (the posts the judge said yes to, 3 minutes
   * from found to shown); median 49 minutes earlier found.
   *
   * Cost: the text source bills a request one post at least, so an ask that finds nothing costs one
   * post for the whole group and a busy one costs what it returns: about 124 accounts in 9 groups,
   * 480 passes a day, ~3,800 billed empty asks plus 660 to 1,320 posts, $0.67 to $0.77 a day of
   * search; with the judging of its new posts it is held by `cap` (internal.lane_spend, lane
   * 'account', failing closed). A restart asks at most `maxWindowMs` back. A pass stops at
   * `passDeadlineMs`; a group at `maxPagesPerAsk` pages.
   *
   * What breaks if changed carelessly: an `accountsPerAsk` past the adapter's group limit is refused
   * there, every ask; a `minReach` far under 100k lets in the accounts that coin their own posts.
   * Off: nothing here is read and nothing is asked.
   */
  readonly accountWatch: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly accountsPerAsk: number;
    readonly maxAccounts: number;
    readonly minCoinedPosts: number;
    readonly minReach: number;
    readonly lookbackMs: number;
    readonly coinWithinMs: number;
    readonly listEveryMs: number;
    readonly maxWindowMs: number;
    readonly maxPagesPerAsk: number;
    readonly passDeadlineMs: number;
    readonly cap: LaneCapPolicy;
  };
}

/**
 * How often a post on For You is read, by its age: the first step whose `underMs` the post is
 * younger than gives its `everyMs`, and a post older than every step is read every `thenEveryMs`.
 */
export interface ReadingCadence {
  readonly steps: readonly { readonly underMs: number; readonly everyMs: number }[];
  readonly thenEveryMs: number;
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
    /** The namer's guessed names and tickers searched for a post after the judge's names, while Policy.names.on. */
    readonly guessNamesPerSubject: number;
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
    /**
     * ★ THE NARRATIVE PAGES' POSTS (2026-10-18): a narrative's coin is read from its posts'
     * searches, and a post off the live feed frame was never searched, so 373 of 411 pages said
     * "still checking for a coin" for good. They are searched after the feed's posts, on the free
     * source only (never the paid plan's monthly credits).
     */
    readonly narrativePosts: {
      /** Posts searched a pass at most, inside the room the feed left. */
      readonly perPass: number;
      /** Calls of `perDay` kept for the feed: narrative posts stop for the UTC day when only this is left. */
      readonly feedReserve: number;
      /** A live narrative's post is searched again this long after its last search. */
      readonly liveKeepMs: number;
      /** A dead narrative's post: checked once, then again only this long after. */
      readonly deadKeepMs: number;
      /**
       * Chain reads (the RPC provider's `getAsset` and `getTransactionsForAddress`, two per coin
       * the search adds) these searches may make in a UTC day. Past it a found coin is still
       * added and listed, without its metadata link and its chain launch time.
       */
      readonly chainReadsPerDay: number;
    };
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

/** Policy.postCoin.botFilter: see the field. */
export interface PostCoinBotFilter {
  readonly on: boolean;
  readonly serialDevMinCoins: number;
  readonly serialDevWindowMs: number;
  readonly instantMs: number;
}

/**
 * WHICH COIN IS A FEED POST'S (core/src/match/post-coin.ts): the facts that PROVE a coin came from
 * a post, and the weights that rank the rest. Fitted on the gold set's tuning half
 * (eval/src/gold/run-matching.ts) and refitted by the twice-daily re-tune with the owner's coin
 * labels (tools/lib/coin-match-fit.ts); a refit is stored, not written here, so these are the
 * starting weights and the fallback.
 */
export interface PostCoinPolicy {
  /** A post id shorter than this is never looked for in a coin's links: too likely by chance. */
  readonly minLinkIdLength: number;
  /** A looser spelling of a name counts only from this many letters. */
  readonly minVariantLength: number;
  /** Two pictures whose perceptual hashes differ in at most this many of 64 bits are the same picture. */
  readonly sameHashDistance: number;
  /** A coin whose picture is this close to the post's is a candidate even when its name is not. */
  readonly widenHashDistance: number;
  /** Below this picture similarity the embedding says nothing for the coin (GROUP's borderline). */
  readonly pictureFloor: number;
  /** How fast "launched soon after" fades: the timing signal halves every this many minutes. */
  readonly timingHalfLifeMin: number;
  /** Words shorter than this are not compared between a coin's description and the post's words. */
  readonly descriptionMinWord: number;
  /** A coin is LIKELY when its share of the ranking — a softmax over the candidates and "none of these" — is at least this. */
  readonly likelyMinShare: number;
  /** The ranking weights, one per signal; the score is their sum, and never leaves the server. */
  readonly weights: PostCoinWeights;
  /** Pictures hashed per runner pass: new coins' logos, then feed posts' pictures (free; a brake on bandwidth). */
  readonly hashCoinsPerPass: number;
  readonly hashPostsPerPass: number;
  /** A picture that could not be read this many times is not asked about again. */
  readonly hashMaxAttempts: number;
  readonly hashTimeoutMs: number;
  /** Coins a post's picture may add as candidates, closest first. */
  readonly pictureCandidatesPerPost: number;
  /** Coins the mint stream's own copy may add by name per post, newest first. */
  readonly nameCandidatesPerPost: number;
  /**
   * When several coins' links name the post, the one launched first is proven (the owner's rule of
   * 2026-10-15). Off: only a lone linking coin inside the timing window is proven, and several are a
   * tie. Off since 2026-10-16: bots launch coins that link a viral post within seconds of it, so the
   * first launch is usually a copycat, not the coin the owner calls the post's.
   */
  readonly firstLinkWins: boolean;
  /**
   * Weigh every coin whose metadata names the post (internal.coin_post_link, 0083) as a candidate,
   * whatever its name. Off: only the searches' candidates are weighed; the links table still feeds
   * lead time and the finders. Off since 2026-10-16 for the same copycats.
   */
  readonly linkedCandidates: boolean;
  /**
   * The bot-coin filter (the owner, 2026-10-16): before the link rule names a coin, ignore the coins
   * that look like a bot's copy of a viral post, then let the earliest launched of the linking coins
   * that remain be proven ("Links this post"). A coin is ignored when either holds:
   *   serial dev  its creator's wallet (public.asset `creator`) launched at least `serialDevMinCoins`
   *               coins whose metadata names some post (internal.coin_post_link) within
   *               `serialDevWindowMs` either side of this coin's launch (itself among them when it links one)
   *   instant     it launched within `instantMs` of the post, and neither its name meets the
   *               subject's names nor is its picture the post's
   * An unknown creator or launch ignores nothing: an unknown is not a no. An ignored coin is never
   * named (proven or likely); it stays in "See N coins". Off: the rule is the rollback's, exactly.
   * This is the only way the earliest-launch rule comes back; `firstLinkWins` alone stays off.
   */
  readonly botFilter: PostCoinBotFilter;
  /**
   * "Coin for this story" (core match/story-coin.ts): when a feed post is about the same story as a
   * post the owner confirmed a coin for, by the two posts' words-and-picture vectors. The same bars
   * for every story. `alone`: close enough to one confirmed post. `together`: close enough to at
   * least `togetherPosts` confirmed posts of the same coin — more confirmations, a lower bar.
   * `near`: close enough when the judge named the post as the confirmed post or the coin (ticker or
   * name, at least `minNameChars` run together), or it shares a story with a confirmed or a
   * strongly matched post.
   */
  readonly storyCoin: { readonly alone: number; readonly together: number; readonly togetherPosts: number; readonly near: number; readonly minNameChars: number; readonly minWords: number; readonly minTopicChars: number };
  /**
   * "See N coins" and "Choose coin" (services/project coin-list.ts): only coins that could be the
   * post's. `graceBeforeMs`: how long before the post a coin may launch and still count by name and
   * time. `quietAfterMs`: older than this, not linked, not named exactly and not quotable is quiet
   * and left out. `maxCoins`: the list's length. `descriptionShare`: a description sharing this
   * much of its words with the post links it.
   */
  readonly list: { readonly graceBeforeMs: number; readonly quietAfterMs: number; readonly maxCoins: number; readonly descriptionShare: number };
  /**
   * ★ THE POSTER'S PROFILE, READ AGAIN (the owner, 2026-10-14: "will it update if ca is added later
   * to bio"). Every read of a post stores its poster's profile for free; this re-reads one post per
   * poster of a For You, Popular or watched post, for `refreshForMs` after the post, at most once
   * every `refreshEveryMs` (services/runner/src/work/bio-refresh.ts), so an address the creator adds
   * after the launch proves the coin (core match/post-coin.ts (4)) and the push goes. Only on a
   * source whose re-read quotes at most `refreshMaxUsdPerPost` a post. Off until the owner turns it
   * on (`refreshOn`): it is a paid read on the live posts line.
   *
   * From the owner's eight missed posts (2026-10-14): seven coins launched 0.4 to 46 hours after
   * their post, so 48 hours (the match window) plus 12 for the creator to add the address; the one
   * profile that carried it was read 3.6 hours after its launch, so every 2 hours.
   */
  readonly bio: {
    readonly refreshOn: boolean;
    readonly refreshForMs: number;
    readonly refreshEveryMs: number;
    readonly refreshMaxUsdPerPost: number;
    readonly refreshPerPass: number;
    readonly refreshPerDay: number;
  };
}

export interface PostCoinWeights {
  /** Added to every candidate: against "none of these", which scores 0. */
  readonly base: number;
  readonly linksPost: number;
  readonly linksAccount: number;
  readonly picture: number;
  readonly hash: number;
  readonly description: number;
  readonly authorAddress: number;
  readonly othersAddress: number;
  readonly timing: number;
  readonly nameExact: number;
  readonly nameVariant: number;
  readonly tradingJump: number;
}

/**
 * ONE POST, ONE COIN (the owner, 2026-10-19; core/src/match/one-coin.ts): a post's — and a
 * narrative's — single coin, chosen by who is actually buying it within minutes of its launch, or
 * none, when the card offers Create. The thresholds are the replay's best trade-off on 15-19 Oct
 * (wrong 16%, false pick 11% on the fair set, scratch replay.md); the buyer bar had no data to fit
 * and is provisional. A weekly refit may propose others (internal.one_coin_fit, 0113); a proposal
 * the replay shows is better replaces these numbers at run time, these stay the fallback.
 */
export interface OneCoinPolicy {
  /**
   * 'shadow': the rule runs and writes internal.post_coin_pick, and the cards and pushes stay as
   * they were. 'live': the card shows the pick (or Create), and a watched post's push fires on it.
   */
  readonly mode: 'shadow' | 'live';
  /** How often the matcher and the rule run (the runner's one-coin loop). */
  readonly everyMs: number;
  /** A new launch is matched against the posts of this long before it. */
  readonly postWindowMs: number;
  /**
   * A coin's link (to the post, or one hop through a quote or re-share of it) ties it to a post at
   * most this old at the coin's launch; `postWindowMs` binds only names and pictures.
   */
  readonly linkMaxAgeMs: number;
  /** A launch this long before the post still counts as the post's (the post's own clock is loose). */
  readonly launchLeadMs: number;
  /** Launches are matched again for this long after they arrive: metadata and hashes come late. */
  readonly rematchMs: number;
  /** A candidate's trades are watched, and its post's pick re-judged, for this long after its launch. */
  readonly watchMs: number;
  /** A candidate is judged from this long after its launch… */
  readonly judgeFromMs: number;
  /** …and a pick still standing this long after the picked coin's launch is confirmed. */
  readonly confirmByMs: number;
  /** A coin is picked only at this market cap or more. */
  readonly minCapUsd: number;
  /** …and when its net buying is at least this many times every rival's. */
  readonly leadRatio: number;
  /** …and when this many distinct wallets bought it. */
  readonly minUniqueBuyers: number;
  /** A held coin is handed over only to a rival with this many times its net buying. */
  readonly handOverRatio: number;
  /** A coin whose cap fell under this share of its peak is out (the rugs of the replay)… */
  readonly rugShareOfPeak: number;
  /** …except a HELD coin, kept until its cap is also under this many USD… */
  readonly rugFloorUsd: number;
  /** …or it has stayed under the share this long, or a rival clears the bars and leads it. */
  readonly rugGraceMs: number;
  /**
   * A held coin still worth this many USD is never dropped for time spent under the share: only a
   * rival can take it. 25 Oct: the real $Marvin, $657k at its peak, was dropped at $151k after half an
   * hour under 30% of it, for a $22k coin.
   */
  readonly rugKeepAboveUsd: number;
  /**
   * While the held coin is under the share (it crashed), a rival made for the post — a link, the
   * picture or the stated name — worth this many times the held coin's cap now takes the pick, on
   * either basis. 25 Oct 02:20: the wrong $Marvin fell $115k to $42k in a minute while the real one
   * stood at $147k; on trades both coins' net buying was flat, so the strength bar never moved.
   */
  readonly crashCapRatio: number;
  /**
   * THE RACE: two (or `size`) coins made for the post that broke away from the rest together are
   * shown together ("See 2 coins") instead of trusting whichever leads. Judged on each coin's newest
   * cap from its first reading, not after `judgeFromMs`, and only while the racers are younger than
   * `windowMs`: each racer at least `minCapUsd`, and the last racer at least `gapRatio` times the
   * next coin made for the post. 25 Oct: from 02:04 the two Marvins stood at $53k and $22k over a
   * field of 30 under $15k; the real one, second, ran to $657k.
   */
  readonly race: { readonly on: boolean; readonly windowMs: number; readonly minCapUsd: number; readonly gapRatio: number; readonly size: number };
  /** Without trade data: the cap a coin opens at, so its climb is the cap over it (the replay's rule). */
  readonly openingCapUsd: number;
  /**
   * A reading whose pool holds less than this is a frozen quote, not a market: its cap is no sign of
   * trading. Such a coin ranks as untraded among the older coins, and on readings it climbs nothing.
   * A reading with no liquidity figure (a coin still on its curve) is unknown and passes.
   */
  readonly minLiquidityUsd: number;
  /** The trade feed counts as running when any watched coin's trades were updated this recently. */
  readonly tradeFeedFreshMs: number;
  /** Picture evidence: hashes this close are the same picture; an embedding this similar is too. */
  readonly picture: { readonly maxHashDistance: number; readonly minSimilarity: number };
  /**
   * The second path: a post that arrives after its coin exists. The biggest coin of its exact name
   * at the post's time, if its newest reading is this recent and its cap at least `minCapUsd`.
   * Beside it, the coins launched up to `lookbackMs` before the post that its names or words tie
   * (core `priorCoins`), with no reading bar: the `lookbackCoins` most traded of them, unread last.
   * The market service reads at most `readsPerPass` of these coins each pass while they are weighed.
   */
  readonly existing: { readonly readingWithinMs: number; readonly minCapUsd: number; readonly lookbackMs: number; readonly lookbackCoins: number; readonly readsPerPass: number };
  /**
   * ★ THE EARLY PICK (policy.v165, core match/early-pick.ts, services/runner work/early-pick.ts): a
   * coin made for the post (a link, one hop through a promotion included, or its stated name) whose
   * fresh reading is in [`minCapUsd`, `maxCapUsd`) and whose rise over `openingCapUsd` is `lead`
   * times every rival launched in the `rivalWithinMs` before, judged `fromMs` to `withinMs` after its
   * launch, takes the post's pick — never over the owner's coin call or the runner hand-over's pick,
   * once a post. `push`: told at once with plain facts, to the owner's profiles only while `everyone`
   * is false, and only for a post on For You before the coin launched (or a coin-first post).
   */
  readonly early: {
    readonly on: boolean;
    readonly minCapUsd: number;
    readonly maxCapUsd: number;
    readonly lead: number;
    readonly fromMs: number;
    readonly withinMs: number;
    readonly rivalWithinMs: number;
    readonly readingWithinMs: number;
    readonly push: { readonly on: boolean; readonly everyone: boolean };
  };
  /** Per pass at most: launches matched, posts looked at by the second path, pictures embedded, subjects judged. */
  readonly perPass: { readonly launches: number; readonly posts: number; readonly embeds: number; readonly subjects: number };
  /**
   * The weekly refit (tools/onecoin-refit.ts): its cadence, the history it reads, the grid it
   * tries, and how many owner or +1h truths it needs before any proposal may replace the current.
   */
  readonly refit: {
    readonly everyMs: number;
    readonly lookbackMs: number;
    readonly minCases: number;
    readonly minCapsUsd: readonly number[];
    readonly ratios: readonly number[];
    readonly minBuyers: readonly number[];
    /** The +1h truth: the biggest candidate at launch + this long is the real coin, when at least `truthMinCapUsd`. */
    readonly truthAtMs: number;
    readonly truthMinCapUsd: number;
  };
  /**
   * The live trade feed that fills 0112's trade tables (services/chainwatch): one log subscription
   * per watched coin on a key billed by the byte delivered. Every cap here ends in the same place:
   * the coin, or every coin, is recorded as NOT MEASURED from that instant (0114), never as quiet.
   */
  readonly tradeFeed: {
    /** Off: no subscription is made and every watched coin stays unmeasured. */
    readonly on: boolean;
    /** The most bytes one coin may cost over its whole watch; past it, it is unsubscribed. */
    readonly coinCapBytes: number;
    /** The most credits the feed may cost in a UTC day, socket and chain calls together. */
    readonly dayCapCredits: number;
    /** The key's billing for socket data: `creditsPerBilledBytes` credits per `billedBytes` delivered. */
    readonly billedBytes: number;
    readonly creditsPerBilledBytes: number;
    /** Credits per plain chain call (account reads), and per history call (a transaction, an address's signatures). */
    readonly creditsPerCall: number;
    readonly creditsPerHistoryCall: number;
    /** A day's most launch-transaction reads for a watched coin's missing opening buy (two history calls each). */
    readonly openingLookupsPerDay: number;
    /** A day's most whole-transaction reads for a cut log; past it, a cut log makes its coin unmeasured. */
    readonly truncatedLookupsPerDay: number;
    /** The most coins subscribed at once (the socket's own limit per connection). */
    readonly maxCoins: number;
    /** How often trades are written and the watch list re-read. */
    readonly flushMs: number;
    readonly rereadMs: number;
    /** A probe this often keeps a quiet socket provably alive; no frame for `staleAfterMs` is an outage. */
    readonly probeEveryMs: number;
    readonly staleAfterMs: number;
    /** How often the day's counted cost is logged. */
    readonly reportEveryMs: number;
    /** A chain call's timeout. */
    readonly callTimeoutMs: number;
  };
}

/**
 * Buying and selling (services/trade). Everything here is behind the TRADING switch, which is off
 * unless the deploy turns it on, and the allowlist of wallets, which is empty unless it names one.
 */
export interface TradePolicy {
  /**
   * The most one buy (or SOL send) may spend, in SOL, amount plus slippage. Null: no cap — a buy
   * is bounded only by what the wallet holds, which the simulation checks before anything is
   * offered for signing. Sells are bounded by what the wallet holds either way.
   */
  readonly maxSolPerTrade: number | null;
  /** Slippage offered by default, and the most a person may choose, in basis points. */
  readonly defaultSlippageBps: number;
  readonly maxSlippageBps: number;
  /** Insidor's own fee on a trade, in basis points. Off; turned on only by the founders. */
  readonly platformFeeBps: number;
  /** The size asked about to tell whether a coin can be traded at all, in SOL. */
  readonly probeSol: number;
  /** The most a creator may buy of their own coin at launch, in SOL. Null: no cap, bounded by the wallet's SOL. */
  readonly maxDevBuySol: number | null;
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
  /**
   * Landed buys and sells read from our own trade record for a wallet's cost basis, oldest first.
   * A wallet with more than this has its oldest left out, and its coins' gains marked partial.
   */
  readonly tradesRead: number;
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
   * ★ HOW FAR BACK FOR YOU'S SCROLL REACHES (the owner, 2026-10-24: "older For You disappeared —
   * keep it 3 days"; policy.v168). The scroll's pages (services/read feed-page.ts) serve the members
   * that first went on For You (`public.feed_post.first_shown_at`) within this long of the read,
   * newest posted first. Only what the scroll READS: membership, re-reads, translations and storage
   * keep going by membership as before, so lengthening this brings older members straight back. It
   * is also what keeps a page's cost flat as the table grows: an index range on when each joined,
   * about 630 rows at three days on 2026-10-24, instead of every member ever (2,100 then).
   */
  readonly scrollKeepMs: number;
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
   * Whether the projector holds For You to the six-hour rule above. It did until the News tab was
   * removed (2026-10-13 15:28 UTC), when the filter went with it by accident; since then For You
   * has shown posts up to the whole `windowMs` old. Measured on the 194 posts first shown 15:00–24:00
   * that day: 58 were over six hours old and not still growing when they first showed (35 of them
   * only passed on a re-judge after a prompt change; the owner called 38 not a meme). Off keeps
   * today's behaviour until the owner approves.
   */
  readonly fypMaxAgeOn: boolean;
  /**
   * Whether the projector's views bars read every reading the judge's own bar reads. The scorer
   * (runner score-posts) counts any readable reading; the projector counted only readings with a
   * measured rate, so a post's FIRST reading (no earlier one to take a rate from) and any reading
   * that moved less than a quantization step were unread to it. A post the judge was paid to judge
   * on its first reading then waited for a second one, and a post that cleared a growth path only
   * on that first reading could not clear it at all. Measured on the 194 For You posts first shown
   * 15:00–24:00 UTC on 2026-10-13: 89 waited over five minutes for this, 16 minutes on average.
   * Only the bars: the views line on the card still shows measured readings only. Off keeps
   * today's behaviour until the owner approves.
   */
  readonly feedBarCountsEveryReading: boolean;
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
   * ★ FOR YOU'S TRENDING AND MOST VIEWED (core rank/post-sorts.ts, the owner 2026-10-17 and 18).
   * `freshMs`: a post whose newest reading is this old or more is listed after every post read
   * since ("a post can only rank in the top 20 if its latest reading is less than 30 minutes old").
   * `minReadShare`: a half window's speed needs W / this of it read. `trendFloorsPerMin`: Trending
   * ranks by how many times faster a post gains now than just before only for posts gaining at least
   * their window's floor in views a minute now, in a text post's views (a short video's speed divided
   * by `shortVideoReachScale` first); below it, by speed, under every post over it, so a tiny post's
   * tenfold cannot top the list. One floor a window (the owner, 2026-10-18), because a half window's
   * speed is an average over 30 minutes, 3 hours or 12: one number would let nearly every post over
   * on 1h's terms and almost none on 24h's. A window with no entry takes the nearest window's.
   * ★ THE LISTS THE APP OFFERS (the owner, 2026-10-18): Trending is one list, "right now", the
   * risers of `risers` below (filled from the 1h rule when there are few), with no window chips; Most
   * viewed is Today, This week (views gained in `mostViewedSpansMs`) or All time (total views). All
   * are sent `pageSize` at a time. The runner keeps exactly these lists' tops fresh (feed.readings
   * .sortTop), so a span or window added here is read for too, at its cost.
   */
  readonly forYouSorts: {
    readonly freshMs: number;
    readonly minReadShare: number;
    readonly trendFloorsPerMin: readonly { readonly windowMs: number; readonly perMin: number }[];
    /**
     * ★ TRENDING NOW (the owner, 2026-10-18, third design; core `riserPlace`, `trendingList`).
     * Speed now = views a minute over the last `nowSpanMs` (30 min); speed before = views a minute
     * over the `beforeSpanMs` (1 h) before that, 30 to 90 minutes ago. Each from the post's own
     * readings, linear between consecutive readings and nothing past the last one, and only when the
     * readings measure both spans: a reading inside each, at least `minCoverShare` of each span lying
     * between readings, and the two readings either side of the 30-minute mark at most `maxMarkGapMs`
     * apart (one long gap across the mark would give both sides the same speed by construction).
     * A RISER: speed now >= `floorPerMin` (text-post views; a short video divided by
     * `shortVideoReachScale` first), speed now >= `minRatio` x speed before, a reading under `freshMs`
     * old; ranked by the ratio. When fewer than `fillBelow` posts are risers, the list is filled to
     * `fillTo` with the 1h rule's picks over its floor (later half against earlier half), each card
     * saying its own real speed-up, flat or slowing included.
     */
    readonly risers: {
      readonly nowSpanMs: number;
      readonly beforeSpanMs: number;
      readonly minCoverShare: number;
      readonly maxMarkGapMs: number;
      readonly minRatio: number;
      readonly floorPerMin: number;
      readonly fillBelow: number;
      readonly fillTo: number;
    };
    /**
     * ★ MOST VIEWED (the owner, 2026-10-18, third design): Today and This week rank by views GAINED in
     * the last `today` / `week` ms from each post's own readings (the first reading's count included as
     * a reading), any For You post with a reading in the window; All time ranks every For You post by
     * its total at its newest reading.
     */
    readonly mostViewedSpansMs: { readonly today: number; readonly week: number };
    readonly pageSize: number;
  };
  /**
   * ★ THE SHORT-VIDEO SOURCE'S OWN GROWTH PATHS, in place of the scaled `fypEarly*` / `fypFast*`
   * ones. Scaled, they asked for 250k views inside fifteen minutes or 25k a minute inside the
   * first half hour, and its newest-first search finds videos 0.5 to 6.6 hours old (median 1.35,
   * 2026-10-13 16:12 UTC) and re-reads them every half hour — no reading ever lands inside those
   * windows, so only the 500k total could ever fire. Measured that afternoon: the fastest young
   * video had 130k at 72 minutes (1,800 a minute); the next 53k at 76 (700); a stored one went on
   * from 391k at 3.6 hours (1,830 a minute). 150k inside two hours (1,250 a minute at its end, the
   * same shape as the text bars' 20k in fifteen minutes under 2,000 a minute) or 1,500 a minute at
   * any reading inside four hours lets the first and third in and holds the rest to the 500k bar:
   * about 1 in 60 newly found videos. Raw views, not scaled.
   */
  readonly shortVideoEarlyReach: number;
  readonly shortVideoEarlyWindowMs: number;
  readonly shortVideoFastReachPerMinute: number;
  readonly shortVideoFastWindowMs: number;
  /**
   * ★ THE SHORT-VIDEO SPEED BAR (off until the owner switches it on): with `enabled`, the
   * short-video growth paths are `earlyReach` views inside `shortVideoEarlyWindowMs` or
   * `fastReachPerMinute` a minute at any reading inside `shortVideoFastWindowMs`, in place of
   * `shortVideoEarlyReach` and `shortVideoFastReachPerMinute`. The 500k total stays as it is.
   * Set 2026-10-14 from our own readings, because the owner's coined short videos say nothing about
   * their first hours: the 11 in the gold set were coined 19 hours to over a year after they went up,
   * and none was ever read by us. Of 328 videos we first read under two hours old on 2026-10-13, the
   * two that went on past 150k views were at 564 and 1,240 a minute on that first reading; neither
   * passes today's 1,500. Replayed on that day's readings (videos found 01:00 to 01:00 UTC): 50k or
   * 500 a minute passes 44 a day against 34, 16 of them under six hours old against 6, the median
   * age at passing 12.5 hours against 16.3; 10 more judged a day, about $0.09. The judge still
   * decides which of them is a meme.
   * ★ ON FROM 2026-10-14 AT 20k OR 250 A MINUTE, the owner's looser choice. Replayed on the videos
   * found 2026-10-13 11:30 to 2026-10-14 11:30 UTC (1,596): off, 42 pass, 7 under six hours old,
   * median age at passing 18.7 hours; 50k / 500, 63, 28 and 12.5 hours; 20k / 250, 85, 50 and 2.2
   * hours. About 43 more judged a day, roughly $0.40 of judging.
   */
  readonly shortVideoSpeedBar: { readonly enabled: boolean; readonly earlyReach: number; readonly fastReachPerMinute: number };
  /**
   * ★ THE SPEED BAR: one more way for a text post to clear For You's views bar — on pace to pass
   * `fypMinReach` by `horizonMs` after it was posted. At a reading between `minAgeMs` and
   * `horizonMs` old, with at least `minReach` views, its views a minute since the post AND (when an
   * earlier reading at least `recentMinSpanMs` before exists) since that reading must both reach
   * `fypMinReach / horizonMs`. The 40k total and the growth paths above stay; this only adds. OFF
   * (`enabled: false`) until the owner has seen the cost. Not the short-video source's: its own
   * growth paths already ask less.
   *
   * Replayed 2026-10-13 09:00–20:00 UTC (5,984 found posts, 175 For You posts, 45 coined gold posts
   * with readings): 40k by 90 minutes (444 a minute) from half an hour old, 15k views or more. Of
   * the 27 For You posts that waited at the bar, the median passes at 61 minutes instead of 110 (34
   * instead of 69 with five-minute re-reads); every post that passes today still does. It lets in
   * about 6.5 posts an hour that never read 40k (about $1.36 a day of judging). The owner's example,
   * 40k by two hours from ten minutes, let in 30 an hour ($6.45 a day) for the same gain; 40k by an
   * hour moved none of the 27.
   */
  readonly speedBar: {
    readonly enabled: boolean;
    readonly horizonMs: number;
    readonly minAgeMs: number;
    readonly minReach: number;
    readonly recentMinSpanMs: number;
    /**
     * ★ FOR YOU'S OWN YOUNGEST AGE ON THIS PATH (null: `minAgeMs`, as every other caller uses). Only
     * the projector's admission (services/project rising.ts `forYouBarPolicy`) reads it; the scorer's
     * "judge it now" and the replays keep `minAgeMs`, so it never asks the judge about one more post.
     * Every other condition — the pace, `minReach`, the recent rate, the judge, the junk bar — holds.
     */
    readonly forYouMinAgeMs: number | null;
  };
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
  /**
   * ★ THE KIND CATCH-UP. A post whose newest answer could pass (core `couldPassWithBoost`) and
   * that has met no kind question since — the kind judge was down when it was first answered
   * (2026-10-17, 11:06 to about 15:20 UTC, every pass in between) — is asked the kind, at most
   * this many a pass, newest answer first. Small: the kind question is cheap, but a backlog of a
   * few thousand should drain over hours, not as one burst on the kind judge's line.
   */
  readonly kindCatchUpPerPass: number;
  /**
   * ★ THE ORDER MODEL'S PASS BAR. For You is ordered by the re-tune's applied fit (core
   * `postRankScore`, internal.score_model) whatever this is; a number here also holds back a post
   * the rules passed but the fit puts under it. Null: no extra gate, today's rules decide. The
   * owner picks it from the trade-off table each re-tune reports. The number never reaches a screen.
   */
  readonly scorePassBar: number | null;
  /**
   * ★ FOR YOU'S JUNK BAR (the owner, 2026-10-20: "people shouldn't be thrown trashy narratives").
   * A post does not JOIN For You when the re-tune's applied junk fit (internal.junk_filter, core
   * `junkProbability`) puts it at or over the fit's For You bar; a post already on For You stays.
   * The bar is never a number here: a probability from one fit means nothing for another's weights,
   * so it is read from each fit's own held-out table (core `forYouJunkBar`) — the lowest threshold
   * at which at least `keepShare` of the owner's held-out memeable posts (the `keepGroups`: hand
   * gold and his "this is the coin" posts, his missed posts, his Meme taps) would still pass, with
   * at least `minTested` of them tested. No fit, no such row, or no vector for the post: no bar, the
   * post joins as before — a missing input is never read as junk. Coined posts are not a keep
   * group: a coin is not proof of a meme (the owner, 2026-10-20). Off: For You as before.
   */
  readonly junkBar: {
    readonly on: boolean;
    readonly keepShare: number;
    readonly keepGroups: readonly string[];
    readonly minTested: number;
  };
  /**
   * ★ FOR YOU'S VARIETY (the owner, 2026-10-15: "the feed is majority gta 6"). Among any
   * `varietyWindow` consecutive For You cards, at most `varietyPerWindow` are about one topic; the
   * rest of that topic leave the live list (services/project variety.ts) and stay on Popular, the
   * story page and the scroll's older pages. A topic is one story, one name (normalised), or posts
   * whose meaning vectors are at least `varietySameMeaning` alike. Off: For You as before.
   */
  readonly varietyOn: boolean;
  readonly varietyPerWindow: number;
  readonly varietyWindow: number;
  readonly varietySameMeaning: number;
  /**
   * ★ ONE ACCOUNT'S SHARE OF FOR YOU (the owner, 2026-10-23: "there's too much Mario Nawfal on For
   * You"). Among any `window` consecutive For You cards at most `perWindow` are from one account; its
   * most-viewed posts keep the places and the next post in line fills the gap (services/project
   * variety.ts, the same rule as the topic share). `window` is the live list's length, so it reads as
   * "at most two per account on the list". Measured over 48h of For You (23 Oct): one news account
   * held 6 of 60 cards, every other account 1–2, so two takes nothing from an ordinary account.
   * Off: no account limit.
   */
  readonly authorShare: {
    readonly on: boolean;
    readonly perWindow: number;
    readonly window: number;
  };
  /**
   * ★ OLDER FEED POSTS' VIDEOS, READ AGAIN (the owner, 2026-10-13: "so older posts play too"). A
   * text-source post on For You, Popular or a Feed alert whose video was stored with no playable
   * file is read again by id (services/runner/src/work/post-refill.ts) on the live posts line: at
   * most `refillPerPass` posts a pass (batched reads), `refillPerDay` a UTC day, and each post
   * at most `refillMaxTries` times.
   */
  readonly refillPerPass: number;
  readonly refillPerDay: number;
  readonly refillMaxTries: number;
  /**
   * ★ OLDER FEED POSTS' AUTHORS, FILLED IN (the owner, 2026-10-13: "for posts already in FYP and
   * Feed that don't have one, look up the authors"). The same re-read, under the same three caps,
   * also asks for a post whose author has no picture, name or follower count — one post per author
   * — but only on a source whose re-read quotes at most this many dollars a post. A source billed
   * by the run, whose quote is a full batch, is never re-read only for a picture.
   */
  readonly refillAuthorMaxUsdPerPost: number;
  /**
   * ★ A COIN NAMING A POST STANDS IN FOR ITS VIEWS (the owner, 2026-10-16: "the instant coin path").
   * A post whose metadata a coin names (internal.coin_post_link) clears For You's view bar without a
   * view reading when the first observed coin naming it launched at most `maxPostAgeAtLaunchMs`
   * after the post went up, and the post had at least `minApprovals` approvals at its newest read
   * (core `coinVouches`). It still needs the judge's yes, the kind question, the not-a-meme hold and
   * For You's six hours like any post: a coin is evidence that people are looking, never that it is
   * a meme. Off: every post is held to the view bars alone.
   */
  readonly coinLinked: {
    readonly on: boolean;
    readonly maxPostAgeAtLaunchMs: number;
    readonly minApprovals: number;
  };
  /**
   * ★ THE COIN-FIRST ROUTE (the owner, 2026-10-20). A coin's own link names a post — itself, or the
   * post its linked post reposts or quotes (one hop) — that was at most `oneCoin.linkMaxAgeMs` old at
   * the coin's launch. Once that coin trades at `oneCoin.minCapUsd` or more (the running rule's own
   * cap bar, so money goes only to coins that could be picked), the runner reads the post by id if we
   * do not hold it and asks the judge once if nobody has (services/runner work/coin-first.ts). The
   * post joins For You when the judge said yes AND the one-coin rule picked a coin that ties it this
   * way (core `coinFirstAdmits`): no view bar, no six hours, no junk bar — the coin running is the
   * evidence people are looking. Replayed over 13-20 Oct: admitting at the judge's yes alone would
   * have been about 1,650 posts a day, of which 3% ever had a coin that ran; with the running coin,
   * about 51 a day, a median 9.5 minutes after the launch.
   *
   *   fetchesPerDay / judgementsPerDay  the most posts read by id / judged a UTC day by this route,
   *                                     so a copycat wave cannot spend; past them the rest wait for
   *                                     the next day or the ordinary passes
   *   perPass                           the most posts one pass reads or judges, each
   *   lookbackMs                        coins launched this recently are looked at (the pick's watch)
   *   admitWithinMs                     a post whose coin launched this recently may still join;
   *                                     after it the route is closed and only the view bar remains
   *
   * ★ THE ORIGINAL, NEVER THE POINTER (`origin`, the owner, 2026-10-20: "i want to see the original
   * viral post not the [post] a degen who launched the coin made to explain the viral post"). The
   * coin's linked post is walked to the post it points at — a repost, a quote, a post its own links
   * name, or an earlier post by another account with the same first picture or video — and only that
   * original is read, judged, credited and admitted; the linked post is recorded as a pointer (core
   * match/coin-origin.ts). A quote, link or re-upload is followed when the post it points at was seen
   * at least as widely, or when the pointing post's author is a launcher; a launcher's post that
   * points at nothing is never taken.
   *   maxDepth                          the most hops from the linked post
   *   rereadLinks                       a held post whose links were never read (stored before the
   *                                     links were kept) and whose text has one is read again by id,
   *                                     once, under `fetchesPerDay`
   *   launcherLookbackMs                the window an account's posts are counted over
   *   launcherMinLinkedPosts / launcherMinLinkedShare / launcherMaxFollowers
   *                                     a launcher: at least this many of its posts in the window
   *                                     named by coins' own links, at least this share of its posts
   *                                     we hold, and fewer followers than this (core `isLauncher`)
   * Off: no read, no judgement, no admission by this route.
   */
  readonly coinFirst: {
    readonly on: boolean;
    readonly fetchesPerDay: number;
    readonly judgementsPerDay: number;
    readonly perPass: number;
    readonly lookbackMs: number;
    readonly admitWithinMs: number;
    readonly origin: {
      readonly maxDepth: number;
      readonly rereadLinks: boolean;
      readonly launcherLookbackMs: number;
      readonly launcherMinLinkedPosts: number;
      readonly launcherMinLinkedShare: number;
      readonly launcherMaxFollowers: number;
    };
  };
  /**
   * ★ A PROMOTION IS NEVER WHAT WE SHOW (policy.v167; the owner, 2026-10-24). A post that re-shares,
   * quotes or links another account's post (core match/coin-origin.ts `promoPointsAt`, one hop), when
   * that post was seen at least as widely (`promoFollows`), is a promotion wherever we found it, and is
   * on neither For You nor Popular by any route (services/project promotions.ts) — unless it was seen
   * by For You's own views bar (`fypMinReach`) itself: a commentary quote that went viral on its own is
   * a post people saw, not a pointer (replayed 21-24 Oct: 16 of the 40 For You posts the bare rule
   * catches were such quotes, 93K-515K views; every one under the bar had 0-28K). A post pointing at
   * one we do not hold is left as it was: who posted that one, and how widely it was seen, are unknown.
   * Its coin goes to the original: carried on the original's card when the original was at most the
   * coin-link age (`finders.coinLinks.creditMaxAgeMs`, `oneCoin.linkMaxAgeMs`) old at the coin's
   * launch; an older original carries it, and is brought back to For You, only while the coin runs by
   * `notify.savedPost`'s bars within `notify.launch.lateRunningMs` of its launch — and is then pushed
   * once (services/notify launch.ts). Off: every post is shown or held as before.
   */
  readonly promotion: {
    readonly on: boolean;
  };
  /**
   * ★ THE QUICK FRAME (the owner, 2026-10-16: "event-driven FYP"). Between the full frames, the
   * project service checks every `checkEveryMs` whether a judge's answer, a coin's link to a post the
   * judge passed or the owner's call on a post has landed since the last frame began. When one has, and the answers have
   * been quiet for `settleMs` (a pass files its kind answers after its yeses), it runs a quick frame
   * (services/project quick-frame.ts): only the changed posts are weighed, and For You is the last
   * frame with them added, re-placed or taken off. Beside a full frame that is still running (each
   * takes For You's write lock only to write, for-you-lock.ts), never within `minGapMs` of the last
   * quick one; the full frame keeps its own minute.
   * ★ `kindsInSkipsWait` (the owner, 2026-10-18: "run a quick feed update straight after an
   * instant-path answer, with no 10-second wait"): when every yes filed since the last quick frame
   * already has its kind answer — the instant coin path asks both in one pass — there is nothing to
   * wait for, and the frame runs at the next check with no settle and no gap.
   * Off: For You moves only with the full frame.
   */
  readonly quickFrame: {
    readonly on: boolean;
    readonly checkEveryMs: number;
    readonly minGapMs: number;
    readonly settleMs: number;
    readonly kindsInSkipsWait: boolean;
  };
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
  /** `secondVideo`: the short-video source's second vendor (its feed, re-reads and creator pages, `feed.secondVendor`). */
  /**
   * The short-video source's first scraper is left dormant at boot whatever its token (the owner,
   * 2026-10-20): its runs went from about $0.01 to $0.10 each that morning, and because a run is priced
   * before it is sent at the old rate, its own line did not hold — it spent $22.58 and the whole day.
   * The second vendor's reads are unaffected.
   */
  readonly shortVideoFirstScraperOff: boolean;
  readonly supplierLines: { readonly posts: number; readonly judge: number; readonly video: number; readonly actors: number; readonly embeddings: number; readonly secondVideo: number };
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
  /**
   * ★ THE RE-TUNE'S MONEY IS TAKEN FIRST (the owner, 2026-10-16: "reserve re-tune money first from
   * now on"; "cap tests and experiments at $1/day total, and never let them block re-tunes").
   * The learning book is split three ways on the one ledger:
   *   retuneReserveUsd  the last dollars of `dailyUsd`, which only the scheduled re-tune (tools/retune.ts
   *                     run and due, with its gold growth, fits and short-video part) may spend. Every
   *                     other learning spender is capped at `dailyUsd - retuneReserveUsd`.
   *   testsUsd          tests and experiments — every other paid tool on the learning book, `retune.ts
   *                     measure` included — across all vendors together, a day; rows `learn:test:`. A
   *                     call that would cross it is refused before it is made. Inside the capped part
   *                     above, so a test never reaches the reserve.
   * The runner's own learning work (fetching the owner's missed posts) is held to the capped part.
   */
  readonly learningLines: { readonly dailyUsd: number; readonly posts: number; readonly judge: number; readonly video: number; readonly embeddings: number; readonly retuneReserveUsd: number; readonly testsUsd: number };
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
  /** The Feed of people you follow (services/social activity.ts): items a page, Trador's twenty. */
  readonly feedPageSize: number;
  /** How many "People to follow" the Feed shows someone who follows nobody yet. */
  readonly peopleToFollow: number;
  /** The window "trades this week" and the People to follow ordering count over. */
  readonly peopleWindowMs: number;
  /** A trade's market cap is the market reading nearest its landing, if one is this close; none closer is no figure. */
  readonly tradeCapWindowMs: number;
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
  /**
   * How often the watched posts are checked: their coin lines, their coin lists, and every coin the
   * mint stream stored since the last look, against each watched post's guessed names and its link.
   * The owner asked to hear "within seconds"; each look is a few small reads of our own tables.
   */
  readonly watchLoopMs: number;
  /** New coins whose own metadata document is read per look, to find a watched post's link in it. Free reads, capped so a burst of launches cannot stall the loop. */
  readonly watchMetadataPerPass: number;
  /** A guessed name or ticker shorter than this never matches a new coin on its own: three letters match too much by chance. */
  readonly watchMinNameChars: number;
  /**
   * Starred narratives whose first coin one pipeline pass pushes about (services/notify
   * first-coin.ts). The rest wait, unmarked, for the next pass, so a burst of coins cannot make one
   * pass queue a push for every starrer of every narrative at once; nothing is dropped.
   */
  readonly firstCoinPerPass: number;
  /** A push undelivered after this long is dropped by the push service. */
  readonly pushTtlS: number;
  /**
   * ★ BLOWING UP ON FOR YOU (the owner, 2026-10-18: pushes bring people back, each worth opening).
   * A For You post is pushed as blowing up only when it is one of the first `topN` risers of
   * Trending now (Policy.rising.forYouSorts.risers, the list the app shows) AND gains at least
   * `minPerMin` views a minute over the last half hour (text-post views; a short video's divided by
   * its reach scale first, as Trending does). Posts with no coin yet are taken first. A brand-new
   * narrative (first post found under `newNarrativeMaxAgeMs` ago) counts as one too when its last
   * hour brought `newNarrativeMinPosts` new posts and `newNarrativeMinReach` views. A person gets at
   * most `perDay` of these in any `dayMs`, `minGapMs` apart; the rest are listed, not pushed. At
   * most `perPass` posts or narratives are taken a pass, each once ever.
   */
  readonly blowingUp: {
    readonly topN: number;
    readonly minPerMin: number;
    readonly perDay: number;
    readonly dayMs: number;
    readonly minGapMs: number;
    readonly perPass: number;
    readonly newNarrativeMaxAgeMs: number;
    readonly newNarrativeMinPosts: number;
    readonly newNarrativeMinReach: number;
  };
  /**
   * ★ A NARRATIVE YOU STARRED PICKS UP SPEED: its last hour brought at least `minNewPosts` new posts
   * and `minReach` views, and its views a minute now are at least `minRatio` times the half hour
   * before (when that is known). At most one push per person and narrative every `gapMs`.
   */
  readonly starredSpeed: {
    readonly minNewPosts: number;
    readonly minReach: number;
    readonly minRatio: number;
    readonly gapMs: number;
  };
  /**
   * ★ A BIG ACCOUNT POSTS IN A NARRATIVE YOU STARRED: an account with at least `minFollowers`
   * followers (as last read from its profile), a post made under `maxPostAgeMs` ago, once per
   * narrative and post. At most `perPass` such posts a pass. One push per person and narrative
   * every `gapMs`; the others are listed (on 16-18 Oct a busy narrative had six such posts a day).
   */
  readonly bigAccount: {
    readonly minFollowers: number;
    readonly maxPostAgeMs: number;
    readonly perPass: number;
    readonly gapMs: number;
  };
  /** A coin you hold halved: its price at or under this fraction of what you paid. Once per coin, ever. */
  readonly holdingDownAt: number;
  /**
   * ★ A COIN YOU MADE GETS ITS FIRST BUYERS: a coin created through Insidor under `maxCoinAgeMs` ago
   * whose newest `signaturesRead` transactions show a wallet other than its creator buying it.
   * At most `perPass` coins read a pass, oldest-checked first; once per coin.
   */
  readonly creatorBuyers: {
    readonly maxCoinAgeMs: number;
    readonly perPass: number;
    readonly signaturesRead: number;
  };
  /**
   * ★ GROUPED PUSHES: new followers and likes on your comments are listed one by one but pushed as
   * one ("3 new followers", "12 people liked your comment"). A group is pushed once its oldest
   * member has waited `waitMs` (so a burst lands in one push) and at least `gapMs` after that
   * group's last push. `useful` (people liking your comments): at most one push a day.
   */
  readonly grouped: {
    readonly follow: { readonly waitMs: number; readonly gapMs: number };
    readonly useful: { readonly waitMs: number; readonly gapMs: number };
  };
  /**
   * ★ THE ONE PUSH (the owner, 2026-10-20: "only receive notifications if theres a coin that just
   * launched and is running from that post and idc about the coins that come after"; "people going
   * about their day, not glued to the app"). Everyone with push on gets it, nothing to star: the
   * FIRST coin the one-coin rule picks for a For You post (or a narrative), only when that coin
   * launched at or after the post (the narrative's first post) was first on For You — the "caught
   * it early" case — and was picked within `maxLaunchAgeMs` of its launch. Never a hand-over,
   * never a second coin for the same post or narrative, never the same coin twice
   * (services/notify launch.ts). Every other kind is listed in the app and not pushed.
   *
   *   perDay, dayMs     at most `perDay` of these reach one phone in any `dayMs`; when a pass has
   *                     more than the room left, the highest market caps go first
   *   maxLaunchAgeMs    a pick seen later than this after the coin's launch is not "just launched"
   *   postsWithinMs     For You posts first shown this long ago or less are read for a pick (the
   *                     one-coin rule's link window: an older post is not re-picked)
   *   ownerAlarmsPush   the owner's own alarms (outages, supplier money, the namer, the re-tune
   *                     report) still reach his phone. Kept on as the safer default; false makes
   *                     the launch push the only push there is
   */
  readonly launch: {
    readonly perDay: number;
    readonly dayMs: number;
    readonly maxLaunchAgeMs: number;
    /**
     * ★ A COIN PICKED LATE STILL PUSHES WHILE IT RUNS (policy.v164; the owner, 2026-10-24: "sometimes
     * narratives get coined much later than 3hrs"; "include coins that pumped then died then started
     * pumping again within 24hrs"). Past `maxLaunchAgeMs` and up to this age, a first pick is pushed
     * only while its last hour clears `savedPost`'s running bars; till then its post waits, unspent, and
     * is looked at again every pass. $baldcat (24 Oct) was picked 5h50m after its launch and never pushed.
     */
    readonly lateRunningMs: number;
    readonly postsWithinMs: number;
    readonly ownerAlarmsPush: boolean;
  };
  /**
   * ★ A SAVED POST'S FIRST PUSH WAITS FOR ITS COIN TO RUN (the owner, 2026-10-24; services/notify
   * saved-post.ts). The first coin tied to a saved post after the save is pushed only once its
   * latest market reading's last hour reaches BOTH bars. Its own bars, not the running coins
   * strip's ($1,000 there): measured on the tied coins launched 23:25–23:51 UTC on 23 Oct (all
   * posts), $1,000 let through 53 coins of which 46 never passed $10K; $20,000 let through 8, with
   * 1 under $10K, and kept both that passed $50K. Lower it and duds like $KURIBOO (a $729 coin that
   * rugged in five minutes, 23:28 on 23 Oct) reach the saver's phone as "launched from a post you
   * saved"; raise it and the real coin's push comes later or not at all inside three hours.
   *
   *   minVolume1hUsd   dollars traded in the coin's last hour
   *   minTrades1h      buys plus sells in that hour, so a few large fills cannot pass on volume alone
   */
  readonly savedPost: {
    readonly minVolume1hUsd: number;
    readonly minTrades1h: number;
  };
  /** Reads and writes one person may make per `windowMs`. */
  readonly perClient: number;
  readonly windowMs: number;
  readonly languageDrop: LanguageDropPolicy;
  readonly judgeCost: JudgeCostPolicy;
}

/**
 * ★ THE JUDGE'S COST-PER-CALL ALARM (the owner, 2026-10-20): the owner is told when the post judge's
 * average cost a call over the last `windowMs` is more than `factor` times the median of the same
 * average over the `baselineMs` before it. On 2026-10-20 from 06:00 to 11:00 London the judge's
 * booked cost a call ran at four to seven times normal for five hours at the same number of calls,
 * and nothing said so; the day's line still had room, so the supplier warnings stayed quiet.
 *
 * THE RULE (services/runner judge-cost-alarm.ts): every `everyMs`, the judge's calls in hour-long
 * buckets ending now, counting only calls booked as billed (a refusal booked at $0 is no call). The
 * last bucket is "the last hour"; the baseline is the median of the average cost a call in each
 * bucket of the `baselineMs` before it that had at least `minCalls` calls, and is only trusted with
 * at least `minBaselineHours` such buckets. The last hour needs `minCalls` too: a handful of calls
 * is too few to call an average. Fired at most once every `quietMs`.
 *
 * Replayed by clock hour over every judge call the ledger holds (2026-10-16 20:00 to 2026-10-20
 * 13:00 London; 32 hours with a trusted baseline): it fires on each of the five hours from 06:00 to
 * 10:00 on 2026-10-20 (4.2 to 8.3 times the median), and at 13:00 that day, when the same thing
 * began again while this was being written (3.2 times). No other hour fires. The highest was 1.87
 * times, at 09:00 on 2026-10-19, the hour the judge moved to a dearer model with the baseline still
 * the cheaper one's; normal hours since sit at 1.1 to 1.7.
 *
 * What breaks if changed carelessly: a `factor` near 1 fires on a busy hour's larger batches; a
 * `minCalls` near 1 fires on one slow call; a `quietMs` shorter than the episode pushes it hourly.
 */
export interface JudgeCostPolicy {
  readonly on: boolean;
  readonly everyMs: number;
  readonly windowMs: number;
  readonly baselineMs: number;
  readonly factor: number;
  readonly minCalls: number;
  readonly minBaselineHours: number;
  readonly quietMs: number;
}

/**
 * ★ THE LANGUAGE-DROP ALARM (the owner, 2026-10-18): the owner is told when one language's finds by
 * a source's searches fall by more than `dropShare` against the same hours the day before. From
 * about 23:15 UTC on 16 Oct the text supplier answered an OR of languages with the last one only;
 * English finds fell from 8,811 a day to 46 and Japanese rose from 0 to 5,335, nothing failed, and
 * nobody was told for two days. The total barely moved, so only a per-language count says it.
 *
 * THE RULE (core notify/language-drop.ts, pure): every `everyMs`, a language's finds in the last
 * `windowMs` (rolling, not one clock hour: an hour is too few posts to tell a drop from a lull)
 * against the same `windowMs` `baselineAgoMs` earlier (the same hours of the day, so night is
 * compared with night). Down when the earlier window had at least `minBaselineFinds` and the last
 * one has fewer than (1 − `dropShare`) of it; back when the last window reaches `recoverShare` of
 * the window it dropped from. A language with too small a baseline, or none (newly added), never
 * goes down: it is too few posts to say. Each drop is said once and its recovery once.
 *
 * `lanes`: the search lanes counted, by the source's role (internal.item_found_by.lane; a post is
 * counted once, at the first of these lanes to find it). The coin-link and repost lanes are not
 * searches and are left out. `lookbackMs`: how far back each pass replays the rule, so a restart
 * knows a drop already under way (and its start, which names the alert) without a table;
 * `announceWithinMs`: only a change this recent is pushed, so a restart, or the replay's own
 * first steps, never push an old one.
 *
 * What breaks if changed carelessly: a `baselineAgoMs` other than a whole day compares night with
 * day and fires every evening; a `minBaselineFinds` much lower lets a small language's quiet
 * hours alarm; `announceWithinMs` at or above `lookbackMs` pushes the replay's first step.
 */
export interface LanguageDropPolicy {
  readonly on: boolean;
  readonly everyMs: number;
  readonly windowMs: number;
  readonly baselineAgoMs: number;
  readonly dropShare: number;
  readonly recoverShare: number;
  readonly minBaselineFinds: number;
  readonly lookbackMs: number;
  readonly announceWithinMs: number;
  readonly lanes: {
    /** The text source's searches. */
    readonly text: readonly string[];
    /** The short-video source's searches and lists. */
    readonly video: readonly string[];
  };
}

/**
 * ★ INVITE-ONLY ACCESS (services/social invites.ts, 0120). Every member holds `perMember`
 * single-use codes; someone with none joins the waitlist; the owner lets the next people in and
 * makes partner codes that work many times up to a cap. Everyone who had signed in before 0120
 * kept their access. Numbers only: who is a member is a row, never a setting.
 */
export interface InvitePolicy {
  /** Single-use codes every member holds, before any the owner gives everyone on top. */
  readonly perMember: number;
  /** Characters in a member's code, from an alphabet with no look-alikes (no 0, O, 1, I, L). */
  readonly codeLength: number;
  /** A partner code's cap when the owner names none. */
  readonly partnerDefaultUses: number;
  /** The most one partner code may be used: a slip of the finger does not open the doors. */
  readonly partnerMaxUses: number;
  /** The most the owner lets in from the waitlist in one tap. */
  readonly maxLetIn: number;
  /** The most extra codes the owner gives everyone in one tap. */
  readonly maxGive: number;
  /** Rows on the owner's top inviters list. */
  readonly topInviters: number;
  /** People a member sees under "Joined with your codes", newest first. */
  readonly joinedShown: number;
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
  /**
   * Hand gold that must pass, with `maxLiveNegativePass` the one gate: the committed gold sheets,
   * the owner's missed posts and the posts the owner put in eval/src/gold/hand-gold.json — memes,
   * news and tragedies alike, since For You is one feed for anything people could coin. The recall
   * check's other additions are auto gold, reported and never gated.
   */
  readonly minGoldPass: number;
  /**
   * Held-out live non-memes that may pass, at most. 15% for now (the owner, 2026-10-13): the
   * judge with the named-news rule lets about a fifth through, and a bar no block can meet
   * would keep every block out. Every gate is also held against the setup live now, measured
   * in the same run: a block is never applied if it is worse on gold, non-memes or missed posts.
   */
  readonly maxLiveNegativePass: number;
  /** The owner's missed posts that must pass ("most"). */
  readonly minMissedPass: number;
  /** Labelled posts in the examples block, at most: newest first, yes and no balanced. */
  readonly maxExamples: number;
  /**
   * Post ids always on the taught side of the examples/test split, whatever their hash says, and
   * first into the block: a missed post the owner wants learned back. The price is that such a post
   * is never tested again — it leaves the held-out missed set, so nothing measures whether the
   * judge now catches it. Keep it short; every id here is one fewer test post. The owner's split of
   * 2026-10-17 adds its taught half from eval/src/feed/owner-split.json (`teach`).
   */
  readonly alwaysTeach: readonly string[];
  /**
   * ★ THE OWNER'S GATE (the owner, 2026-10-17, for the 08:00 run on): with `on`, a new block is
   * applied only if (1) it catches strictly more of the owner's fixed test set than the setup live
   * now (eval/src/feed/owner-split.json `test`: posts never taught, whatever their hash), (2) its
   * hand gold is not lower than live's and (3) its junk is at most `maxJunkRise` (a share, 0.02 =
   * two points) over live's. Junk is measured on the owner's "Not a meme" taps on posts first shown
   * on `junkFeed` in the last `junkDays` days, as far as the block did not teach them. Among those,
   * the ones whose live kind label is in `newsKinds` or that carry no picture (random quotes,
   * celebrity and company news) are never taught while inside the window, so all of them are in
   * the test. The per-cutoff sweep still runs; these three conditions decide apply or refuse. The
   * post ids live in that file, not here, because a post id names its source.
   */
  readonly ownerGate: {
    readonly on: boolean;
    readonly maxJunkRise: number;
    readonly junkDays: number;
    readonly junkFeed: string;
    readonly newsKinds: readonly string[];
    /**
     * The second junk measure (the owner, 2026-10-18), reported beside the first and flagged when it
     * rises more than `maxJunkRise` too; the first decides. `sample` posts first shown on `junkFeed`
     * in the window that the owner never tapped, drawn by a hash seeded with `seed` so both sides of
     * a run are graded on the same posts, each labelled from the older judges' answers: the first
     * old judge's where it has one, else the second's, a "yes" only at `fallbackCutoff` or above.
     * An answer inside `unclearBand`, or two old answers that disagree, is unclear: out of the
     * number, listed for the owner to label. Only the old-label "not" posts are graded.
     */
    readonly untapped: {
      readonly sample: number;
      readonly seed: string;
      readonly fallbackCutoff: number;
      readonly unclearBand: readonly [number, number];
    };
  };
  /**
   * ★ POSTS PEOPLE COINED, TAUGHT AS "YES" (the owner, 2026-10-16: "teach the re-tune with coined
   * news and tragedy posts as yes examples"). A post that `minCoins` or more distinct coins were
   * launched for `lateMs` or more after it was posted, and that the judge answered "no", goes in
   * the block as a yes example: the newest `maxPerBlock`, inside `maxExamples` (since 2026-10-18 only the
   * room the owner's own calls leave, and never an animal or object: `animalObjectWords`). The late bar keeps out the bots that coin
   * anything within seconds; the count keeps out a lone copycat.
   *
   * An author with `deployerMinPosts` or more posts coined within `deployerWindowMs` of posting
   * launches coins on its own posts, and none of its posts is taught. A post the owner has called,
   * any hand-gold post, a post whose own words talk crypto (the shill rule's words) and a post of
   * a kind `judge.heldKinds` holds are never taught, so this cannot argue with the owner, the gate's
   * test, the shill rule or the held kinds. Taught posts are never tested.
   */
  readonly coinedYes: {
    readonly on: boolean;
    readonly minCoins: number;
    readonly lateMs: number;
    readonly maxPerBlock: number;
    readonly deployerWindowMs: number;
    readonly deployerMinPosts: number;
    /**
     * A coined post is not taught when its words, a name any judge proposed for it, or its kind
     * label name an animal or an object (the owner, 2026-10-18: the judge already gets those right,
     * so they would only take room). A word test, stated: no picture classification is kept.
     */
    readonly animalObjectWords: readonly string[];
  };
  /**
   * ★ "SEEN AND KEPT", THE OWNER'S SOFT YES (the owner, 2026-10-18: "anything I leave on For You
   * without tapping Not a meme counts as good ... these count as softer yes labels than a gold or
   * missed post I sent you ... my explicit labels win if they disagree"). A post the app saw on the
   * owner's screen for two seconds, or that he opened (internal.owner_seen, 0098), with no "Not a
   * meme" `keepWindowMs` after the first sight, and no explicit call of his (store owner-seen.ts).
   *
   * Read from the posts first seen in the last `lookbackMs`. The judge's block teaches the newest
   * `maxPerBlock` of them as yes in the room the owner's own calls and missed posts leave — never
   * displacing one — and after the coined posts when `afterCoined` (the default: a kept post is one
   * the judge already passed, so it confirms where a coined "no" corrects), before them otherwise.
   * They are never tested. The coin model's fit counts each as a yes with sample weight `fitWeight`
   * (an explicit label or a coined post weighs 1), and never in its test or validation numbers.
   */
  readonly seenKept: {
    readonly keepWindowMs: number;
    readonly lookbackMs: number;
    readonly teach: boolean;
    readonly maxPerBlock: number;
    readonly afterCoined: boolean;
    readonly fitWeight: number;
  };
  /**
   * ★ PERIODS THE RE-TUNE DOES NOT TAKE AS NORMAL (the owner, 2026-10-18). A post first stored inside
   * one of these is left out of what the re-tune reads as the usual feed: the junk (b) sample of
   * untapped For You posts and the seen-and-kept soft yes. The owner's own calls, missed posts and
   * coined posts are kept: they are true whatever the search was doing. ISO times, `until` exclusive.
   */
  readonly abnormalWindows: readonly { readonly from: string; readonly until: string; readonly why: string }[];
  /** Missed-post links the owner may paste at once. */
  readonly maxMissedPerPaste: number;
  /**
   * The order model's fit (tools/lib/score-model.ts), re-fitted at each re-tune on every label so
   * far. `scoreHeldOutShare` of labelled posts, chosen by a hash of the post id so a post is held
   * out in every fit or in none, are never fitted on and are the gate's test. `scoreL2` is the
   * ridge on the standardised weights: the label set is small (about 150 posts with stored facts,
   * 2026-10-13), and an unpenalised fit memorises it.
   */
  readonly scoreHeldOutShare: number;
  readonly scoreL2: number;
  /**
   * ★ THE NEW BLOCK'S YES/NO CUTOFF IS TUNED BEFORE IT IS REFUSED (the owner, 2026-10-16). On the
   * answers the test already collected, the new block's confidence cutoff is raised from the live
   * bar in steps of `cutoffStep` up to `cutoffMax`: the strictest cutoff with hand gold and missed
   * posts caught no worse than live and fewer live non-memes is applied with the block; failing
   * that, the one with the fewest live non-memes no worse than live, more hand gold and missed
   * posts caught no worse; failing that, the block is refused. Missed posts are counted overall
   * (the owner, the same day): one post live catches and the block does not is named, not a
   * refusal. A raised cutoff can only remove passes, so it costs nothing.
   */
  readonly cutoffStep: number;
  readonly cutoffMax: number;
  /**
   * ★ THE OWNER'S RULEBOOK (the owner, 2026-10-16: "a rulebook built from all my inputs, rebuilt at
   * every re-tune"). At each re-tune a bigger open model (RULEBOOK_MODEL) writes at most `maxRules`
   * rules of at most `maxRuleChars`, `maxChars` in all, from the block's own lines, the owner's
   * standing decisions and counts over every input (tools/lib/rulebook.ts); they go in the block
   * under their own heading, so the gate tests block and rulebook together. A note is counted once
   * `minNoteUses` posts carry it, cut to `maxNoteChars`; the `maxNotes` most used are shown. Off:
   * the block alone, as before.
   *
   * `ownerRules` are the owner's own rules, word for word: always at the top of the rulebook the
   * re-tune writes (the written rules follow), also when no rule could be written, and given to the
   * writer as standing decisions so it never argues with them.
   */
  readonly rulebook: {
    readonly on: boolean;
    readonly ownerRules: readonly string[];
    readonly maxRules: number;
    readonly maxRuleChars: number;
    readonly maxChars: number;
    readonly maxOutputTokens: number;
    readonly maxNotes: number;
    readonly minNoteUses: number;
    readonly maxNoteChars: number;
  };
  /**
   * ★ THE SHORT-VIDEO SOURCE, TUNED FROM ITS OWN COINED VIDEOS (the owner, 2026-10-16: "tuned from
   * coined TikToks, not copied from X"). The training set (internal.coined_video, 0085) is every
   * coined short video; the re-tune learns from it twice a day (tools/retune.ts, its short-video
   * part) and records what it learned (internal.short_video_tuning).
   */
  readonly shortVideo: {
    /** The ages (minutes after posting) the learned speed bar reads views at. */
    readonly barAgesMin: readonly number[];
    /** Two of our readings further apart than this are not interpolated between: no view count at that age. */
    readonly readingGapMs: number;
    /**
     * Coined videos with a view count at an age in `barAgesMin` needed before a speed bar is
     * proposed from them. Below it the re-tune says how many it had and keeps the bar in use.
     */
    readonly minEarlyCoined: number;
    /** The proposed bar lets in this share of those coined videos (the bar is their low quantile). */
    readonly barCatchShare: number;
    /**
     * Grade the source's coined videos, its "Not a meme" taps and its missed posts beside the
     * re-tune's test, on the learning book, and hold the block to them too: no fewer coined
     * videos caught, no more junk, no missed post lost. About 60 more test posts a run.
     */
    readonly gateOn: boolean;
    /** Read again by id, at each re-tune, the newest coined videos we never held (their words, tags, sound). */
    readonly refetchOn: boolean;
    readonly refetchPerRun: number;
    /** The short-video sources review (the review tool under tools/): each lane's cost against its lead, after this long. */
    readonly reviewAfterMs: number;
  };
}

/**
 * ★ CRYPTO ATTENTION: what replies and reproductions under a For You post say about coins, read as
 * facts (core/src/qualify/attention.ts) and stored (internal.crypto_attention, 0064). The owner's
 * sheets: 64% of coined posts had "crypto noticed" and 38% a ticker in the replies. MEASURED, NOT
 * WIRED: nothing here moves a post on or off a feed; the owner picks how it is used.
 */
export interface AttentionPolicy {
  /** Replies read per post, newest first (one search page is 20). */
  readonly repliesPerPost: number;
  /** Reproductions (posts carrying this one inside theirs) read per post, newest first. */
  readonly reproductionsPerPost: number;
  /** Posts read per runner pass, and per UTC day (first reads and re-reads together). */
  readonly postsPerPass: number;
  readonly postsPerDay: number;
  /** A post read once is read once more this long after its first read; null reads it once. */
  readonly rereadAfterMs: number | null;
  /** Words (whole, any case) that make a response talk about a coin. */
  readonly coinWords: readonly string[];
  /** Words (whole, any case) in an account's handle, name or profile that make it a crypto account. */
  readonly cryptoAccountWords: readonly string[];
  /** A cashtag's letters after the sign: at least / at most. */
  readonly tickerMinChars: number;
  readonly tickerMaxChars: number;
  /** An address-shaped string: this many characters of the address alphabet, or a hex address this long after 0x. */
  readonly addressMinChars: number;
  readonly addressMaxChars: number;
  readonly hexAddressChars: number;
}

/**
 * ★ THE NAMER: the names and tickers people will actually coin a post as (the owner, 2026-10-14).
 * For each post that passes the feed's bar, its `k` nearest known post → coin pairs (by the post
 * vector the precedents already paid for) are shown to the judge's model with the post, and it
 * answers its `guesses` likeliest coin names and tickers, best first. Coin matching searches with
 * all of them; the Create sheet offers the first `createIdeas`. services/runner work/name-guesses.ts.
 */
export interface NamesPolicy {
  /** The switch. Off: no example is embedded, no guess is asked, and Create shows the judge's names as before. */
  readonly on: boolean;
  /**
   * Whether a coin found only through the namer's guessed names may be a card's own coin (with Buy).
   * Off: such a coin is only ever in "See N coins", whatever proved it. On: it still needs a real
   * check (a link, the picture, the address under the post) like every proven coin. The owner's
   * demo safety net (2026-10-14): off until the gate passes on his labels, the 71 and held-out 22.
   */
  readonly cardsFromGuesses: boolean;
  /** Known pairs shown with each post: its closest example posts, all their coin names. */
  readonly k: number;
  /**
   * Of the `k`, up to this many are the closest examples from the post's own source, first (core
   * `ownSourceFirst`): how people name coins from short videos, for a short video. 0 is off. $0.
   */
  readonly sameSourceFirst: number;
  /** Guesses asked for and kept per post. */
  readonly guesses: number;
  /** Of them, how many lead the Create sheet's suggestions. */
  readonly createIdeas: number;
  /** Posts per call, as the judge batches. */
  readonly perCall: number;
  /**
   * Posts per call when the open model guesses (Policy.judge.askWith.names). Measured 2026-10-16 on
   * 30 live feed posts: asked ten at a time with their pictures it answered only the first post or
   * two and stopped (18 of 30 unanswered); three at a time, two of three; one at a time, every one,
   * in 5 to 10 s for about $0.00013.
   */
  readonly openPerCall: number;
  /** The open model's names calls in flight at once, so one post a call does not make a pass take minutes. */
  readonly openParallel: number;
  /** Posts guessed per pass at most, newest first: the day's volume drains, a burst never spends the line at once. */
  readonly perPass: number;
  /** New example posts embedded per pass at most (the owner's confirmations come first). */
  readonly examplesPerPass: number;
  /** A post's words, as the namer is shown them. */
  readonly maxChars: number;
  /** An example post's words, as the namer is shown them. */
  readonly exampleChars: number;
  /** The answer's token ceiling for one call of `perCall` posts. */
  readonly maxOutputTokens: number;
  /** A guess counts as the coin's name when, with case, accents, '$' and spaces gone, it is the same, or this close. */
  readonly closeSpelling: { readonly minChars: number; readonly maxEdits: number };
  /** The ticker a guess is cut to, as the venue allows. */
  readonly maxTickerChars: number;
  /** How far back a judged post is still guessed for: the feed's own day is long past this. */
  readonly windowMs: number;
  /** Only posts on For You or Popular (~450 a day: the live frame and the scroll's members) instead of every post that passes the bar (~2,400): the cheaper scope. */
  readonly feedOnly: boolean;
  /**
   * The first day on, watched (tools/name-watch.ts, 0077): every coin newly shown on a feed post
   * that showed none is recorded; for `hours` after the baseline, once the owner has called at
   * least `minWrong` of those the namer's names found "Wrong coin" or "No coin", and their wrong
   * share is above his wrong share on shown coins in the `hours` before, the namer is vetoed.
   */
  readonly watch: { readonly hours: number; readonly minWrong: number };
}

/**
 * The feed's translations (services/runner work/translate-posts.ts, 0081): a post on For You,
 * Popular or the scroll whose words are not English is translated once, on the judge's line under
 * its own `translate` endpoint, and the card shows the English with "Translated from <language>"
 * under it and the original one tap away. Measured 2026-10-14 over two days: 28 of 440 feed posts
 * were not tagged English or wordless, 14 of them only hashtags; about 7 a day to translate.
 */
export interface TranslatePolicy {
  /** The switch. Off: nothing is asked and every card shows its original words, as before. */
  readonly on: boolean;
  /** Posts per call. */
  readonly perCall: number;
  /** Posts translated per pass at most, newest on a feed first. */
  readonly perPass: number;
  /** A post's words as the model is shown them; the card shows fewer. */
  readonly maxChars: number;
  /** The answer's token ceiling for one call of `perCall` posts. */
  readonly maxOutputTokens: number;
  /** How far back a feed post is still translated: the scroll's members shown inside it. */
  readonly windowMs: number;
  /**
   * How far back a shown narrative's posts are translated too (by when they joined): its page lists
   * posts no feed holds. 0: feed posts only, as before policy.v176.
   */
  readonly narrativesWindowMs: number;
  /** Fewer letters than this once tags, handles, $tickers, links, digits and emoji are taken out: nothing to translate. */
  readonly minLetters: number;
  /** Source language tags that mean English: such a post is never sent. */
  readonly englishCodes: readonly string[];
  /** Source language tags that mean no words to translate (media only, tags only, unknown short text). */
  readonly noWordsCodes: readonly string[];
}

/**
 * ★ NARRATIVES: POSTS THAT PASSED THE JUDGE, GROUPED BY WHAT THEY ARE ABOUT (the owner, 2026-10-16).
 * The grouping the Narratives tab, the post sheet's "Part of the … story" line and the story coins
 * all read (core group/narrative.ts; services/runner work/narratives.ts writes it, 0093).
 *
 *   who counts   a post the judge passed at its own model's cutoff, not one the owner called "Not a
 *                meme", not a held kind (an ad, the close-match hold…), not a shill; and not a thin
 *                post — under `postCoin.storyCoin.minWords` words once hashtags, mentions and links
 *                are gone — unless it has a picture
 *   two posts    link when their words-and-picture vectors are at least `sameMeaning` alike, they
 *                share one detail (the story coins' rule: a name, the same picture at
 *                `group.image.likely`, or a topic word that is not a hashtag), and they went up at
 *                most `maxGapMs` apart
 *   a narrative  posts joined by average linkage: two groups join only when at least
 *                `minLinkShare` of the post pairs across them link, so a chain of posts each a
 *                little further from the first never becomes one narrative; its posts span at most
 *                `maxSpanMs`; then groups that are one story told in parts — one's posts on average
 *                `mergeMeaning` from the other's average vector, and a link or a name between them —
 *                join, and a post under `mergeMeaning` from its narrative's average leaves it
 *   on screen    `minPosts` good posts, or one post that is clearly huge and climbing fast: at least
 *                `single.minReach` views and `single.minPerMinute` a minute over the last
 *                `single.growthWindowMs` (short videos at `rising.shortVideoReachScale` times both)
 *   the owner    "Not a narrative" hides it at once and keeps its posts from being grouped together
 *                again; "Remove this post" keeps that post out of any narrative holding the posts it
 *                was with; "Merge with…" joins the two narratives' posts. No number here can
 *                outvote one of his calls.
 *
 * Measured 2026-10-16 (tools/narratives.ts dry run over the day's posts): `sameMeaning` 0.6 is the
 * For You topic bar (rising.varietySameMeaning), measured on the launch-trailer frame — posts about
 * one story sat 0.60 to 0.75 apart, unrelated posts' nearest neighbour 0.52 or less. The single
 * bar: of the posts the judge passed in the 48 hours before, the text source's 95th percentile of
 * views was 506k (90th 268k, 99th 2.27M); those over 500k grew at a median 2,686 a minute over
 * their last hour, the rest at 69 (90th 866). So 500k and 2,000 a minute — the For You fast-growth
 * bar — is "clearly huge and climbing", a few posts a day.
 */
export interface NarrativePolicy {
  /** The switch. Off: the runner groups nothing and the board keeps the narratives last written. */
  readonly on: boolean;
  /** How often the runner regroups. */
  readonly everyMs: number;
  /** How far back a post is considered, by when it went up. */
  readonly windowMs: number;
  /** At most this many good posts are grouped a pass, newest first (a bound on the pass's time). */
  readonly maxPosts: number;
  /**
   * A good post with no words-and-picture vector yet (judged while the embeddings were down, or
   * before they were kept) is embedded here, at most this many a pass, newest first, on the live
   * embeddings line — so a missing vector is a delay, never a post left out for good. 0: never.
   */
  readonly embedPerPass: number;
  /**
   * Whether posts a story's name search brought in — judged, never on the feed — may be a
   * narrative's posts too. Off: the feed's posts only, the posts For You is made from.
   */
  readonly searchedPosts: boolean;
  readonly sameMeaning: number;
  /** Two posts the judge gave the same name link from this alike; any other shared detail needs `sameMeaning`. */
  readonly nameMeaning: number;
  readonly maxGapMs: number;
  readonly maxSpanMs: number;
  readonly minLinkShare: number;
  /**
   * A group (or a post) whose posts are on average at least this alike to another group's average
   * vector, and that shares a detail with it — a link between their posts, or a name — is one story
   * told in parts, and joins it; a post under this from its own narrative's average leaves it.
   */
  readonly mergeMeaning: number;
  readonly minPosts: number;
  /**
   * ★ AND FROM THIS MANY ACCOUNTS (the owner, 2026-10-18: "only shown once it has 2 posts from 2
   * different accounts"). One account posting the same thing twice is a post, not a narrative. A
   * narrative under it is kept — narratives are permanent — but not listed, paged or tagged on a
   * post until it grows (services/project narrative-frame.ts).
   */
  readonly minAccounts: number;
  /**
   * ★ ONE STORY, ONE NARRATIVE (the owner, 2026-10-18: "the same narrative posted several times").
   * Two narratives are the same subject when their posts' average vectors are at least `meaning`
   * alike AND the judge's most common name is the same for both, held by at least `nameShare` of
   * each one's named posts. Then a new group of posts joins the narrative already made instead of
   * becoming another one, and a newer narrative is merged into the older (recorded as an automatic
   * merge, never over a narrative the owner made a call on). Read over the shown narratives with a
   * post in the last `lookbackMs`.
   */
  readonly same: {
    readonly on: boolean;
    readonly meaning: number;
    readonly nameShare: number;
    readonly lookbackMs: number;
    /** A name this short or longer counts (Neo, Gus: three letters), after `group.genericSpans` and `genericNames` are out. */
    readonly minNameChars: number;
    /** Names that say what kind of thing, not which one: two different cats are not one story. */
    readonly genericNames: readonly string[];
  };
  readonly single: {
    /** Off from 2026-10-18 (the owner's two posts from two accounts): a single post is no narrative however big. */
    readonly on: boolean;
    readonly minReach: number;
    readonly minPerMinute: number;
    readonly growthWindowMs: number;
    readonly growthMinSpanMs: number;
  };
  /**
   * The narrative's title: one call to the cheap open model per new narrative, and again once its
   * posts have grown by `retitleGrowth` since; at most `perPass` a pass, `postsSent` posts of
   * `maxChars` characters each, an answer of `maxOutputTokens`. Off, or the call fails: the name
   * the judge gave most of its posts.
   */
  /**
   * The narrative's views over time (its page's chart, the tab's "gained in the last hour" and its
   * order). The owner's rule (2026-10-17): each post's gain is worked out from its own readings and
   * the posts are added up. Between two readings of a post its gain is spread evenly over the time
   * between them; before its first reading and after its last it adds nothing (never guessed
   * forward), so a post found late adds no spike. The page's line is the gain in each `stepMs` over
   * the last `spanMs`; the last hour's gain is the same sum over the last `gainWindowMs`.
   */
  readonly reach: {
    readonly stepMs: number;
    readonly spanMs: number;
    readonly gainWindowMs: number;
    /**
     * The page's "All" line: the same gains from the narrative's first reading to now in coarser
     * slots of `allStepMs`, at most `narrative.windowMs` long (no post is older), so a story older
     * than `spanMs` still has its whole line in a bounded number of slots.
     */
    readonly allStepMs: number;
  };
  readonly trend: NarrativeTrendPolicy;
  readonly title: {
    readonly on: boolean;
    readonly perPass: number;
    readonly retitleGrowth: number;
    readonly postsSent: number;
    readonly maxChars: number;
    readonly maxOutputTokens: number;
    readonly maxTitleChars: number;
  };
  /**
   * ★ THE EARLY POSTS (the owner, 2026-10-18: "when a narrative forms or grows, check all stored
   * posts from up to 7 days back that match it and add them, so the earliest one is included").
   * The regroup sees only the last `windowMs`, newest first, at most `maxPosts`; a story's first
   * posts fall off it as it ages. After each regroup, posts the regroup could NOT see — older than
   * the window but inside `lookbackMs`, or over the cap — are matched to the narratives that formed
   * or grew (core group/narrative-early.ts): a link to one of its posts (meaning at `sameMeaning`
   * and a shared name or topic word) and the narrative's average at `mergeMeaning`, the parts'
   * own rule. They are listed with it, marked early (0100), and never change its id or the owner's
   * calls on it.
   *
   * Bounded: the stored posts are read once and again every `refreshMs` (one index-backed read of
   * judged-yes posts, at most `maxArchive`); at most `perPass` narratives are matched a pass and at
   * most `maxVectorsPerPass` new vectors read for it; a narrative keeps at most `maxPerNarrative`
   * early posts, the earliest first. A narrative not matched this pass keeps the early posts it had.
   */
  readonly early: {
    readonly on: boolean;
    readonly lookbackMs: number;
    readonly refreshMs: number;
    readonly maxArchive: number;
    readonly perPass: number;
    readonly maxVectorsPerPass: number;
    readonly maxPerNarrative: number;
  };
  /**
   * ★ A NARRATIVE IS PERMANENT; A QUIET ONE IS DEAD (the owner, 2026-10-18: "if a narrative has had
   * no new posts for 48 hours, mark it dead. It still shows under Most viewed and New, and its own
   * page and posts stay reachable. It's just left out of Trending"). Dead is read from its newest
   * post (core group/narrative-keep.ts `narrativeDead`), never stored, so a new post brings it back.
   *
   * The board frame projects the newest narratives in full every frame (live ones first, then the
   * most recently dead, at most the board's limit); every other narrative keeps the page last
   * written for it, and `pagesPerFrame` of them are projected again each frame, never-projected
   * first, then the longest since — so a page written once stays reachable for good, and its views
   * are at most (narratives ÷ `pagesPerFrame`) frames old. `pageSize` is the All time list's page
   * (services/read GET /narratives/:view/all), the phone's 20 at a time.
   */
  readonly dead: {
    readonly afterMs: number;
    readonly pagesPerFrame: number;
    readonly pageSize: number;
  };
  /**
   * ★ "LAUNCHED" IS THE CREATE TRANSACTION'S BLOCK TIME (the owner, 2026-10-18). A coin a shown
   * narrative's page names whose stored launch is not the chain's (a live notice's arrival, an
   * aggregator's pair time) has its oldest transaction's block time read, at most `perPass` a pass
   * and `perDay` a UTC day, and stored as the chain's. One RPC call a coin, never a walk of its
   * pages (`getTransactionsForAddress`, oldest first, one row), on the runner's chain key, the same
   * call the coin lookup makes for every coin it finds. A coin past the day's count stays "launch
   * not known" until the next day.
   */
  readonly launchClock: {
    readonly on: boolean;
    readonly perPass: number;
    readonly perDay: number;
  };
  /**
   * ★ ONE SEARCH BACKWARDS WHEN A NARRATIVE FORMS (the owner, 2026-10-18). A shown narrative of at
   * least `minPosts` posts, first shown in the last `formedWithinMs`, is searched once by its
   * narrative-name search name (work/narrative-names.ts `chooseName`), from `lookbackMs` before its
   * first post up to that post, at most `maxPagesPerAsk` pages, at most `perPass` narratives a
   * pass, biggest first. Its own day, `cap`, in the 'narrative_back' ledger lane, apart from the
   * forward search's `feed.narrativeNames.cap`; its posts are credited to the 'narrative_name'
   * found-by lane, are judged like any found post, and the early posts above put the ones that
   * pass into the narrative.
   */
  readonly backSearch: {
    readonly on: boolean;
    readonly minPosts: number;
    readonly formedWithinMs: number;
    readonly lookbackMs: number;
    readonly maxPagesPerAsk: number;
    readonly perPass: number;
    readonly cap: LaneCapPolicy;
    readonly passDeadlineMs: number;
  };
  /**
   * ★ THE STARTING POST AND ONE STORY ACROSS LANGUAGES (the owner, 2026-10-23: "find the posts that
   * START the narratives first"), core group/narrative-origin.ts. Stored posts and stored links only;
   * nothing is searched, embedded or judged.
   *
   *   trace   a stored post from up to `lookbackMs` before a narrative's first post, judged yes or
   *           tied to a coin, joins it as an earlier post when the narrative's posts quote it (at
   *           most `maxHops` quote or link steps) — or shares a name with one of its posts at
   *           `narrative.nameMeaning` and the narrative's average at `nameAverage` — and, quoted, is
   *           at `linkMeaning` from the average. At most `maxPerNarrative`
   *   merge   two narratives formed within `formedWithinMs` of each other, their averages at
   *           `mergeMeaning`, merge when both quote the same judged starting post, or when quotes
   *           join them through at least `minLinkPosts` of their posts
   *   bounded the narratives with a post in `liveMs`, at most `perPass` traced a pass
   *   floor   `viralFloor`: a narrative is listed only while one of its posts clears For You's own
   *           views bar (`rising.fypMinReach` and its growth paths, core `clearsReachBar`), and a
   *           post traced back as a start must clear it too: small posts join, never start
   *
   * policy.v145 (the owner, 2026-10-23: "all the posts I gave you should come under the same
   * narrative" — the "Vegeta is Algerian" French–Japanese war):
   *   root    `rootOn`: a post the judge said no to (or never asked) may still be a narrative's
   *           starting post when at least `rootMinQuoters` posts quote it (`maxHops`) — its own, or
   *           loose posts that join through it (below) — it is at `rootMeaning` from their average
   *           and it clears the views bar above
   *   join    `joinOn`: a good post in no narrative joins the one whose posts or starting posts it
   *           quotes (at `linkMeaning`), or whose rare phrase it says — two neighbouring content
   *           words of at least `phraseMinChars` letters (`phraseMinCjkChars` in katakana or han),
   *           said by at most `phraseMaxShare` of the posts read, in its words or its stored English
   *           — at `phraseMeaning`. With `joinViral`, only a post that clears the views bar above
   *           joins this way (a small post joins by the regroup's own links). At most
   *           `joinPerNarrative` a narrative a pass
   *   missed  `missedJudge`: the owner's pasted post is judged by the live post judge once, whatever
   *           its age; `missedLookbackMs`: a pasted post this recent takes part in the regroup
   *           (and every rule above) though it is older than the regroup's window
   *
   * policy.v149 (the owner, 2026-10-23: "they should all come under one narrative" — the Yotsuya
   * station goats, three Japanese narratives quoting nothing):
   *   words   `wordsOn`: two narratives also merge when they say at least `wordsMinShared` rare words
   *           between them (narrative-phrase.ts `storyWords`: a phrase, or a two-character piece of
   *           a han or katakana run; rare at `phraseMaxShare` of the posts read, and said by at most
   *           `wordsMaxNarratives` narratives, and by at least `wordsMinCoverage` of each side's posts),
   *           their averages are at `wordsMeaning`, and they were
   *           first shown within `wordsFormedWithinMs` of each other. Never on a narrative the owner
   *           made a call on, nor across posts he kept apart
   *
   * policy.v166 (the owner, 2026-10-24: @hezuruy's "whoever killed the little deer, come out… Nara",
   * judged PATROL, never joined "Four Baby Deer Found Dead in Nara Park" — "widen the join"):
   *   looseWords  `looseWordsOn`: a loose post (held to `joinViral` as every join) also joins a
   *           narrative it shares at least `wordsMinShared` single rare words with — content words
   *           (narrative-phrase.ts `contentWords`) of its own words or its stored English, folded by
   *           `wordStems` and a plural `s`, said by at most `phraseMaxShare` of the posts read, by at
   *           most `wordsMaxNarratives` narratives, and by at least `wordsMinCoverage` of the
   *           narrative's posts — and at least one of them a NAME both sides write (title case
   *           inside a sentence: "Nara", "Milei"), at `looseWordsMeaning` from its average. The
   *           judge's names may differ.
   *           Never into a narrative the owner made a call on, nor a meme war (its own rules hold)
   */
  readonly origin: {
    readonly on: boolean;
    readonly lookbackMs: number;
    readonly maxHops: number;
    readonly linkMeaning: number;
    readonly nameAverage: number;
    readonly maxPerNarrative: number;
    readonly mergeOn: boolean;
    readonly formedWithinMs: number;
    readonly mergeMeaning: number;
    readonly minLinkPosts: number;
    readonly liveMs: number;
    readonly perPass: number;
    readonly viralFloor: boolean;
    readonly rootOn: boolean;
    readonly rootMinQuoters: number;
    readonly rootMeaning: number;
    readonly joinOn: boolean;
    readonly joinViral: boolean;
    readonly joinPerNarrative: number;
    readonly phraseMinChars: number;
    readonly phraseMinCjkChars: number;
    readonly phraseMaxShare: number;
    readonly phraseMeaning: number;
    readonly missedJudge: boolean;
    readonly missedLookbackMs: number;
    readonly wordsOn: boolean;
    readonly wordsMinShared: number;
    readonly wordsMaxNarratives: number;
    readonly wordsMinCoverage: number;
    readonly wordsMeaning: number;
    readonly wordsFormedWithinMs: number;
    readonly looseWordsOn: boolean;
    readonly looseWordsMeaning: number;
    /** A word → the word it is read as, for the single-word join: "fawn" is "deer". Lower-case, accents folded. */
    readonly wordStems: Readonly<Record<string, string>>;
  };
  /**
   * ★ ONLINE MEME WARS BETWEEN COUNTRIES (the owner, 2026-10-23, policy.v154): the titler, in the
   * same call that writes a narrative's title, also says whether the narrative is users of two or more
   * countries trading memes and insults with each other online, and which countries. Real wars,
   * riots, politics, diplomacy and sports rivalries are not. The answer is stored with the narrative
   * (0130) and every narrative so tagged with a post in the last `activeMs` is shown under one
   * umbrella in the app, one section per pair of countries.
   *
   *   on            ask it (with every title, and for the live narratives never asked)
   *   activeMs      a tagged narrative is under the umbrella while its newest post is this recent
   *   perPass       live shown narratives never asked, asked a pass beside the titles (newest first)
   *   maxCountries  the most countries one fight names; more is read as no fight (a world-wide meme)
   *   minPosts      the fewest posts a narrative lists to be shown as a fight: the copy test of
   *                 2026-10-23 found the only wrong yeses on two-post narratives with little to read
   *   maxOutputTokens  the title call's answer allowance while the question rides on it (the title's
   *                 own `title.maxOutputTokens` leaves no room for the countries)
   */
  readonly fight: {
    readonly on: boolean;
    readonly activeMs: number;
    readonly perPass: number;
    readonly maxCountries: number;
    readonly minPosts: number;
    readonly maxOutputTokens: number;
    /**
     * ★ A COUNTRY NAMED IN ANOTHER COUNTRY'S LANGUAGE (the owner, 2026-10-24, policy.v157): "whenever
     * those countries mention the other country in their native language, it is beef related". A
     * stored post in a language of `home` that names another country of `names` in that language
     * (a French post saying "Japon", a Japanese one saying フランス), at `minReach` views or more, is
     * a meme-war post of that pair (core group/fight-native.ts). The judge's yes is not needed: on
     * 23-24 Oct every French post mocking the Japanese (46k to 316k views) and the Chinese and Turkish
     * posts of their war were judged not coinable, so none was ever grouped.
     *
     *   join     such a post in no narrative joins the open narrative whose countries hold the pair
     *            and whose newest post is inside `activeMs` (the titler's answer, the owner's, or a
     *            seed still waiting for the titler); at most `perPass` posts a pass
     *   seed     a pair with no such narrative and `seedMinPosts` such posts from `seedMinAccounts`
     *            accounts inside `seedWithinMs` becomes a NEW narrative, kept off the board (not
     *            shown) and asked of the titler, `pendingPerPass` a pass: shown only when its answer
     *            names both countries. A count alone cannot tell a war from the news — on 18 Oct
     *            Japanese posts named France 40 times at 40k views or more, about the riots
     *   names    per language, the countries it names and their words: a word ending in `*` matches
     *            any ending ("japonais*"), any other word only whole; in a script written without
     *            spaces (Chinese, Japanese, Korean) a word matches anywhere. Matched lower-cased in
     *            the post's own language (Turkish "ÇİN" is "çin")
     *   aliases  the titler's other spellings of a country, read as ours ("Türkiye" is Turkey)
     *   maxRead  the most stored posts read a pass, highest views first
     *
     * ★ THE CATCH-UP (policy.v166, the owner 2026-10-24: "it's not catching any of the viral posts
     * under the narrative that have hundreds of thousands and even 1M+ views"). Every `catchUpEveryMs`
     * the live wars' own words are searched in the stored posts back to each war's start, in or out of
     * a narrative, so a post the two-day read above never saw still joins:
     *
     *   warLeadMs   a post joins a war from this long before the war's oldest own post (not one
     *               matched back in), never further: the 7.8M Chinese post of 21 Oct joins China vs
     *               Turkey, and the 17-19 Oct riots (50 Japanese posts naming France at 40k+, the last
     *               on 19 Oct 12:18) stay out of France vs Japan, whose own posts start 23 Oct 09:44.
     *               A post older than the war's own posts joins as an early post, so it never moves
     *               the start and the window cannot creep back day by day
     *   names.en    a language with no home country (English): a post naming two of a war's countries
     *               joins only when it is also as alike to one of the war's posts as two posts with
     *               the same name must be (`narrative.nameMeaning`). Measured 23-24 Oct at 40k+: the
     *               posts about the French–Japanese beef sit 0.61-0.76 from the war, the news naming
     *               both (a PHP bug, the riots, a K-pop tour) 0.29-0.49
     *   answersOn    ★ A QUOTE OF THE WAR IN THE OTHER SIDE'S LANGUAGE (policy.v169, the owner
     *               2026-10-24: France vs Japan had 24 French posts and no Japanese one). A stored post
     *               at `minReach` views that quotes or links a post of a live war (titled by the titler
     *               or the owner, not a waiting seed), in the language of one of its countries other
     *               than the quoted post's, joins it though it names no country: the Japanese answer to
     *               the 14.9M "végéta est algérien" post (4.9M views). Same window and guards as the
     *               words; read on the catch-up's cadence. A quote in the same language, or in English,
     *               does not join by this
     *   moveMaxPosts  a war post in another narrative: a narrative all of whose posts are that war's
     *               (one of its own included) is merged into the war; one of at most this many posts
     *               with other posts too gives up only that post. Never a narrative the owner made a
     *               call on, renamed or answered, nor another war
     *
     * ★ THIS WEEK'S WARS (policy.v175, the owner 2026-10-25: Saudi Arabia vs Argentina, Brazil vs
     * Egypt, Vietnam vs South Korea, and France vs Japan's Japanese side):
     *
     *   home           a language's country, or SEVERAL (Arabic: Saudi Arabia and Egypt). A post in a
     *                  language of several homes pairs each home with each other country it names,
     *                  and joins only a live war holding both countries of one of those pairs; it
     *                  seeds only a pair of `named`. A plain string is one home, as before
     *   minReachByLang a language's own views bar, in place of `minReach` for its posts' joins (the
     *                  word, phrase and quote rules alike). Seeds keep `minReach`: a lower bar would
     *                  seed every Japanese news story naming a neighbour
     *   phrases        per war (its two countries sorted, 'France|Japan'), per language, phrases
     *                  whose words must ALL be in a post (each matched as a `names` word is). A post
     *                  in that language holding one is that war's post though it names no country,
     *                  only while the war is live and named (never a waiting seed), at the same bar
     *                  and window. It never seeds
     *   named          the wars the owner named (two countries each). Searched by `feed.fightWords`
     *                  before any narrative holds them, so their posts are stored and can seed; a
     *                  seed of one is shown at once as the owner's answer, not asked of the titler
     */
    readonly native: {
      readonly on: boolean;
      readonly minReach: number;
      readonly lookbackMs: number;
      readonly maxRead: number;
      readonly perPass: number;
      readonly catchUpEveryMs: number;
      readonly warLeadMs: number;
      readonly moveMaxPosts: number;
      readonly answersOn: boolean;
      readonly seedMinPosts: number;
      readonly seedMinAccounts: number;
      readonly seedWithinMs: number;
      readonly seedMaxPosts: number;
      readonly pendingPerPass: number;
      readonly home: Readonly<Record<string, string | readonly string[]>>;
      readonly minReachByLang: Readonly<Record<string, number>>;
      readonly names: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
      readonly phrases: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
      readonly named: readonly (readonly [string, string])[];
      readonly aliases: Readonly<Record<string, string>>;
    };
  };
}

/**
 * ★ TRENDING NARRATIVES (the owner, 2026-10-17): how fast a story is picking up right now, not how
 * big it is — a huge old story that is slowing down falls below a smaller one taking off. ORDER
 * ONLY: the number is never shown or sent; the cards show the facts it is made of (views gained,
 * new posts, age). Core group/narrative-trend.ts, inside each window W of `windows`:
 *
 *   views      `reachWeight` per tenfold of the views gained in W (per post from its own readings,
 *              the chart's rule)
 *   speed-up   `speedUpWeight` per doubling of the gain in W over the gain in the W before it, at
 *              most `speedUpMaxDoublings` either way; `speedUpEven` views are added to both sides so
 *              a few hundred views are not a tenfold. No reading before W: no term, never a zero
 *   new posts  `postWeight` per doubling of the accounts that posted in W, EACH ACCOUNT ONCE, so one
 *              account posting the same thing ten times is one new post
 *   breadth    `breadthWeight` times the share of W's new posts that came from different accounts
 *   both sites `bothSourcesBoost` when the story is on two sources or more
 *   coin       only a checked or proven coin: `coinCapWeight` per doubling of its market cap over
 *              W (at most `coinCapMaxGrowth` times up), `coinBuyWeight` per doubling of the buys
 *              made through us in W. An unchecked coin never moves the order
 *   viral      `viralWeight` per doubling of the accounts whose post went up in W and is at For You's
 *              views (`rising.fypMinReach`) now, each account once (policy.v157, the owner 2026-10-24:
 *              Trending is the narratives that keep having viral posts)
 *   steady     `steadyWeight` times the share of W's `steadySlots` equal parts that hold such a post:
 *              a viral post every hour of six beats six in one hour
 *   freshness  `ageWeight` off for every `ageMs` of the story's age (since we found its first
 *              post), at most `ageMaxUnits` of them, aging at `keepAgeing` the rate while it gains
 *              faster than the W before. Taken off the sum, never multiplied into it: a story still
 *              gaining a million an hour two days in is trending, and a factor would bury it
 *
 * A story no post of which was read in W is ordered after every one that was, newest found first:
 * an outage is not a slow story.
 */
export interface NarrativeTrendPolicy {
  readonly windows: readonly { readonly ms: number; readonly ageMs: number }[];
  readonly reachWeight: number;
  readonly speedUpWeight: number;
  readonly speedUpMaxDoublings: number;
  readonly speedUpEven: number;
  readonly postWeight: number;
  readonly breadthWeight: number;
  readonly bothSourcesBoost: number;
  readonly coinCapWeight: number;
  readonly coinCapMaxGrowth: number;
  readonly coinBuyWeight: number;
  readonly ageWeight: number;
  readonly ageMaxUnits: number;
  readonly keepAgeing: number;
  readonly viralWeight: number;
  readonly steadyWeight: number;
  readonly steadySlots: number;
  /**
   * ★ THE TAB'S TRENDING LISTS THE STORIES THAT KEEP HAVING VIRAL POSTS (policy.v166, the owner
   * 2026-10-24: "I want there to be a way we can know which narratives are having consistent viral
   * posts — shouldn't that be the purpose of Trending"). The weights above order the board; the tab's
   * Trending (services/read narrative-sorts.ts, core rank/narrative-sorts.ts) is speed risers, and on
   * 24 Oct 2 of 71 live narratives had speeds at all. So after the risers it now lists every fresh
   * narrative with posts from at least `listMinAccounts` accounts that went up in its last
   * `listWindowHours` window and are at For You's views now (the page's `inWindow` viralAccounts),
   * most accounts first. ★ The online meme wars (`countries`) are one entry there, their posts and
   * accounts added up, so the app's one meme-war card stands where they all rank together.
   */
  readonly listMinAccounts: number;
  readonly listWindowHours: number;
}

/**
 * ★ THE WAYS TO FIND A POST BESIDES THE SEARCHES (the owner, 2026-10-15): "find viral posts BEFORE
 * they are coined". Each has its own switch, all off until the owner approves the day's cost, and
 * every post any of them finds still goes through the judge and the hold before For You — a coin
 * naming a post does not make it a meme. Their lanes are 0083's: coin_link, x_repost, trend, creator.
 *
 * Measured 2026-10-15 over the 48 hours before 17:00 UTC: 16,000 launches a day, 80 a day naming a
 * short video and 5,475 a day naming a text post (most already held: the origin check reads the
 * creator's link); of the text source's held posts with a shortened link, about 2% lead to a short video.
 */
export interface FindersPolicy {
  /**
   * A new coin's metadata read within seconds of its launch, and every post it names recorded as
   * the coin's (internal.coin_post_link) and read if we do not hold it: free to read the document,
   * one post read by id each. The first coin to name a post is its coin; copycats come after.
   */
  readonly coinLinks: {
    readonly on: boolean;
    /** How often the step looks for coins whose metadata has not been read. */
    readonly everyMs: number;
    /** Only coins first seen this recently: older ones are the universe loop's, a minute at a time. */
    readonly lookbackMs: number;
    readonly perPass: number;
    readonly concurrency: number;
    /** Posts read by id per pass at most; the rest wait for the next pass. */
    readonly readsPerPass: number;
    /** A named post older than this at the launch is recorded and read, but not credited to the feed. */
    readonly creditMaxAgeMs: number;
    /** A text-source post is credited only at this many approvals: most coins name a post nobody saw. */
    readonly textMinApprovals: number;
    /**
     * …or at this many views (policy.v155): a post already past For You's views bar when a coin names
     * it was seen, whatever its approvals. Without it such a post is stored with no lane and can
     * never be a For You candidate.
     */
    readonly textMinReach: number;
    /**
     * ★ THE INSTANT JUDGE (the owner, 2026-10-16: "to For You in 60 s"). Right after each pass, a
     * post a coin named in the last `lookbackMs` that `rising.coinLinked` would put on For You, held
     * by a lane and never answered, is judged at once — the post judge, its kind question and the
     * not-a-meme hold, as the scoring pass would — instead of waiting for the next discovery pass.
     * At most `perMinute` posts a minute. Off: such a post waits for the scoring pass.
     *
     * ★ A VIDEO WHOSE FRAME CANNOT BE READ YET (the owner, 2026-10-18: "retry at most 5 times over 10
     * minutes. Then park them and try again when their video frame is readable. They must not use up
     * the instant path's 6 a minute"). A video post the judge could not look at comes back unanswered
     * and was asked again every pass: 244 times in a day, taking the minute's places from posts it
     * could answer. Now such a post is asked at most `frameTries` times, spread evenly over
     * `frameTriesOverMs`, and a post waiting for its next try takes no place; after the last it is
     * parked until its frame is a different picture (a later read of the post brought a new one),
     * then tried afresh. The scoring pass still asks it as before.
     */
    readonly instant: {
      readonly on: boolean;
      readonly perMinute: number;
      readonly lookbackMs: number;
      readonly frameTries: number;
      readonly frameTriesOverMs: number;
    };
  };
  /**
   * The short videos text posts link to: a shortened link in a text post we hold that is climbing
   * fast is followed once (free), and a short video it leads to is read by id and credited.
   */
  readonly reposts: {
    readonly on: boolean;
    readonly everyMs: number;
    /** Only text posts this young at their last reading. */
    readonly maxAgeMs: number;
    /** Approvals per minute of age at the last reading: what "climbing fast" means here. */
    readonly minApprovalsPerMinute: number;
    /** Shortened links followed per pass, and at once. */
    readonly linksPerPass: number;
    readonly concurrency: number;
    /** Short videos read by id per pass at most. */
    readonly readsPerPass: number;
    /** A linked video older than this is not credited. */
    readonly creditMaxAgeMs: number;
  };
  /**
   * The short-video source's trend data (rising tags, by region, over its shortest period), read every
   * `everyMs`; its top rising words are searched newest first, `wordsPerAsk` an ask, every `askEveryMs`.
   */
  readonly trends: {
    readonly on: boolean;
    readonly everyMs: number;
    /** Region codes asked. The trend data has no every-region list, and tags only (its sound charts are gone). */
    readonly regions: readonly string[];
    /** Tags and sounds kept per region and kind, rising first. */
    readonly perKind: number;
    /**
     * The newest-first asks of the trend and learned tags (the paid half: a run a word, and the
     * judge on what clears the reach bar). Its own switch so the lists can be kept and shown free.
     */
    readonly asksOn: boolean;
    readonly askEveryMs: number;
    readonly wordsPerAsk: number;
  };
  /**
   * The tags, sounds and creators of every post that was coined (a coin named it, or the owner
   * confirmed its coin), counted over `lookbackMs` once every `everyMs`; the top ones join the trend
   * words' searches (tags and sounds) and the creators' asks. Free to count.
   */
  readonly learned: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly lookbackMs: number;
    /** A tag or sound must be on this many coined posts; common words (`skip`) never count. */
    readonly minPosts: number;
    readonly topTags: number;
    readonly topSounds: number;
    readonly topCreators: number;
    readonly skip: readonly string[];
  };
  /** Creators with a coined post before: their newest posts asked for, `perAsk` creators an ask. */
  readonly creators: {
    readonly on: boolean;
    readonly askEveryMs: number;
    readonly perAsk: number;
    readonly postsPerCreator: number;
  };
  /**
   * Young short videos re-read more often: under `maxAgeMin` old, at most `maxPosts` a run, a run at
   * most every `runEveryMinutes` (track's paid re-reads are every `track.paidRunEveryMinutes`).
   */
  readonly young: {
    readonly on: boolean;
    readonly maxAgeMin: number;
    readonly runEveryMinutes: number;
    readonly maxPosts: number;
    /**
     * ★ THE TEXT SOURCE'S BAND AGES, FOR SHORT VIDEOS (the owner's "re-reads at about 6 and 50 minutes
     * old"): with `on`, each run also re-reads every found video that turned one of `ages` minutes
     * since the last run, at most `maxPosts` an age, biggest first, unless it was read in the last
     * `runEveryMinutes`. So each video found by then gets a reading at that age, as a text post gets
     * one from its 6- and 50-minute bands.
     */
    readonly atAges: { readonly on: boolean; readonly ages: readonly number[]; readonly maxPosts: number };
    /**
     * ★ THE LATE CHECK, FOR SHORT VIDEOS (the text source's `feed.fresh.late`): with `on`, each run
     * re-reads the found videos that turned `ageMin` minutes old since the last run with at least
     * `minReach` views at their newest reading, at most `maxPosts`: the slow growers the half-hourly
     * re-reads leave unread for hours.
     */
    readonly late: { readonly on: boolean; readonly ageMin: number; readonly minReach: number; readonly maxPosts: number };
  };
  /**
   * The learned sounds (`learned.topSounds`) asked for their posts, one page a sound, `perAsk` sounds
   * every `askEveryMs`, credited to the 'trend' lane and held to the watch list's age like the learned
   * words. The search takes words, so a sound is asked on its own endpoint (`soundPosts`), which
   * returns a sound's posts in its own order, old ones too.
   */
  readonly sounds: {
    readonly on: boolean;
    readonly askEveryMs: number;
    readonly perAsk: number;
  };
  /**
   * The short-video source's own recommendation feed, read logged out: one page a region every
   * `everyMs`, and the videos on it under `creditMaxAgeMs` old credited to the 'trending' lane
   * (0084). The one finder that asks no word, so it can return a video tagged only #fyp. Paid per
   * page on its own supplier; its lane needs 0084 applied before it is switched on.
   */
  readonly trending: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly regions: readonly string[];
    readonly creditMaxAgeMs: number;
  };
  /**
   * ★ THE LEARNED-TAG LANE (the owner's approval, 2026-10-16). Every `askEveryMs` slot, the next
   * `wordsPerAsk` of the top `topTags` tags the coined-video training set teaches — as the latest
   * re-tune recorded them (internal.short_video_tuning, 0085), so the list changes after every
   * re-tune and with nothing else — searched newest first, each word its own run, and the videos
   * credited to the 'learned_tag' lane (0088) and held to the watch list's age.
   *
   * Its own lane, not 'trend' (`trends.asksOn`, which reads the daily coined-post list with the
   * rising trend tags), so its cost and its lead can be read apart and it can be dropped alone.
   * The owner's own words (`feed.hashtags`) and `learned.skip` are never asked here: the watch
   * lane already asks the first, and the second bring back nothing young. It stops at its own cap
   * (`cap`, `LaneCapPolicy`). Off: nothing here is read.
   */
  readonly learnedTags: {
    readonly on: boolean;
    readonly askEveryMs: number;
    readonly topTags: number;
    readonly wordsPerAsk: number;
    readonly cap: LaneCapPolicy;
  };
}

/**
 * ★ POSTS THAT NEVER MADE FOR YOU, SLIMMED AFTER A WEEK (the owner, 2026-10-18): "Posts that made For
 * You: keep everything forever ... Posts that never made For You: slim them after 7 days to link,
 * text, account, platform, views when found, judge answer and time, and any label I gave. Drop their
 * extra readings and raw search data." The job is store post-slim.ts, run hourly by the projector
 * service (tools/post-slim.ts); migration 0101 is its one door into public.observation.
 *
 * A post is KEPT whole, forever, when it was on For You or Popular (the scroll, the frame or its
 * hourly history), on a narrative or its page, coined (a coin's metadata names it, the origin check
 * matched it, the namer learned from it, the older-coin check or a create pick used it), in the gold
 * or missed lists, or the owner called it, saw it or watched it, or the label job labelled it.
 * Everything else, once `afterMs` old, keeps its item row (link, text, account, platform) without
 * the picture link or the cached newest count, its first reading of each counter, its judge answer
 * and every label, and loses its later readings and its search record (internal.item_found_by;
 * raw.capture by raw_ref, which no writer fills today).
 *
 * GROUP's machine clusters (public.story_member) do not keep a post: eight in ten posts are in one,
 * so counting them would keep almost everything. Picture vectors and fingerprints are kept: the
 * coin origin check looks 30 days back for a picture's first post (universe.pictureLookbackMs).
 *
 * The DELETEs free room inside the tables for new rows; they do not hand disk back (that needs
 * pg_repack or VACUUM FULL), so growth slows, the size does not drop.
 */
export interface SlimPolicy {
  /** Off until the owner says yes; while off the job reports what it would do and writes nothing. */
  readonly on: boolean;
  /** How old (from first_seen_at) a post must be before it is decided. The owner's 7 days. */
  readonly afterMs: number;
  /** Posts decided per batch: one keep check, then the deletes for the slimmed ones. */
  readonly postsPerBatch: number;
  /** Rows one DELETE removes at most; a batch repeats its DELETE until none are left. */
  readonly rowsPerStatement: number;
  /** Batches per run, so one run is minutes at most; the next run carries on from the cursor. */
  readonly batchesPerRun: number;
  /** How long a statement waits for a lock before giving up; the next run retries. */
  readonly lockTimeoutMs: number;
  /** How long one statement may run. */
  readonly statementTimeoutMs: number;
}

/**
 * ★ COIN PICTURE VECTORS, KEPT FOR THE WINDOW THAT READS THEM (the owner, 2026-10-18: "Keep the last
 * 30 days in the database … Archive older ones to the bucket the same way as the log, checked before
 * removing. Also stop storing vectors for coins that never got a single trade after 1 hour, if the
 * origin check doesn't need them"). Coin vectors (internal.image_embedding, subject_kind 'asset')
 * were three quarters of that table's growth, about 84 MB a day. Run hourly by the projector service
 * (tools/archive-coin-vectors.ts).
 *
 * Who reads a coin's vector, and for how long: the origin check reads the coin's OWN vector while it
 * checks the coin (picked up for `universe.lookbackMs`, a week, and rechecked once after a day); the
 * coin-match step and the projector's post-match read it for a feed post's name-search coins
 * (launched up to `universe.matchWindowMs` after the post); picture reuse copies any row holding the
 * same content-addressed picture. No reader compares one coin's vector with another coin's to find
 * an earliest coin; the 30-day walk back (`universe.pictureLookbackMs`) is over POST vectors. So 30
 * days is past every coin reader, and the tool refuses a `keepMs` shorter than the origin windows.
 *
 * `untraded`: a coin whose market, read an hour or more after launch, shows no trade — no market at
 * all, or its launch market cap within `flatWithin` — has its vector deleted (not archived: it is
 * re-made from the picture for $0.00036 if ever needed) once nothing can read it: its origin check is
 * settled (not waiting, not due its one recheck, or past `universe.lookbackMs`), it has no origin
 * post, it is on no screen and no feed post's name search found it. A coin we hold no reading for an
 * hour after launch is unknown, not untraded, and is kept. The market reader reads each pictured coin
 * once after its first hour (services/market db.ts) so the hour is known for nearly all of them.
 */
export interface CoinVectorPolicy {
  /** Vectors embedded longer ago than this go to the bucket, checked, then out of the database. */
  readonly keepMs: number;
  /** One archive file at most; a day is several files and a manifest. */
  readonly partBytes: number;
  /** Rows read per query while archiving, and deleted per statement. */
  readonly rowsPerRead: number;
  readonly rowsPerDelete: number;
  /** UTC days archived per run; the next run carries on. */
  readonly daysPerRun: number;
  /** How long a DELETE waits for a lock before giving up; the next run retries. */
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly untraded: {
    /** While off the job reports what it would delete and deletes nothing. */
    readonly on: boolean;
    /** The owner's hour: a reading taken this long after launch decides. */
    readonly afterLaunchMs: number;
    /**
     * A market cap at or after the hour within this fraction of the coin's first reading is "no
     * trade". A curve's price moves only on a trade; the margin is the dollar's drift against the
     * chain's own coin over an hour, which a cap in dollars carries with no trade at all.
     */
    readonly flatWithin: number;
    /** Vectors deleted per run at most. */
    readonly rowsPerRun: number;
    /**
     * Coins launched longer ago than this are not looked at again: by then each was decided by an
     * earlier run (its check settles within `universe.lookbackMs`), and the archive takes the rest.
     */
    readonly decideWithinMs: number;
    /** Pictured coins the market reader reads once after their hour, per pass at most, and how far back it looks. */
    readonly readsPerPass: number;
    readonly readWithinMs: number;
  };
}

/**
 * A shown post's picture, copied into our own storage (services/project post-pics.ts, 0119), so a
 * card's picture keeps loading after the source's signed link has expired. The short-video
 * source's covers carry `x-expires`: on 2026-10-21, 297 of the 311 short-video posts on For
 * You, Popular and the scroll had a cover that no longer loaded.
 *
 * Two sizes, WebP, never enlarged: `cardPx` for every list's square (the largest box is 84 points,
 * three device pixels a point) and `sheetPx` for the post sheet's picture. Measured the same day on
 * 60 shown pictures: 11 KB and 42 KB on average; 15 KB and 64 KB a short-video cover, 15 KB and 70
 * KB a text-source picture, 8 KB and 28 KB a text-source video still.
 */
export interface PostPicturePolicy {
  /** Off: nothing is copied; the app uses the source's link as before. */
  readonly on: boolean;
  /** Pictures fetched per pass at most (one pass every two minutes, in the logo job). */
  readonly perPass: number;
  /** Pictures copied in any 24 hours at most, the backfill included. */
  readonly perDay: number;
  /** Pictures fetched at once. */
  readonly concurrency: number;
  /** No new picture is started after this much of the pass. */
  readonly budgetMs: number;
  /** The largest file fetched; a bigger one is refused and left where it is. */
  readonly maxBytes: number;
  /** The longer side of the list copy and of the sheet copy, in pixels. */
  readonly cardPx: number;
  readonly sheetPx: number;
  /** WebP quality of both copies. */
  readonly quality: number;
  /** A refused picture (a host that failed, a timeout) is tried again after this long, while its link still loads. */
  readonly retryAfterMs: number;
}

/**
 * THE LATE ROUTE ON FOR YOU (policy.v152; the owner, 2026-10-24: "show late posts that still have no
 * coin"; services/project late-no-coin.ts). A post we found after `rising.fypMaxAgeMs` had already
 * passed, that the judge said yes to and that cleared For You's views bar, joins For You while no coin
 * for it is running (`oneCoin.minCapUsd`), up to `maxPostAgeMs` after it went up.
 */
export interface LateNoCoinPolicy {
  readonly on: boolean;
  /** Past this age the route lets the post go, coin or no coin. */
  readonly maxPostAgeMs: number;
  /**
   * True: on this route a yes up to `rising.boostBarMargin` under its confidence bar counts, as the
   * picture boost's does with a coined picture. False: For You's own bar.
   */
  readonly nearBar: boolean;
}

/**
 * THE RUNNING COINS STRIP at the top of For You and the Narratives tab (policy.v148; the owner,
 * 2026-10-23, design A of reports/ticker). Only the coins of posts and narratives we found — the
 * one coin a For You card or a board narrative names — launched on the launchpad, tradable, with a
 * market cap and a 24-hour move from a frame written in the last `freshMs`. Read by services/read
 * running-coins.ts from prices the projector already wrote: no market source is asked.
 */
export interface RunningCoinsPolicy {
  /** The most coins on the strip. */
  readonly maxCoins: number;
  /** A coin's price counts only when the frame that carried it was written this recently. */
  readonly freshMs: number;
  /** One list is kept this long and handed to everyone who asks in that time. */
  readonly keepMs: number;
  /** A coin is on the strip only with at least this many dollars traded in its last hour. */
  readonly minVolume1hUsd: number;
  /**
   * …and a market cap of at least this many dollars (the owner, 2026-10-26: "tape is now showing low
   * mc coins"). The tape is the coins that are running; a $3k copy with a busy hour is not one.
   */
  readonly minCapUsd: number;
  /** A coin of a viral post is on the strip only with at least this many dollars traded over the last day. */
  readonly minVolume24hUsd: number;
  /**
   * …and at least this many trades (buys plus sells) in that hour, so a few large fills from one
   * wallet cannot put a coin on the strip by volume alone. The market source counts transactions,
   * not wallets: a wallet that splits its money into many trades still passes this, and only the
   * dollar floor stands against it.
   */
  readonly minTrades1h: number;
}

/**
 * THE COIN THAT RUNS, AND ITS POST (policy.v155, after the $BITCHES miss of 23 Oct): three layers
 * that tie a running coin back to the post it came from when the one-coin pick missed it.
 *
 *   stated   a coin carrying the post's whole stated name and ticker (core match/stated-name.ts)
 *            ties the post up to `withinMs` after it and, once it clears the bars, puts out of the
 *            pick every look-alike trading no more than it (core match/one-coin.ts `behindStated`) —
 *            never over the owner's coin call.
 *   running  a post whose picked coin is trading now (the running coins strip's own test, on the
 *            newest market reading's last hour, or a cap of `minCapUsd`) is on For You whatever its
 *            views (services/project running-picks.ts); and the market reader reads the picked and
 *            stated coins of the last `pickWithinMs` every pass, at most `marketReadsPerPass`, so a
 *            picked coin is never left unread.
 *   missed   every `everyMs`, a coin launched in the last `seenWithinMs` whose cap read `minCapUsd`
 *            or more on `minReadings` readings with a pool, that no post or narrative of ours holds,
 *            is looked for in the stored posts of the `postLookbackMs` before it launched; the origin
 *            (`originShareOfTop`) gets it as its pick (evidence
 *            `missed_runner`), and the owner is told either way, on his alerts list (kind
 *            'outage', what 'missed-runner'; services/runner work/missed-runners.ts). No migration:
 *            the pick, its candidate and the alert are the record.
 */
export interface RunnerLinkPolicy {
  readonly stated: {
    readonly on: boolean;
    readonly withinMs: number;
    /** A coin name's last words that carry no name of their own, dropped before comparing ("You Missed Coin" states "You Missed"). */
    readonly genericWords: readonly string[];
  };
  readonly running: {
    readonly on: boolean;
    /** A picked coin at this cap or more counts as running whatever its last hour. */
    readonly minCapUsd: number;
    /** The newest reading counts only this recently. */
    readonly readingWithinMs: number;
    /** Picks updated this recently are the market reader's and For You's to look at. */
    readonly pickWithinMs: number;
    readonly marketReadsPerPass: number;
  };
  readonly missed: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly seenWithinMs: number;
    readonly minCapUsd: number;
    /** …on at least this many readings with a pool: one reading is one quote. */
    readonly minReadings: number;
    readonly postLookbackMs: number;
    /** The origin: of the posts tied by a name, the earliest with at least this share of the biggest one's reach (core missed-runner.ts). */
    readonly originShareOfTop: number;
    /** Coins looked at a pass, biggest first. */
    readonly perPass: number;
    /** Queue the owner's alert for each new missed runner. */
    readonly alert: boolean;
  };
  /**
   * ★ THE RUNNER HAND-OVER (policy.v160, the owner, 2026-10-24: a later coin that runs on a post we
   * already hold must not be stuck behind the first coin as a "copycat" — "I want to be notified and
   * catch the runner early", pushed to everyone). Every `everyMs`, each post whose pick is held (picked,
   * updated within `running.pickWithinMs`) is looked at with the coins tied to it by a link (one hop
   * through a promotion included, 0132) or its whole stated name that launched AFTER the held coin. One
   * of them takes the pick (evidence `runner_handover`) when, on fresh readings
   * (Policy.market.readingFreshnessMs), BOTH hold:
   *   - it is running at the saved-post push's bars (Policy.notify.savedPost: dollars AND trades in the
   *     last hour) and trades at the pick's own cap bar (Policy.oneCoin.minCapUsd);
   *   - its last hour's dollars are at least Policy.oneCoin.handOverRatio times the held coin's.
   * Never over the owner's coin call. A coin it handed the pick to is never re-judged by the one-coin
   * rule; only this rule moves it again, and the coin it was taken from may take it back only by
   * this same test against the new one (core match/runner-handover.ts). No number of its own: every
   * bar is one the owner already set.
   *
   *   push   the post's coin push to everyone (services/notify launch.ts), once per post, under the
   *          launch push's own rules and daily cap. Off: the pick moves and nobody is told.
   */
  readonly handover: {
    readonly on: boolean;
    readonly everyMs: number;
    readonly push: boolean;
  };
}

/**
 * The database host's disk and bill, as the owner's alerts model them (services/runner
 * disk-alarm.ts). Neither the provisioned disk nor the bill is readable from SQL, so both are
 * modelled from the database's hourly size (internal.disk_sample, 0105) and the host's published
 * rule and prices. Every price here is the host's, in dollars; a price that changes upstream is
 * changed here, or the projection is a projection of an old price list.
 */
export interface StorePolicy {
  readonly disk: {
    /** Off: no sample is taken and nothing is said. */
    readonly on: boolean;
    /** How often the size is sampled and the alerts checked. One row an hour whatever this is. */
    readonly everyMs: number;
    /** The provisioned disk at the first sample, in GB of 1024³ bytes; the replay grows it from here. */
    readonly provisionedGb: number;
    /** The host grows the disk when usage reaches this share of it… */
    readonly growAt: number;
    /** …to this multiple of its size… */
    readonly growBy: number;
    /** …at most once in this long… */
    readonly growGapMs: number;
    /** …and at most this many times in 24 hours. */
    readonly growsPerDay: number;
    /** The owner is told when usage passes this share of the provisioned disk, once a crossing. */
    readonly alertAt: number;
    /** A crossing is over once usage falls back under this share; the next pass of `alertAt` is a new one. */
    readonly rearmBelow: number;
    /** A crossing or a grow older than this is not pushed: a deploy never pushes history. */
    readonly announceWithinMs: number;
    /** Growth per day is read over this many days of samples (the 20:00 table, the bill's projection). */
    readonly growthDays: number;
  };
  readonly bill: {
    readonly on: boolean;
    /** The plan, a month. */
    readonly planUsd: number;
    /**
     * The compute size's monthly price less the plan's compute credit. NOT READ FROM THE HOST: the
     * owner must confirm it; `computeConfirmed` false says so in every alert and in the 20:00 table.
     */
    readonly computeNetUsd: number;
    readonly computeConfirmed: boolean;
    /** Provisioned disk the plan includes, in GB; each GB-month over it is billed at `diskUsdPerGbMonth`. */
    readonly diskIncludedGb: number;
    readonly diskUsdPerGbMonth: number;
    /** File storage the plan includes, in GB; each GB-month over it at `storageUsdPerGbMonth`. */
    readonly storageIncludedGb: number;
    readonly storageUsdPerGbMonth: number;
    /** The owner is told once a month when the month's projected bill first passes this. */
    readonly alertOverUsd: number;
  };
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
  readonly attention: AttentionPolicy;
  readonly backfill: BackfillPolicy;
  readonly origin: OriginPolicy;
  readonly universe: UniversePolicy;
  readonly postCoin: PostCoinPolicy;
  /** One post, one coin: the coin chosen by who is buying it, or none (core match/one-coin.ts). */
  readonly oneCoin: OneCoinPolicy;
  readonly search: SearchPolicy;
  readonly trade: TradePolicy;
  readonly wallet: WalletPolicy;
  readonly social: SocialPolicy;
  readonly owner: OwnerPolicy;
  /** Invite-only access: members' codes, partner codes and the waitlist. */
  readonly invites: InvitePolicy;
  readonly learning: LearningPolicy;
  readonly notify: NotifyPolicy;
  readonly rank: RankPolicy;
  readonly features: FeaturesPolicy;
  readonly explore: ExplorePolicy;
  readonly budget: BudgetPolicy;
  readonly names: NamesPolicy;
  /** The feed's translations of posts not written in English. */
  readonly translate: TranslatePolicy;
  /** Posts that passed the judge, grouped by what they are about: the Narratives tab and the story coins. */
  readonly narrative: NarrativePolicy;
  /** The ways to find a post besides the searches: coins' links, reposts, trends, coined creators. */
  readonly finders: FindersPolicy;
  /**
   * The other half of the loop. Every stage above decides; this block is what says
   * whether the decision was right, and under which definition of right.
   */
  readonly labels: LabelPolicy;
  /** Posts that never made For You, slimmed after a week. */
  readonly slim: SlimPolicy;
  /** Coin picture vectors: 30 days in the database, the rest in the bucket; an untraded coin's deleted. */
  readonly coinVectors: CoinVectorPolicy;
  /** Shown posts' pictures copied into our storage, so a card never goes blank when the source's link expires. */
  readonly postPictures: PostPicturePolicy;
  /** The database host's disk and bill: the owner's alerts when the disk fills or the bill heads over his line. */
  readonly store: StorePolicy;
  /** The running coins strip on For You and the Narratives tab (services/read running-coins.ts). */
  readonly runningCoins: RunningCoinsPolicy;
  /** Posts found late with no running coin yet, on For You (services/project late-no-coin.ts). */
  readonly lateNoCoin: LateNoCoinPolicy;
  /** A running coin tied back to its post: the stated name, the running pick, the missed-runner net (policy.v155). */
  readonly runnerLink: RunnerLinkPolicy;
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

     v36 adds `universe.history.minLiquidityUsd` and `minHolders`: the pilot's fake-coin filter.

     v165 adds `oneCoin.early` (the early pick under $20K, pushed to everyone from 2026-10-24: the
     owner's "ship it for everyone, let them decide whether they want to buy") and `market.firstHour`
     (the first hour of a tied candidate read every pass, and a light pass).

     v166 adds the meme wars' catch-up (`narrative.fight.native` catchUpEveryMs, warLeadMs,
     moveMaxPosts, names.en), the loose-post join on rare words (`narrative.origin` looseWordsOn,
     looseWordsMeaning, wordStems) and Trending's viral list (`narrative.trend` listMinAccounts,
     listWindowHours).

     v167 adds `rising.promotion` (a promotion post — a small post pointing at someone else's bigger
     one — is never on For You or Popular; its coin goes to the original).

     v168 adds `rising.scrollKeepMs` (For You's scroll reaches back 72 hours).

     v169 adds Japanese words for France (`narrative.fight.native.names.ja`: フランス人, 仏人, 仏蘭西)
     and the meme-war word search's per-language bar (`feed.fightWords.byLang`, Japanese at 100),
     and the quote of a war post in the other side's language (`narrative.fight.native.answersOn`).

     v170 adds `group.image.postSpace`, the post vectors' space, read by every post-vector lookup
     instead of each one's own copy of the name. No value changes: the switch to the self-hosted
     model is a later version that changes `space`, `postSpace` and the bars together.

     v171 adds `group.image.backfill`, on: the runner re-embeds what is stored into our own
     model's space at each boot, ahead of the switch. No value read by a decision changes.

     v172 switches pictures and posts to our own model (`group.image.space` siglip2-b16-224.768,
     `postSpace` its .post) and moves every similarity bar to the new scale, each keeping the share
     of same-story pairs above it that the old bar kept (the copy test, 2026-10-24: 25 narratives,
     215 posts, 180 pictures); `narrative.origin.nameAverage` moves with `nameMeaning`, which it is
     always read beside. The vectors read under the old space stay stored; v171 back is a
     rollback.

     v173 re-sets the post bars by the other half of the test v172 skipped: how many UNRELATED pairs
     clear each bar. On 2,000 judged posts with both models' vectors (2.0 million pairs, 25 Oct), two
     random posts read 0.75 alike in our model's post space against 0.27 in the old one, so v172's bars
     let 50 to 100 times more unrelated pairs through (3% at sameMeaning's 0.84, against 0.025% at the
     old 0.7): narratives swallowed unrelated posts ("Thesis Cat" took in BTC calls) and few new ones
     formed. Now each strict bar lets twice the old model's share of unrelated pairs through (0.926
     meaning, 0.919 sameMeaning, 0.899 the shared-name tier), keeping more same-story pairs than the
     exact share would; the held-as-not-a-meme bar (0.924) and the loose join bars (0.84 link, 0.82
     loose words, 0.767 root) let exactly the old share through. Pictures read close to the old
     model's; only the borderline band (and postCoin's floor with it) was 12 times looser, back to the
     old share at 0.85.

     v174 moves `judge.precedents.holdNotSimilarity` 0.924 → 0.945, set by how many posts it HOLDS,
     the thing it does. Of the 1,871 posts judged yes from 24 Oct 09:00 to 25 Oct 03:20 (vectors in
     both spaces), the old model's 0.67 held 35; ours holds 1,262 at v172's 0.83, about 100 at 0.924
     (0.92: 135, 0.93: 82) and about as many as before at 0.945 (0.94: 51, 0.95: 19). For You took 4
     posts after 06:44 on 25 Oct. In our space the nearest "not" label hardly tells a meme from a
     non-meme (0.95 holds 6% of the meme labels and 7% of the not labels), so it holds no more than
     the old bar did.

     v175 adds this week's meme wars (the owner, 2026-10-25): a language may be home to several
     countries (`narrative.fight.native.home`, Arabic to Saudi Arabia and Egypt; Spanish, Portuguese
     and Vietnamese added), a language's own views bar for joins (`minReachByLang`, Japanese at 5k),
     war phrases (`phrases`, France vs Japan's Japanese アルジェリア人, ベジータ アルジェリア, 日仏,
     フランス人 日本人) and the wars he named (`named`: Saudi Arabia vs Argentina, Brazil vs Egypt,
     Vietnam vs South Korea), shown as his answer once seeded. The word search asks the phrases and
     the named wars (`feed.fightWords` phrasesPerSide, byLang ar/es/pt/vi) and its day's cap moves
     $0.10 → $0.25. Estimated with the search's own numbers: 12 more asks a pass (8 words, 4
     phrases), 576 a day at the one-post minimum ($0.00015), ~$0.086; 50 to 100 more posts a day
     returned ~3 times, ~$0.02-0.045, and judged once ($0.00046, 90% judged), ~$0.02-0.04 — about
     $0.13-0.18 a day, $4-5.50 a month. The joins and seeds read stored posts: free.

     v176 adds `translate.narrativesWindowMs` (seven days): the posts of shown narratives are
     translated like feed posts, so a narrative's page lists them in English as For You does.

     v177 is v175 and v176 together: the meme-war languages were built beside the translations
     and joined after v176 went live. No value differs from the two.

     v178 learns from the owner's pasted war posts of 25 Oct: France vs Japan's Japanese side also says
     悪口合戦 ("insult battle") and レスバ (an online slanging match) without naming France (113k
     views, 日本人とニガーの間の悪口合戦), so both are its phrases (`phrasesPerSide` ja 4 → 6, two more
     asks a pass); Turkish is asked at 150 likes, not 300 (`feed.fightWords.byLang.tr`: his China vs
     Turkey examples were 55k-180k views at 207-2,259 likes). About 2 more asks and ~10 more posts a
     pass at the day's own numbers, ~$0.02 a day, inside the search's $0.25 cap.

     v179 asks all five of Spanish's words for Saudi Arabia, not the first two (`byLang.es`
     wordsPerSide 2 → 5): the owner's Saudi Arabia vs Argentina examples from the Argentine side say
     árabe, which was never asked. Replies were never left out of these searches (the X adapter has
     not sent -filter:replies since 2026-10-13), so the replies among them come back once the word
     is asked. Three more asks a pass, ~$0.02 a day, inside the cap.

     v180 names the next post space and fills it, deciding nothing on it yet (the owner approved our
     own model on 25 Oct; the benchmark of that day found its words half weak: on model-free ground
     truth it kept 26% of same-story pairs at 0.5% hard negatives, the hosted model 64%, and
     multilingual-e5-base beside our picture vector 62%). `group.image.postSpaceNext` is
     'me5-base+siglip2-b16-224.1536.post' — e5's words and our picture side by side, 1,536 wide, so two
     pictured posts read 0.7 × words + 0.3 × picture — and the runner's boot fill embeds the stored
     posts, labels and name examples into it (posts are kept three days, so that is the window filled).
     `postSpaceNextBars` are its bars, by v173's rule on the same 2,000 judged posts (2.0 million
     unrelated pairs) and 3,367 same-story members (934 stories, 11,278 pairs): strict bars let twice
     the hosted model's share of unrelated pairs through, the loose join bars exactly its share; the
     hold by v174's rule, how many of the 1,875 posts judged yes from 24 Oct 09:00 to 25 Oct 03:20 it
     holds (the hosted 0.67 held 35, today's 0.945 holds 36; the new 0.891 holds 34). Unrelated pairs
     read 0.70 alike in the new space (0.75 now, 0.27 hosted). Kept = same-story pairs over the bar:

       bar                               hosted   now (kept)      next   unrelated over  kept
       narrative.same.meaning             0.8     0.926 (11.1%)   0.877   0.027%         19.3%
       sameMeaning, mergeMeaning,         0.7     0.919 (12.6%)   0.866   0.047%         22.3%
         storyCoin.alone
       nameMeaning, origin.mergeMeaning,  0.6     0.899 (18.2%)   0.844   0.205%         29.6%
         nameAverage, phraseMeaning, wordsMeaning, varietySameMeaning, storyCoin.together
       storyCoin.near, linkMeaning        0.45    0.84  (51.5%)   0.787   3.24%          53.9%
       looseWordsMeaning                  0.41    0.82  (65.6%)   0.76    7.28%          65.6%
       rootMeaning                        0.3     0.767 (91.1%)   0.709   36.8%          88.7%
       holdNotSimilarity                  0.67    0.945 (36 held) 0.891   34 held of 1,875

     The strict tiers keep more same-story pairs than today's at the same unrelated share (the hosted
     model kept 11.6%, 19.2% and 30.7%). In the new space the nearest "not" label still hardly tells a
     meme from a non-meme (0.891 holds 8.8% of the meme labels and 12.9% of the not labels), as in
     today's. Pictures' bars do not change: the picture space does not. The switch is a later
     version: `postSpace` to the next space, these bars over the ones they name, both fields back to
     null.

     v182 switches posts to our second space (`group.image.postSpace` me5-base+siglip2-b16-224.1536.post:
     multilingual-e5-base words at full precision beside the SigLIP picture) once its boot fill had
     written every kept post, label and name example into it, and copies v180's `postSpaceNextBars`
     over the bars they name (each by v173's rule: the strict tiers at twice Voyage's unrelated share,
     the held-as-not-a-meme and loose bars at its share), clearing both next-space fields. Pictures,
     their space and their bars are unchanged. v181 back is the rollback: its vectors stay stored.

     v183 turns v181's age-scaled slow-lane floors off (`feed.slow.ageScaledFloor` false): the lane
     went from ~2,670 stored posts a day to ~6,900, mostly judged no, and their re-reads ate the X
     re-read day ($5) by mid-morning, so judged-yes posts went unread. The rest of v181 stays: gapless
     slice windows, the language that waited longest asked first and the floor raised when cut short,
     band_50 paced over the day. Back to v182 is the rollback.

     v183 also orders TRACK's re-reads (`track.rereadOrder`): found yeses not on For You first, then
     posts on a feed and found posts waiting on an answer, then accounts of 100k followers or more,
     then the rest, which may take only 0.8 of the paced re-read day. And TRACK's gate reads the post
     question's own answer, the kind hold and the owner's call apart, as the projector does: a held
     yes stays unread as before; an owner's "meme" is now read, an owner's "not" is not.

     v184 adds `judge.precedents.holdNotSimilarityNoWords` (0.945): a post with no words — a link, emoji
     or tags only — is held as NOT_MEME_MATCH only when its picture is near-identical to the labelled
     one, not at 0.891. Two @twaniimals animal posts (311k, 436k views, judged yes) were held on 26 Oct
     at 0.891 and 0.924 for looking like another labelled animal photo. Posts with words are unchanged.

     v185 is the never-stored viral posts of 25-26 Oct: a pace is checked before a search's ask and
     not between its pages (`feed.paging.paceBeforeAskOnly`), so a paced day no longer drops the
     unread older part of a language's window nor raises its floor for it; the late band asks each
     language every ten minutes (`fresh.late.everyMs`) instead of every pass, is paced over the UTC
     day (`paging.searches.late_300.paced`) and adds Arabic and Korean (`fresh.late.langs`); and
     Arabic joins the newest bands at Korean's share (`feed.langs`, `langSplit.shares`). No day, cap
     or the X search day changes. v184 back is the rollback (v184 is the hold fix, made alongside).

     v186 adds `judge.viral`, the viral exception (the owner, 2026-10-26): a post the judge turned
     down, or held as politics or showbiz, that reached 500k views at 8k a minute within six hours is
     asked the viral-moment question and the kind question, and reaches For You when both say so —
     never a tragedy, an ad, sport, fandom or company news, never over the owner's "Not a meme" or a
     shill. `judge.viral.on` false is the rollback: nothing else reads the new table.

     v187 adds `judge.resurface` (the owner, 2026-10-26, after @elonmusk quoted a 16-day-old video): a
     post an account of 10M+ followers quotes, or posts the same media of, is asked the post question
     again with that share beside it; if it passes, For You counts its age from the share and its card
     says who shared it. The usual bar; every hold still applies. `judge.resurface.on` false is the
     rollback.

     v188 asks it while the post is fresh (the owner, 2026-10-26): `judge.viral.early` asks a turned-down
     post the two questions as soon as a reading in its first 30 minutes averages 10k views a minute, not
     only at 500k; and `track.fastClimb` keeps re-reading such a post, from 5k a minute, for its first two
     hours (15 at once, inside the re-read day), so the bars have readings to fire on. Both `on: false`
     are the rollback, together or apart.

     v189 counts the key crypto accounts' shares (the owner, 2026-10-26: a 4.2M-follower chain account
     reposted @CapinUK's video with Dandy the dog, and we never showed it): `judge.resurface.keyAccountsOn`
     makes the platform adapter's key accounts share whatever their followers, a plain repost is a
     share (0140), and a post such a share brought in joins For You without the views bar once its
     answer passes. False is the rollback.

     v190 is PvP (the owner, 2026-10-26, after $Marvin: the wrong coin led for twenty minutes, then was
     dumped; the real one ran $7k to $657k). `oneCoin.race` keeps, on each post's pick, the coins made
     for it that broke away together ($10k each, 1.5x the next), and the card says "PvP: 2 coins" with
     See 2 coins; the first push names them, the ticket says so above Buy, and a holder whose coin is
     passed by another of them is told once. `oneCoin.crashCapRatio` 2: under 30% of its peak, the held
     coin loses the pick at once to a coin made for the post worth twice it, and that coin is pushed
     like a runner hand-over. `oneCoin.rugKeepAboveUsd` $50k: a held coin worth that is never dropped
     for time under its peak alone. `race.on` false is the PvP rollback; the two bars at Infinity are
     theirs. */
  version: 'policy.v190',

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
    paidReadMaxPosts: 10,
    paidReadMaxSlowPosts: 8,
    paidFastMinReachPerMinute: 250,
    /* Twelve hours: off For You and past this, a post's re-reads stop (see TrackPolicy). */
    offFeedMaxAgeMs: 43_200_000,
    /* Three hours, for the source billed per post (see TrackPolicy). */
    offForYouPerPostMaxAgeMs: 10_800_000,
    /* Six hours: For You's own age limit (rising.fypMaxAgeMs). */
    judgedYesMaxAgeMs: 21_600_000,
    /* From policy.v183. 100k followers: the top tenth of the accounts TRACK re-read on 24–26 Oct
       (median 9k, 90th percentile 404k), whose posts took 18% of the re-reads. 0.8: the rest stop at
       four-fifths of the paced day, leaving about $1 a day of the $5 for the tiers above. */
    rereadOrder: { bigAccountFollowers: 100_000, restShare: 0.8 },
    /* From policy.v188 (see TrackPolicy.fastClimb): 5k a minute in the first 30 minutes, read to two hours, 15 at once. */
    fastClimb: { on: true, minReachPerMinute: 5_000, withinMs: 1_800_000, maxAgeMs: 7_200_000, maxPosts: 15 },
    /* Half as often on For You. */
    onForYouIntervalFactor: 2,

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
    image: {
      space: 'siglip2-b16-224.768',
      postSpace: 'me5-base+siglip2-b16-224.1536.post',
      postSpaceNext: null,
      /* Measured 25 Oct (the v180 entry): not read by any decision until the switch copies them. */
      postSpaceNextBars: null,
      backfill: true,
      nearIdentical: 0.945,
      likely: 0.86,
      borderline: 0.85,
      pairChecksPerDay: 200,
      reuseContentAddressed: true,
    },
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
    /* 1,200 from 2026-10-13: at 800, 14 of 218 batched answers ran past the budget in a matched test
       and were dropped, and live pays to ask those posts again on its next pass. */
    postBatchMaxOutputTokens: 1_200,
    /* NOT_MEME_MATCH (2026-10-13): a post very close to one the owner called "not a meme" (`precedents`). */
    heldKinds: ['AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'NOT_MEME_MATCH'],
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
    precedents: {
      k: 10,
      maxChars: 200,
      /* Measured 2026-10-13 (tools/label-embeddings.ts), leave one out over 418 labelled posts (138
         meme: 41 gold-sheet, 82 coined, 2 missed, 2 meme taps, 11 hand-labelled; 280 not). The meme
         label closest to any "not" label sits at 0.662 (a Goliath roller-coaster post in hand gold;
         the closest coined post 0.602), so 0.67 holds no gold, coined or meme post and 69 of the 280
         "not" labels. 0.80 would hold 20, 0.92 five. A first cut on the owner's labels alone: a live
         post is not one of them, so expect some meme posts near a "not" — measure the holds. */
      holdNotSimilarity: 0.891,
      /* policy.v184: a post with no words is its picture alone; held only at `group.image.nearIdentical`'s
         0.945, a near-copy of the labelled picture, not another animal photo (two @twaniimals posts, 26 Oct). */
      holdNotSimilarityNoWords: 0.945,
      labelsPerPass: 40,
      /* Off until the owner switches it on. On 2026-10-16 the labels held 34 short-video taps (33
         "not") and the coined-video training set's captions; 5 of 10 lets them lead for a short
         video while a text post's ten stay almost all text posts, as now. */
      sameSourceFirst: 0,
      /* 40, the middle of the owner's 30 to 50. Ten posts a call share many neighbours, so a call
         carries a few hundred labelled posts, not 400. The cost is the open model's input price:
         about $0.0003 a post against $0.00012 at ten (measured on the re-tune's test posts).
         20 from 2026-10-17 (v99), to cut cost without changing the answers: the live judge
         (Nemotron, ten posts a call, block v10, held to its 0.70 cutoff) was asked the same posts
         with 20 and with 40, same seed and leakage rules. On the 135 posts the 20 run answered
         (its cap stopped it there; the hash order mixes every set): gold 27 against 25 of 41, missed
         5 and 5 of 7, live non-memes kept 5 against 4 of 37, untapped kept 12 and 12 of 20, fresh
         "not a meme" kept 2 against 3 of 30; 8 of 135 posts changed. Asking 40 twice on the same
         seed changed 17 of 120 gold posts (74 and 75 passed), so every difference is inside the
         judge's own noise. Input fell from about 29,700 to 21,900 tokens a call: $0.00041 a post
         against $0.00054, about $0.95 a day at 7,200 posts. */
      openK: 20,
      /* The pinned providers serve a 131,072-token window (the router's listing, 2026-10-16). The
         estimate counts a picture at 1,600 tokens and text at three characters a token, both high
         for this model, so 80,000 estimated is well inside the window with the answer's room. */
      openMaxInputTokens: 80_000,
    },
    /* The open model is the judge from 2026-10-16 20:15 UTC (the main judge's account ran dry at
       19:28 and the owner is not topping it up). Null from 2026-10-16 23:00 UTC: the owner chose
       the evening re-tune's block 10 at its 0.90 cutoff (hand gold 65% against the old judge's 60%,
       missed 64% against 62%, live non-memes 27% against 19%), so the block's own cutoff rules. */
    primary: 'open',
    openOnly: true,
    /* Measured 2026-10-17 on block 10 (scratch vote/nemo), the same test posts: Nemotron at 0.70
       passes hand gold 76/120, missed 8/15, live non-memes 18/80 and 8 of the owner's 90 fresh "Not
       a meme" calls; Gemma 3 at the block's 0.90 passes 78, 8, 27 and 24. The fallback's 0.90 is
       that block's cutoff, written here rather than left null: the next re-tune grades with the
       primary and stores a cutoff chosen on its answers, which Gemma's must not inherit. */
    cutoffs: { primary: 0.7, fallback: 0.9 },
    /* 90 s: above the open model's slowest tenth of ten-post calls (77 s, 2026-10-15) and far above
       the live judge's (about 8 s), so a slow but working call is not taken for a dead one. Five
       minutes' rest is a few scoring passes; half an hour after a billing refusal, which waits for
       a person, so the empty account is asked twice an hour, enough to see it topped up. */
    /* Off from 2026-10-16 20:15 UTC: its other judge was the main one, now without credit. On
       again when the backup open model on a second host is wired. */
    failover: { on: false, deadlineMs: 135_000, coolDownMs: 300_000, creditCoolDownMs: 1_800_000 },
    /* $1.50 a day: the open model's measured $0.00016 a post for both questions (2026-10-15) over
       the 9,119 posts the live judge answered that day is about $1.46, the post question alone
       less. Four batches waiting at once is forty posts, about two minutes of the open model. */
    shadow: { on: false, dailyUsd: 1.5, maxInFlight: 4 },
    /* Off until the owner has read the held-out table (tools/junk-filter.ts). Measured 2026-10-16 on
       970 labels with a vector (120 hand gold, 28 missed, 103 coined, 15 meme, 704 not), five folds
       by words: l2 0.3 dropped the most "not" posts at zero gold and missed of 0.1, 0.2, 0.3, 0.5, 1,
       3 and 10. The highest held-out protected post scored 0.931 (a link-only coined gold post);
       0.5 in log-odds above it is 0.957, which drops 35 of 704 "not" posts, no gold, missed, coined
       or meme post, and about 4% of the day's judged posts. 0.25 dropped one later missed post on a
       time split (train before 15 Oct 13:00, test after); 0.5 dropped none on either split. */
    junkFilter: { on: false, l2: 0.3, folds: 5, margin: 0.5, minProtected: 30 },
    /* Shadow first (the owner, 2026-10-18): 24 hours of scores and what it would have added, then the
       owner decides. Seven minutes is the owner's "winnable" bar; the launcher test is coinedYes's.
       Measured 2026-10-18 on 43,983 answered posts (2,075 coined late), test the newest 24 h (8,003
       posts, 461 coined): l2 3 by validation; the validation chose 0.75, which on the test adds 1.3
       posts an hour past the reach and age bars, coined caught 19 of 461 with the judge against 17
       alone, 9 of 17 held-out missed posts over it (most found only by the owner). The junk among
       the extras is not yet measurable on the owner's labels: the shadow is that test. */
    coinModel: {
      on: false,
      shadow: true,
      targets: ['coined', 'viral'],
      liveTarget: 'coined',
      viral: { settleMs: 86_400_000 }, // a day: the scorecard's 24-hour views
      threshold: null,
      l2s: [1, 3, 10, 30, 100],
      validationShare: 0.25,
      negativeShare: 0.35,
      lateMs: 420_000, // seven minutes
      deployerWindowMs: 420_000,
      deployerMinPosts: 3,
      maxJunkRise: 0.03,
      maxExtrasPerHour: 6,
      maxPerPass: 400,
      lookbackMs: 21_600_000, // six hours, For You's own age bar
      refitAt: ['00:00'],
      text: { maxQuotedWords: 6, minCapsLetters: 3, shortWords: 8 },
    },
    /* answerTokensPerPost 120 from 150 (v129): sized from 20 measured ten-post calls (see JudgePolicy.open). */
    open: { batchSize: 5, parallel: 4, reask: 1, reaskWithinMs: 60_000, timeoutMs: 35_000, maxAttempts: 2, answerTokensPerPost: 120, primaryBatchSize: 10 },
    /* The owner, 2026-10-16: no main-judge API from now on (its credit ran out at 19:26 UTC that
       evening). Each question copy-tested that night on 30 recent real inputs against the main
       judge's stored answers (the open model's cost for all of it: $0.02):
         names        open: every post answered one a call (see names.openPerCall); the main
                      judge's first ticker in the open model's five for 19 of 29 live posts; on 30
                      posts with real coins and no examples shown, the real coin in its five for
                      15 (the main judge, with examples, 18). About $0.00013 a post.
         translate    open: 30 of 30 answered, the same language for 27, the same meaning for
                      every post both translated.
         kind         open: of 30 posts the main judge held, it held 24; of 30 For You posts the
                      main judge let through, it held 2 (3 unanswered: their first answer stands).
         stories      off: the same verdict for 18 of 29; it said yes to 8 of 14 the main judge
                      said no to, 7 of them at or above the bars. Held to 0.85 it would agree on 24
                      of 29, but QUALIFY has no per-model bar yet. Off: a narrative abstains
                      (Q1_unjudged), as it has since the credit ran out.
         sameSubject  off: it said yes to all 20 pairs the main judge said yes to, and to 10 of
                      the 20 it said no or unsure to (19 of 30 in a sample of nos). Only a yes
                      counts as evidence, so a pair now carries none rather than a loose yes. */
    askWith: { names: 'open', translate: 'open', kind: 'open', stories: 'off', sameSubject: 'off' },
    /* See JudgePolicy.early. On from its copy test of 2026-10-16 (no paid call, nothing written): five
       live passes over the read-only database took 0.2–0.4 s each and asked ten posts each from 34–74
       eligible; a pass a minute replayed over the three days before asked about 3,000 posts a day
       (the cap held on full days), 2,200 of which the reach bar would never have sent to the judge —
       about $0.37 a day of the open judge and $0.35–0.73 of embeddings — and judged 12 of the 27
       coined posts found before their coin and not judged before it, before their coin. The early
       "no" answers also end about 4,800 re-reads a day of those posts (up to about $0.69). */
    early: {
      on: true,
      lanes: ['all', 'slow', 'media'],
      maxAgeMs: 7_200_000, // two hours
      minReach: 2_000,
      minReachPerMinute: 400,
      minApprovals: 50,
      maxPerPass: 10,
      everyMs: 60_000,
      dailyUsd: 1.5,
    },
    /* See JudgePolicy.reproductionBoost. 1M followers, the big-account bar the pushes use
       (notify.bigAccount): 50 originals a day at 1M, ~180 at 100k (~$0.09); 1M keeps it to the
       accounts whose reproduction is itself news. */
    reproductionBoost: {
      on: true,
      minFollowers: 1_000_000,
      windowMs: 1_800_000, // half an hour: a pass that misses one (a restart) still sees it
      maxOriginalAgeMs: 43_200_000, // twelve hours
      maxPerPass: 10,
      dailyUsd: 0.25,
    },
    /* See JudgePolicy.viral. 500k at 8k a minute (the measurement there); OTHER passes as well as the
       two lifted kinds, since a "no" post never met the kind question. The cap is ten times a busy
       day's two questions, so it holds only a runaway. */
    viral: {
      on: true,
      minReach: 500_000,
      minReachPerMinute: 8_000,
      maxAgeMs: 21_600_000, // six hours, For You's own
      liftsKinds: ['POLITICS', 'SHOWBIZ'],
      passKinds: ['POLITICS', 'SHOWBIZ', 'OTHER'],
      minConfidence: 0.7,
      maxPerPass: 10,
      /* Three: on 2026-10-26 the kind question's reply about the Nicki Minaj post ran on inside its
         confidence number twice in two asks and named no kind it could be read by. */
      maxKindAsks: 3,
      dailyUsd: 0.3,
      /* From policy.v188 (see JudgePolicy.viral.early): 10k a minute, on a reading inside the first 30 minutes. */
      early: { on: true, minReachPerMinute: 10_000, withinMs: 1_800_000 },
    },
    /* See JudgePolicy.resurface. 10M, and the usual bar: the measurement there. Two hours of
       shares, so a restart, or an original stored a little after its share (the "hello, world"
       video was stored 19 minutes after the quote), is still seen. The cap is ten times a busy day's. */
    resurface: {
      on: true,
      minFollowers: 10_000_000,
      windowMs: 7_200_000, // two hours
      maxPerPass: 5,
      dailyUsd: 0.1,
      keyAccountsOn: true,
    },
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
    /* Eight minutes from 2026-10-14: the market pass is due five minutes after the last one ENDED,
       and since each pass also asks where a coin would trade it lands every 6 to 6.5 minutes. At
       five, the last minute or so of every gap showed every coin on For You as never read and
       took its Buy away. Eight covers one ordinary gap; a missed pass still shows the dash. */
    readingFreshnessMs: 480_000,
    maxAssetsPerPass: 300,
    /* Thirty minutes from policy.v156 (2026-10-24), each coin on its own clock (market reading.ts
       `reusableRoute`): at fifteen, with one clock for all, 70 of ~110 coins off their curve fell due on
       one pass of 40 asks and showed "can't be traded yet". A coin off its curve rarely loses its
       route, and the Buy sheet asks again before any order. */
    poolRouteReuseMs: 1_800_000, // thirty minutes
    maxPoolProbesPerPass: 40,
    /* policy.v165. On 21-24 Oct a candidate got a median 0 readings in its first 10 minutes and 3%
       any between +10 and +60: the pass's 300 went to the coins on screen, the held picks, the older
       and pictured coins (about 190) and the newest ~2 minutes of launches (about 100), so a coin
       was read once, at +1-2 minutes, if a pass fell then. $baldcat: +3.7, +8.8, then +72 at $52.8K.
       Candidates of For You posts (or their narratives) with such a tie: a median 10 in the hour
       on 21-24 Oct, 45 at the 90th percentile; 100 at 13:40 UTC on 24 Oct, of 261 tied in all. 80
       in the full pass, since each one there is a newest launch left unread on a full pass; 100 in
       the light pass every minute: 4 calls of the free price source and 1 curve read on the chain
       key (about 1,440 credits a day of the free plan's ~33k; the trade feed's 20k and the
       listing's 3k leave room), at most 5 aggregator asks for a coin that left its curve. */
    firstHour: { on: true, withinMs: 3_600_000, perPass: 80, light: { on: true, everyMs: 60_000, perPass: 100, maxProbes: 5 } },
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
    /* On from 2026-10-20, its chain reads on the trade feed's keyed endpoint (never the public one).
       The miss that turned it on: the "Laura" coin (Cg9z…) launched on the curve at 12:04:59 UTC
       paired with a stock token rather than the chain's own, 8 minutes after the post it named; the
       socket never sent it and nothing else listed it. Its curve pool is on the listing (the coin as
       its base), so a pass would have added it about three minutes after launch (the listing's lag).
       Credits: a pass reads at most 5 pages × 20 pools = 100 coins = one chain read, every 30 s:
       2,880 reads a day at 1 credit, against the trade feed's 8–14k of the free 33k; the cap is that
       day with a little room. */
    launchListing: {
      on: true,
      everyMs: 30_000,
      /* 10 (the vendor's last page) from 20 Oct: a pass reads only as far as the previous one plus a
         page, so the depth is paid for only after a held or refused pass. In a 10-minute keyed test
         at 32 launches a minute one pass in 31 needed 7 pages; 5 would have fallen behind there. */
      pagesPerPass: 10,
      maxAgeMs: 1_800_000, // thirty minutes
      timeoutMs: 10_000,
      creditsPerCall: 1,
      dayCapCredits: 3_000,
      /* Measured 20 Oct, 10 minutes keyed against every launch on the chain (32 a minute): 2.5 pages
         a pass every 30 s, about 7,200 a day at that rate. The cap holds it to 6,000 (a pass in six
         held, the next reading further back), which keeps the plan's month at (8.4k + 6k) × 31 ≈
         446k of 500k at the other readers' month-to-date rate. The slack is an hour of the cap. */
      dayCapPages: 6_000,
      paceSlackPages: 250,
    },
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
    /* 'pt' added 2026-10-14: one of the owner's missed posts (a Brazilian video whose coin ran) was in
       Portuguese, and today's search could not have found it even with discovery up. Measured at
       11:40 UTC, Portuguese posts over the floor were 15 to the 56+ English ones at 6 minutes and 7 to
       33 at 50; the bands' floor rises to keep the same posts a pass, so the cost does not move. */
    /* 'qme' added 2026-10-15, the owner's approval: the code the text source gives a post of only a
       picture or video and emoji. The owner's missed @H2RScotland cat (179k likes) was 'qme' and no
       floor could have found it. Measured 16:30 UTC: 'qme' and 'und' posts over the 6-minute band's
       floor were about 1 a minute of posting time against about 7 found a minute in the three
       languages; the floor rises to keep the same posts a pass, so the cost does not move. */
    /* 'ja' from 2026-10-17, the owner's choice: 16 viral Japanese posts were coined in 7 days, judged
       yes, and none held before its coin, because Japanese was never searched. Estimated +$1.75 to
       $3.50 a day; the posts line below was raised so English search is not squeezed. */
    /* 'tr' and 'zh' from 2026-10-23, the owner's "whatever is best that won't cost me more": neither was
       searched, and three of his missed posts were in them (the Chinese-Turkish beef of 19 Oct, 5.0M
       and 8.9M views, and the first Dogzilla post of 21 Oct, all three found only later through a
       coin that named them). tools/lang-shares.ts that day: Turkish 11 coined posts over 500k views
       in 7 days, Chinese 8, more than Portuguese (10), 'qme' (10) or Korean (7). Each is asked on
       the newest-post bands from its own share of `langSplit.bandsDailyUsd`, which did not grow, so
       the bands' bill does not move; the new languages are paid by the other languages' floors. A
       new language starts at the shared floor and climbs 20% an ask to its own, so its first hour
       or two buys more than its share — inside the bands' own day caps (`paging`). */
    /* 'ar' from policy.v185 (the owner's missed @thevibesofme post of 25 Oct, 73k likes and 671k
       views, in Arabic, which no catch-all search asked; the supplier returns it for `lang:ar`).
       Value: 5 of the 1,066 coined X posts of 500k views in the 7 days to 26 Oct that we hold are
       Arabic (0.5%, Korean 8, Indonesian 7), an undercount since only a coin's link brought them in.
       Cost: none on the day; its share (`langSplit.shares`, Korean's) comes out of the same
       `bandsDailyUsd`, and its first ask an hour per band is ~48 one-post minimums a day, $0.007. */
    langs: ['en', 'zxx', 'pt', 'qme', 'ja', 'fr', 'es', 'ko', 'zh', 'tr', 'ar'],
    /* The owner's watch words, chosen 2026-10-14 by what the newest-first search returns for each
       (every run from 17:30 UTC on 2026-10-13, videos a run, median age, under two hours a run):
       cute 25.8, 1.3 h, 23.7; meme 18.8, 1.6 h, 15.3; dog 25.6, 2.0 h, 13.6; pet 22.3, 2.0 h, 12.2;
       memes 8.7, 2.0 h, 4.3; memecoin 22.3, 10.4 h, 3.5; solana 22.3, 8.1 h, 1.5; crypto 26.2, 10.7 h, // vocab-allow: solana  — a watch word the owner chose, not a chain this code knows
       1.2. Dropped, because the search hands back one to nine stale videos for them: fyp 1.4 a run,
       cat 0.6, trend 6.8 (median 6 h), funny 9.5 (4.8 h), viral 6.2 (3.9 h), animals 7.0 (4.8 h).
       Tried the same night and not added, for the same reason: brainrot 2 videos (22 h old),
       relatable 0, skit 2, dankmemes 14 (12 h), comedy 29 and humor 30 (but 7.3 h and 4.7 h old).
       Interleaved so an ask of two words is never two pet words.
       ★ FOUR FROM 2026-10-14, the owner's call to drop crypto, memecoin and solana: from 01:19 to // vocab-allow: solana  — a watch word the owner dropped, not a chain this code knows
       11:20 UTC they brought 1.5, 0.4 and 0.2 videos under two hours old a run (median 12.0, 12.2
       and 11.6 hours old) against dog 21.3 (1.1 h), meme 16.3 (1.5 h), cute 9.9 (1.1 h), pet 9.6
       (2.7 h) and memes 9.1 (1.6 h). Six more words were tried on the learning book that morning and
       none brings fresh videos: puppy 4 videos (median 20 h old), memesdaily 15 (18 h), kitten 30
       (12 h), funnymemes 30 (6.8 h, 2 under two hours), lol 0 and shitpost 0. So nothing new is
       added and the freed asks go to the fresh words, each now searched every 30 minutes instead
       of every hour. Pet is dropped with them: four words keep each ask to one meme word and one
       pet word (five could not, every neighbouring pair goes out together), and cute's videos are
       younger (5.2 under an hour a run against pet's 2.8) at about half the price a run. */
    hashtags: ['meme', 'cute', 'memes', 'dog'],
    /* 20, sorted by most liked over the past day: a live run on 2026-10-13 returned 20 videos, all
       under 24 hours old, the top five at 1.5M to 3M views, for $0.101 once its charges settled
       ($0.071 was read before they had). Asks now alternate newest-first and most-liked. */
    hashtagResults: 20,
    watchWordsPerAsk: 2,
    watchAskEveryMs: 900_000, // fifteen minutes
    /* Off until the owner switches it on. 'news', hourly: two of the owner's missed videos were news
       accounts' animal oddities (@cp24breakingnews's batfish, #news; @nbcchicago's albino porcupine),
       and none of the watch words reaches them. Tried on the learning book 2026-10-15 16:22 UTC, one
       run each: news 30 videos, 29 over 10k views (median 202k), 1 to 9 hours old (median 7.6 h),
       $0.0115; animals 28 videos 7 to 20 hours old, median 359 views; raccoon 14 (4 under two hours,
       median 1.2k views); wildlife 1, breakingnews 4 and weird 7, all over 7 hours old. So only news,
       and hourly, since its answer is the past several hours' most-watched: 24 runs a day, ~$0.28. */
    /* On 2026-10-15, the owner's approval: +$0.28 a day on the short-video search, and about +$0.60 a
       day of judging (an estimate: half of the watch's videos over 10k views are judged, and a run
       an hour is guessed to bring 4 to 8 news videos we do not hold; at worst all 30, $3.20). */
    watchExtra: { on: true, words: ['news'], everyAsks: 4 },
    watchMaxAgeMs: 86_400_000, // a day
    /* On from 2026-10-16, the owner's approval (move the short-video search and re-reads to the second
       vendor, the first scraper as an automatic backup for a week). Re-reads and creator pages only: measured that night
       on 12 credits, the second vendor's newest-first search gave "meme" 8 to 30 videos 3 to 95 hours
       old (none under an hour, all held already) and "dog" 1 to 3 under an hour of 27 to 30, where the
       first scraper's actor gives 15 to 24 under two hours a word — so search stays where it is. A
       video re-read answered live in 3.5 to 4.4 s. Backup until 2026-10-23 00:30 UTC, a week. */
    secondVendor: {
      on: true,
      failAfter: 2,
      retryAfterMs: 1_800_000, // half an hour
      backupUntil: '2026-10-23T00:30:00Z',
      lowCredits: 500,
      balanceEveryMs: 3_600_000, // hourly
    },
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
      /* English only, $0.50 a day, from 2026-10-19 (the owner's re-split: "cut the older slice and late
         band to the minimum that still serves their purpose"). What they are for: posts that cross a
         floor only after their first hour — recall for the coin link and the record of what ran, not
         beating a coin (a viral post's coin comes a median 24 minutes after it). Each slice was asked
         once per language, eight billed pages a slice; in English alone, at the floor $0.50 buys
         (~10,000 likes, replayed on 18-19 Oct), it keeps the English posts that run late. What is lost:
         the other seven languages' posts that cross the newest bands' floors only after an hour and
         were found by this lane (on 18-19 Oct, mostly Japanese and Portuguese viral posts, rarely
         coined), and English ones between the late band's 6,500 and ~10,000 likes at one to four
         hours. A coin that names such a post still brings it in (the coin-link lane). */
      /* English, French and Japanese from 2026-10-23, the owner's "whatever is best that won't cost me
         more", for the missed "Vegeta is Algerian" meme: four French posts and one Japanese (7.5k to
         178k likes, 135k to 14.9M views), each a slow starter — the French ones under their newest
         bands' floors (about 35 to 55 likes at 6 to 10 minutes, about 400 at 50) and the Japanese one
         under Japan's (about 430 and 2,300) when the bands asked, then viral hours later, when only
         this English-only lane and the English-only late band were looking. No floor share would have
         caught them; an older search in their language could have. Paid inside the same X day: the
         two languages add about 2,470 asks a day (the late band each pass, ~850; four slices every
         quarter-hour, 384), each billed at least one post ($0.00015), ~$0.37, and their posts over the
         slow floor (~100 Japanese and a few French a day at 1-6 hours on 21-23 Oct, each returned once
         or twice) ~$0.05; `langSplit.bandsDailyUsd` gives up $0.45 for it. $0.55 here: the $0.05 of
         French and Japanese posts on top of English's $0.50, so the shared slow floor holds where it
         was rather than rising against English's older posts. */
      /* Turkish and Chinese too from 2026-10-23 evening, the owner's "add Turkish and Chinese to older
         search": the Chinese–Turkish X beef and the first Dogzilla post started in those languages, and
         the missed-list replay found slow-starting Turkish and Chinese posts (e.g. a Turkish post at ~4k
         likes, 777k views) that only one newest-band ask could reach. Same arithmetic as French and
         Japanese: ~$0.37 a day of one-post-minimum asks for the two, plus their few posts over the slow
         floor (~$0.03); `langSplit.bandsDailyUsd` gives up $0.40 for it, so the X day does not grow. */
      /* Spanish and Portuguese too from 2026-10-24, the owner's "ship the Spanish fix": the moustache-baby
         meme started in Spanish (22 Oct 17:39) and was found 15 hours late, its coin 28 hours after the
         post. Same arithmetic again: ~$0.37 a day of one-post-minimum asks for the two plus their posts
         over the slow floor; `langSplit.bandsDailyUsd` gives up $0.40, so the X day does not grow. */
      dailyUsd: 0.65,
      langs: ['en', 'fr', 'ja', 'tr', 'zh', 'es', 'pt'],
      /* On from policy.v181 (2026-10-25, "did we catch these?"): one floor for every age put 53% of the
         lane's posts in its six-hour slice — 3.4, 5.8, 9.2 and 21.0 a pass at two, three, four and six
         hours (31 passes, 25 Oct 03:50–12:00 UTC, floor 7,000 to 15,000 likes) — while half of the
         100k-view posts of the last three days were first found over two hours in, most at five hours
         by the late band. Scaled, and with the lane's floor rising to hold its 45 posts a pass (about
         ×1.5, at the slope `langSplit` uses, N(>x) ~ x^−1.5), the slices are expected near 9.7, 9.0,
         9.2 and 11.5 a pass at about 0.5, 0.75, 1.0 and 1.5 times today's floor: the two-hour slice
         from ~7,000 likes to ~3,500. Same money (`dailyUsd`, the `paging` day); what is given up is
         the slowest English and Portuguese posts between today's floor and 1.5 times it at six
         hours, past For You's age limit already. */
      /* Off again from policy.v183 (2026-10-26, the owner): scaled, the slow lane stored ~6,900 posts a day from v181's start (25 Oct 17:20 UTC) to 26 Oct 09:20, against
         ~2,670 a day over the two days before; mostly judged no, and each one re-read on the cadence,
         which spent the re-read day before the yeses were read. One floor for every slice, as before
         v181; the rest of v181 (gapless slices, the waited-longest language, band_50 paced) stays. */
      ageScaledFloor: false,
    },
    /* Off until the owner has seen the cost (FeedPolicy.fresh). Bands at 6, 25 and 50 minutes:
       6 is today's median find age for the posts the main lanes catch; 25 and 50 catch the ones
       that climb later (a live check at 23:46 UTC: 5 and 6 of 20 posts over the floor at 30 and
       45 minutes were posts we did not hold). 0.85 of the main lanes' money pays for the longer
       re-reads. 444 views a minute is the speed bar's own pace (40k by 90 minutes). */
    /* Switched on 2026-10-14 ~01:00 UTC under the owner's overnight rule: the bands, the longer
       re-reads and both cuts together cost the same as before (text reads 43.6k -> ~43.0k a day). */
    /* 2026-10-14: the 25-minute band is gone, its money left with the 6 and 50 bands, whose shared
       floor falls about a fifth to spend the same 37.8 posts a pass. Measured 01:05-11:30 UTC: the
       25 band took about 28% of the bands' posts (3.9 a minute of posting time over its floor, against
       6.1 at 6 and 2.8 at 50) and found 416 new posts, 3 of them reaching For You (0.7%); the 6 band
       found 3,861 (31, 0.8%) and the 50 band 476 (13, 2.7%). Its 3 would clear the 50 band's lower
       floor at 50 minutes. 5 of the 6 band's 30 For You posts and 4 of the 50 band's 10 were found
       within a fifth over the floor, so about as many more young posts are expected under it. */
    fresh: {
      enabled: true,
      bandAgesMin: [6, 50],
      maxWindowMin: 15,
      targetScale: 0.85,
      rereadMaxAgeMs: 5_400_000, // 90 minutes, the speed bar's last chance
      rereadMinReachPerMinute: 444,
      cutStale: true,
      staleAfterMs: 21_600_000, // six hours
      /* Off until the owner switches it on. One band at five hours and 6,500 likes: of the owner's
         missed text posts, @mattvanswol's (10,099 likes at 12 h) was under the 6- and 50-minute
         bands' floors when they asked and under the slow lane's floor that afternoon, and is
         estimated at 6,700 to 7,600 likes at five hours. Measured 2026-10-15 on three 15-minute
         windows: about 21 posts over 6,500 at five hours a quarter-hour, about 2 of them not
         already held. */
      /* On 2026-10-15, the owner's approval: about +$0.07 a day of text search (2,000 posts a day over
         the band, less the five-hour slow slice it replaces) and about +$1.75 a day of judging (some
         200 more posts a day judged, an estimate from three windows). */
      /* Every ten minutes a language, and Arabic and Korean too, from policy.v185: the owner's four
         never-stored viral posts of 25-26 Oct. Asked every pass, the band's one-post minimums were 63% of
         its bill in a quiet hour (25 Oct 07:00-08:00 UTC: 3.9 posts and 9.4 pages an ask), and its $1.30
         day ran out at 20:57 UTC on 25 Oct and is on course for ~14:00 on 26 Oct, so a post five hours
         old in the evening (the Portuguese "gatinho acenando", 194k likes) was looked at by nothing.
         Replayed on its own logs, the same posts at ten-minute asks: ~$0.58 a day in a quiet hour's mix
         (was ~$1.15), ~$1.44 in 25 Oct 16:00-21:00's (was ~$1.80) and ~$1.87 in the election night of
         26 Oct 00:00-09:00 (was ~$2.11). The two languages add ~150 asks a day each, ~$0.05 a day with
         their few posts over 6,500 likes at five hours (Korean: the missed @snimtherock post, 7.8k
         likes, never asked after 50 minutes; Arabic: `feed.langs`). Inside the same `late_300` day. */
      late: {
        on: true,
        bands: [{ ageMin: 300, minApproval: 6_500 }],
        everyMs: 600_000, // ten minutes
        langs: ['en', 'fr', 'ja', 'tr', 'zh', 'es', 'pt', 'ar', 'ko'],
      },
    },
    /* On from 2026-10-16, the owner's approval ("the middle X search for posts 15 min to 3 h old with
       1,500-2,500 likes, ~$5-6/day").
       2,000 likes, from the funnel of coined posts (2026-10-13 to 10-16): of the 201 coined posts that
       reached 293 likes, were coined at least 15 minutes after posting and were never found before
       their coin, the fitted growth curve (tau 173 minutes) puts 100 over 1,500 likes inside 15 to 180
       minutes and at least a pass before their coin, 87 over 2,000 and 79 over 2,500. 2,000 keeps 87
       of the 100 for $1.10 to $1.25 a day less search than 1,500, which the whole day's $50 needs.
       What it costs, measured on the 24 hours of posting to 04:30 UTC on 2026-10-16 (the posts we
       hold in en/zxx/pt/qme, no reposts): 2,454 crossed 2,000 likes between 15 and 180 minutes old;
       each is returned on every quarter-hour pass from its crossing to 180 minutes, 18,300 to 23,000
       returns a day (3,195 posts and 25,600 to 31,200 returns at 1,500). At $0.00015 a post that is
       $2.75 to $3.45 a day of search, about 10 to 12 pages of 20 a pass; the posts we do not hold
       (the ones this is for) add to it. Judging: the posts it finds first, about 250 to 600 a day
       (the 247 a day the slow lane now finds at about three hours, plus the misses), $0.35 to $0.80.
       About $3.10 to $4.25 a day in all, under its own $6 cap whatever the day brings.
       `judgedShare` 0.9: of the 1,850 posts the slow lane found in the 24 hours to 08:30 UTC, 1,645
       were judged; `judgeUsdPerPost` is the live judge's $14.35 over 10,139 answers that day. */
    /* 15 to 60 minutes from 2026-10-19, the owner's re-split ("narrow the middle search's age window to
       ~15-60 min and give the freed money to the newest bands"). Replayed on the stored posts of 18-19
       Oct (8 languages, 2,000 likes, a pass a quarter-hour, each post returned on every pass it is over
       the floor and in the window): 15-180 minutes is ~130,000 returns a day, ~$19.50 at full paging —
       why its $6 cap closed at about 04:00 UTC on 2026-10-19 and the lane was dark for the rest of the
       day — and 15-60 is ~13,700, ~$2.05 (15-45 ~$1.00, 15-90 ~$5.00). After an hour a post is the
       older searches' (slow, late), found too late to beat a coin: coins on viral posts come a median
       24 minutes after the post. */
    /* OFF from 2026-10-20, its money to the account watch (`accountWatch`). Since the bands read to
       the end (2026-10-19), they find first what this window holds: in the 28 hours to 2026-10-20 13:00
       UTC it found 179 posts no lane held — 15 in English, the rest Japanese and Portuguese — 1 coined
       post of 100k views before its coin and 4 that reached For You, for ~$0.45 a day of search (its
       ledger, $0.28 by 12:35 UTC, less the judging of its new posts). One switch to bring back. */
    middle: {
      on: false,
      minAgeMin: 15,
      maxAgeMin: 45, // the owner, 2026-10-19: 15-45, the saving to the newest bands
      minApproval: 2_000,
      everyMs: 900_000, // a quarter-hour
      maxPages: 40,
      /* Three minutes: a normal pass is 10 to 12 pages of about a second or two each, so it binds
         only when the supplier is slow or refusing. */
      passDeadlineMs: 180_000,
      /* `judgeUsdPerPost` 0.00046 from 2026-10-18 (was 0.00145, the earlier judge's price): Nemotron,
         the live judge since 2026-10-17 11:06 UTC, measured as the judge line's whole bill (vendor
         together, endpoint judge-open: the post question, the kind question and re-judges) over the
         posts it answered — $2.13 over 4,614 posts in the 24 hours to 01:15 UTC on 2026-10-18, and
         $0.88 over 2,053 ($0.00043) in the last six of them, when it was the only judge answering.
         The higher of the two, so the cap closes early rather than late. */
      /* $3 from 2026-10-19 (was $6): its search at 15-60 minutes is ~$2.05 a day and the bands, now read
         to the end, find most of its posts first, so its judging is small. */
      cap: { dailyUsd: 3, judgeUsdPerPost: 0.00046, judgedShare: 0.9 },
      /* On from 2026-10-18, the owner's approval: "keep reading while there's more, with your limits:
         40 pages a pass, 3 minutes a pass, and its own $6 a day cap". */
      fullPaging: true,
    },
    /* The owner's rule for the other searches (2026-10-18): each reads on only with its own day set
       at today's spend, and stays on the old rule if reading its extra pages would need more.
       Today, measured over the 24 hours to 01:15 UTC on 2026-10-18: the bands' posts from the
       runner's "catch-all lane floor" lines (4,799 posts, $0.72, split between the two bands by the
       order each pass asks them in, 61:39), the slow slices' the same way (2,109, $0.32), and the
       late band's from internal.spend by that order (about 3,000, $0.45). Every one would need more:
       before the short pages (16 Oct 03:10 to 11:00 UTC) the bands returned 38 posts a pass against
       11.7 now, the slices 62 a slow pass against 24 and the late band about 16 against 7, so reading
       their extra pages costs 2 to 3.3 times today's spend, and a day set at today's would stop them
       by early afternoon. So all four stay on the old rule; the days below are the ones they would
       get, kept so turning one on is one switch. */
    paging: {
      maxEmptyRun: 3, // an empty page is still billed $0.00015; three in a row ends a pass
      /* On from policy.v185 (FeedPolicy.paging): a pace ends no ask between its pages. */
      paceBeforeAskOnly: true,
      searches: {
        /* ★ ALL FOUR READ TO THE END FROM 2026-10-19, the owner's re-split. Measured on the 557 viral
           posts of 18 Oct 09:22 to 19 Oct 05:00 UTC found more than an hour after posting: 94% were over
           the 6-minute band's floor when it asked (the straight line from nothing to their first
           reading, which under-reads early likes for most posts), and 91% over the 50-minute band's.
           The floor did not keep them out; one short page a language did. Read to the end, a band
           costs what is over its floor, which each language's floor now steers (`langSplit`), and the
           day is held by `searchDay`. Each day here is a backstop over its share of that: the bands
           ~$1.80 and ~$1.40 of their $3.20 (English at 49 and 404 likes), slow $0.50 and the late band
           ~$0.35 in English. 15 pages a band: English's ~37 posts a four-minute pass come in pages of
           about 5, so 9 would cut a busy hour short. */
        /* From 2026-10-23 (`slow.langs` adds French and Japanese, paid by the bands): the bands' backstops
           lose the $0.45 `langSplit.bandsDailyUsd` gave up (2.2 → 1.95, 1.8 → 1.6), and the late band's
           and slow lane's gain it (0.5 → 0.8: three languages' ~850 asks a day each at the one-post
           minimum, ~$0.38, and their posts; 0.6 → 0.75). The four still add to the same $5.10. */
        /* And from the same evening (`slow.langs` adds Turkish and Chinese, paid by the bands): the bands
           give up $0.40 more (1.95 → 1.75, 1.6 → 1.4), the late band and slow lane take it (0.8 → 1.05,
           0.75 → 0.9). Still $5.10 together. */
        /* 2026-10-24 (`slow.langs` adds Spanish and Portuguese): the bands give up $0.40 more (1.75 → 1.55,
           1.4 → 1.2), the late band and slow lane take it (1.05 → 1.3, 0.9 → 1.05). Still $5.10 together. */
        /* `paced` from policy.v158 (the owner, 2026-10-24: "spread it"): the same $1.55, spread over the
           whole UTC day instead of spent by mid-afternoon. */
        band_6: { full: true, maxPages: 15, passDeadlineMs: 60_000, dailyUsd: 1.55, paced: true },
        /* `paced` from policy.v181 (2026-10-25): unpaced, the 50-minute band spent its $1.20 by 20:55 UTC on
           23 Oct and 19:22 on 24 Oct, and asked nothing for the rest of each day (its ledger, internal.
           lane_spend); 25 Oct 05:00–12:00 it spent at $1.48 a day. The same $1.20, spread; the language
           floors rise to fit it (a language cut short by a day raises its floor, core `nextFloor`). */
        band_50: { full: true, maxPages: 15, passDeadlineMs: 60_000, dailyUsd: 1.2, paced: true },
        /* `paced` from policy.v185: the same $1.30 spread over the UTC day instead of spent by the evening
           (20:57 UTC on 25 Oct), now that a held-back ask is bought on the next one (`fresh.late.everyMs`)
           and a pace no longer ends an ask between its pages (`paceBeforeAskOnly`). */
        late_300: { full: true, maxPages: 9, passDeadlineMs: 60_000, dailyUsd: 1.3, paced: true },
        slow: { full: true, maxPages: 3, passDeadlineMs: 60_000, dailyUsd: 1.05 },
      },
    },
    /* On from 2026-10-19, the owner's "hard daily total for X search, spread evenly". The search bill
       was $13.81 in the 24 hours to 08:08 UTC on 2026-10-19 ($8.50 of it since midnight): $1.22 to
       $1.69 an hour from 00:00 to 04:00 UTC, against $0.15 to $0.63 an hour on 2026-10-18. $7, the
       owner's figure for the day's search; half an hour ahead, so midnight is not a refusal. */
    /* Counted from 2026-10-19 19:00 UTC, the owner's "running rest of night": the X day restarts then at the normal pace. */
    /* $6.30 for search and re-reads from 2026-10-20: the reply reads' own ~$0.72 a day (attention.postsPerDay) sits beside it, so X stays at the owner's $7. */
    /* The reply reads are off from 2026-10-20 (attention.postsPerDay 0): their ~$0.72 now pays for the account watch. */
    /* Re-reads $5 of it from 2026-10-20 (was $2), the owner's figure, with the three-hour cut and
       For You's slower re-reads (track.offForYouPerPostMaxAgeMs, onForYouIntervalFactor): replayed
       over 2026-10-19 13:00–18:00 UTC, TRACK's text-source re-reads come to about $4.60 a day. */
    /* $11.30 from 2026-10-20 03:10 London: re-reads are on this bill, so searches keep $6.30 beside re-reads' $5 (the owner's ~$12 X day with the reply reads). */
    searchDay: { on: true, dailyUsd: 11.3, aheadMs: 1_800_000, countFromMs: 1_792_436_400_000, rereadDailyUsd: 5 },
    /* On from 2026-10-19, the owner's "per-language floors and budget shares". The shares are
       tools/lang-shares.ts at 08:30 UTC on 2026-10-19: the 771 coined X posts of the 7 days before
       that we hold with 500,000 views or more, 735 of them in these languages. $3.20 is the bands'
       part of the X search day (feed.searchDay), the rest of which is the middle lane's 15 to 60
       minutes (~$1.90), the slow and late searches in English (~$0.85), the last short page of every
       ask (~$0.55) and the narrative-name and quote searches (~$0.30); replayed on the stored posts of
       18-19 Oct (the report of 2026-10-19), $3.20 sets English's floor near 485 likes (49 at 6
       minutes, 404 at 50: about today's shared 510, so English gains from reading to the end, not
       from a lower floor) and Portuguese's, the busiest for its share, near 17,600. 2 posts an ask:
       the last short page is at most half a small language's money; it asks Korean every ~34
       minutes, French every ~6 and English every pass. */
    /* Re-split 2026-10-23, the owner's "whatever is best that won't cost me more", after the missed
       "Vegeta is Algerian" meme: Japanese was held to a bar about ten times English's (base floors
       that morning: ja 8,856 likes, en 820, fr 895; 886 against 82 at 6 minutes) on 2.7% of the
       money. Japanese 0.027 → 0.10, Turkish 0.015 and Chinese 0.012 new (`feed.langs`), paid by
       English 0.795 → 0.70, 'qme' 0.01 → 0.008 and Korean 0.008 → 0.005; the rest unchanged.
       `bandsDailyUsd` 4.1 → 3.65: its $0.45 pays for the older searches in French and Japanese
       (`slow.langs`), so the X search day's parts still add to what they did. Expected floors once
       settled, scaling each by its money to the power −2/3 (the slope of English's likes at 6 to 16
       minutes over 48 hours, N(>x) ~ x^−1.5): en ~965 (97 at 6 minutes, 805 at 50), ja ~4,000
       (400, 3,330), fr ~965, zxx ~810, es ~1,530, pt ~5,300, qme ~3,900, ko ~9,600; Turkish and
       Chinese are not known until asked (~365 and ~290 posts a day bought). French stays at
       English's level: its missed posts were under English's floor too. The posts the bands buy
       a day are the same in all (the same money at the same price), so the judging they feed does
       not grow either. */
    langSplit: {
      on: true,
      /* Arabic 0.005 from policy.v185 (`feed.langs`), Korean's share, taken from English (0.7 → 0.695). */
      shares: { en: 0.695, ja: 0.1, zxx: 0.063, fr: 0.054, es: 0.024, pt: 0.019, tr: 0.015, zh: 0.012, qme: 0.008, ko: 0.005, ar: 0.005 },
      bandsDailyUsd: 2.85, // 3.65 → 3.25 (Turkish, Chinese) → 2.85 (Spanish, Portuguese, 2026-10-24) in the older search (slow.langs)
      minPostsPerAsk: 2,
      maxEveryMs: 3_600_000, // an hour
    },
    /* OFF until the owner approves the cost (asked 2026-10-16: "show me the extra cost per day
       before switching on; keep the day within ~$50").
       Measured over the 48 hours to 2026-10-16 17:37 UTC from public.feed_post and public.item: For
       You holds about 53 text posts and 9.5 short videos at a time. Post-minutes on For You a day,
       text / short video: under 2 hours 4,878 / 762, 2 to 6 hours 25,130 / 4,053, over 6 hours
       (posts still growing, up to a day) 46,047 / 8,820. TRACK read those posts 1,623 / 129 times a
       day. A text read is $0.00015 an id asked (lookups bill every id); a short-video read is one
       credit, $0.00188, on the second vendor.
         The owner's cadence for both (1 min under 2h, 5 to 6h, 15 after): 12,974 text reads ($1.95,
         +$1.70 over TRACK's) and 2,161 short-video credits ($4.06, +$3.82): +$5.52 a day, and
         ~3,150 credits a day where the account spends ~1,120 now (about 1.9 days of 6,000).
         The day was $46.20 in the 24 hours to then, so that is ~$51.70: over.
         These values: the owner's cadence for text, 5 / 15 / 30 minutes for short video (717 credits,
         $1.35, +$1.10): +$2.81 a day, ~$49 in all, ~1,700 credits a day (about 3.5 days of 6,000).
         Opened sheets: no telemetry counts opens; at 500 a day each costs at most one read, ~$0.20.
       The lane's cap is its gross reads ($3.30) and the opens, with a little room. Switching on also
       wants budget.dailyUsd raised by about $3, since the live book ran ~$40 of its $40.50. */
    readings: {
      /* On from 2026-10-16 18:20 UTC, the owner's option 1: this cadence, its own loop and cap. */
      on: true,
      everyMs: 30_000,
      /* Halved on 2026-10-17 to cut cost without touching finding or judging (the owner: "do 2 and 3"):
         the text source's young posts every 2 minutes (was 1), short video every 10, 30 and 60
         minutes (was 5, 15 and 30), which also halves the second vendor's credits a day. */
      /* Halved again on 2026-10-20 for the text source only (the owner's go), part of the account
         watch's money: every 4, 10 and 30 minutes (was 2, 5 and 15). The lane spent $1.40 in the 13.4
         hours to 13:23 UTC that day, about $0.06 of it on short video, so ~$2.40 a day of the text
         source, nearly all of it this cadence (the sorts' tops ~$0.12, opens a few cents): about
         $1.00 to $1.20 a day saved. Short video keeps its cadence: it is paid on another line. */
      cadence: {
        steps: [
          { underMs: 7_200_000, everyMs: 240_000 }, // under 2 hours: every 4 minutes
          { underMs: 21_600_000, everyMs: 600_000 }, // under 6 hours: every 10 minutes
        ],
        thenEveryMs: 1_800_000, // then every 30 minutes while on For You
      },
      shortVideoCadence: {
        steps: [
          { underMs: 7_200_000, everyMs: 600_000 },
          { underMs: 21_600_000, everyMs: 1_800_000 },
        ],
        thenEveryMs: 3_600_000,
      },
      dueSlackMs: 10_000,
      openReadMinGapMs: 60_000,
      openAskMaxAgeMs: 180_000,
      openMaxPerPass: 20,
      /* 60 For You posts are all due at once only on a boot; more than that is a bug, not a pass. */
      maxPostsPerPass: 120,
      /* Over the second vendor's $0.00188 a credit; under the backup scraper's $0.003 a post plus $0.001 a run. */
      maxUsdPerRead: 0.0025,
      passDeadlineMs: 25_000,
      dailyUsd: 3.75,
      bookReserveUsd: 3,
      /* On 2026-10-18, the owner's yes: the text source's top 20 about $0.11 to $0.13 a day, the short
         video's top 10 about $0.46 (each replayed over the 24 hours before). 25 minutes keeps the newest
         reading under 30 with the pass's slack. Ten short videos a pass is about two cents at most.
         The owner's redesign of 2026-10-18 (Trending now, Most viewed Today and This week), replayed on
         the 24 hours to 2026-10-18 against the lists before it: with every list's short-video top at 10
         it adds about $0.69 a day (text +$0.15, short video +$0.54), over the owner's ~$0.50. The per-pass
         limits cannot hold it, since a pass runs every 30 seconds (one short video a pass still adds
         $0.63), so Most viewed's two lists keep their top 7 short videos fresh and Trending its 10: about
         +$0.33 a day (8 would be +$0.49). */
      sortTop: { on: true, topN: 20, everyMs: 1_500_000, recomputeMs: 300_000, maxPerPass: 20, shortVideoTopN: 10, shortVideoMaxPerPass: 10, shortVideoViewedTopN: 7 },
    },
    /* The owner, 2026-10-18: "build the narrative-name search ... its own daily $ cap at your top
       estimate: $0.35". 52 of the 95-99 shown narratives had a safe name on 2026-10-18; one ask an hour
       each is ~1,250 asks a day, $0.19 at the source's one-post floor a request. Probed that night, 52
       asks at this floor over the last hour returned nothing; over the three days before, 115 held
       posts carrying one of those names had 1,000 likes inside their first hour (87 at 2,000), ~40 a
       day, most already found by another lane. With their re-finds and the new ones judged: ~$0.20-0.25
       a day, so the cap is the top of the estimate.
       1,000 likes, not the middle lane's 2,000: that lane already returns every post 15 minutes to
       3 hours old at 2,000 in these languages, so a 2,000 floor over the last hour would find almost
       nothing it does not; a name narrows the search enough to ask for half the likes.
       The owner, 2026-10-18: one ask a name across all languages (no language filter), not one per
       language of `feed.langs` — the per-language split would make the ~1,250 asks a day ~6,250 under
       the same cap. */
    narrativeNames: {
      on: true,
      /* Every two hours from 2026-10-20 (was hourly), part of the account watch's money: an ask is
         forward from the name's last one, so the posts are the same and only the per-request floor of
         ~52 asks an hour is halved, ~$0.09 a day. In the 7 days to 2026-10-20 it found 6 coined posts
         of 500k views, 1 before its coin; a name's posts come an hour later at most. */
      everyMs: 7_200_000, // every two hours
      minApproval: 1_000,
      maxNarratives: 60,
      maxPagesPerAsk: 3,
      passDeadlineMs: 240_000,
      minMemberPosts: 2,
      membersRead: 40,
      maxWords: 3,
      minWordLetters: 5,
      commonWords: [
        'a', 'about', 'after', 'ai', 'all', 'an', 'and', 'are', 'as', 'at', 'baby', 'be', 'big', 'but', 'by',
        'cat', 'cats', 'coin', 'coins', 'community', 'controversy', 'crypto', 'day', 'discovered', 'dog',
        'dogs', 'elon', 'for', 'france', 'french', 'from', 'gains', 'goes', 'has', 'have', 'he', 'her',
        'his', 'i', 'in', 'incident', 'into', 'is', 'it', 'its', 'just', 'man', 'meme', 'memes', 'musk',
        'my', 'named', 'new', 'news', 'not', 'now', 'of', 'on', 'or', 'our', 'out', 'people', 'popularity',
        'post', 'project', 'protests', 'rise', 'she', 'so', 'social', 'media', 'tesla', 'that', 'the',
        'their', 'they', 'this', 'to', 'token', 'trump', 'up', 'video', 'viral', 'was', 'we', 'what',
        'when', 'who', 'why', 'will', 'with', 'world', 'x', 'you', 'your',
      ],
      /* The middle lane's judging figures: the same judge, on the same kind of post. */
      cap: { dailyUsd: 0.35, judgeUsdPerPost: 0.00145, judgedShare: 0.9 },
    },
    /* policy.v159, the owner's yes (2026-10-24, ~$0.60 a month a war). 300 likes: of the stored posts of
       the 8 days to 24 Oct naming the other country in their own language with 40k views or more, the
       10th percentile of likes was 460 (Chinese naming Turkey), 1,119 (Turkish naming China), 1,671
       (Japanese naming France) and 7,585 (French naming Japan) — 300 is under every side's, so a post
       on its way to For You's bar is found within its first 90 minutes. Two wars, about 3 words a war,
       48 passes a day: ~290 asks at the one-post minimum ($0.00015), ~$0.04, and each post over 300
       likes returned about 3 times (~10 to 40 a side a day), ~$0.02 to $0.07; about $0.03 a war a day,
       ~$1 a month. $0.10 a day caps it whatever a busy war brings. */
    fightWords: {
      on: true,
      everyMs: 1_800_000, // half an hour
      lookbackMs: 5_400_000, // ninety minutes
      minApproval: 300,
      wordsPerSide: 2,
      /* policy.v169, the owner's yes (2026-10-24): France vs Japan had 24 French posts and no Japanese
         one; in the 4 days to then only 6 stored Japanese posts named フランス, all under 10k views and
         none the war, and this search's Japanese ask found 2 posts at 300 likes in its first 6 hours.
         Japanese at 100, and its three words (フランス, フランス人, 仏人) asked, not one. Estimated: 2
         more asks a pass at the one-post minimum, 96 a day, ~$0.015; about 3 times the Japanese posts
         at a third of the likes, ~25 a day returned ~3 times, ~$0.011, and judged, ~$0.010 — about
         $0.035 a day more, inside the $0.10 cap (the day of 24 Oct had spent $0.021 by 17:30 UTC). */
      phrasesPerSide: 2,
      /* policy.v175, the owner's yes (2026-10-25, told about $3-6 a month more). The named wars' sides
         at 200 likes (Arabic, Spanish, Portuguese) and Vietnamese at 100: the Arabic war posts found
         that day had 77k-479k views and the Spanish 90k-99k, which at an assumed 1% of views in likes
         is 770 likes and up, so 200 finds one inside its first 90 minutes; Vietnamese posts draw
         fewer likes on X, so 100. One or two words a side: 8 asks a pass for the three named wars
         (Arabic 2 + 1, Spanish 2, Portuguese 1, Vietnamese 1, Korean 1), and France vs Japan's four
         Japanese phrases. */
      byLang: {
        ja: { minApproval: 100, wordsPerSide: 3, phrasesPerSide: 6 },
        /* policy.v178: the owner's China vs Turkey examples of 25 Oct were Turkish posts of 55k-180k views
           at 207-2,259 likes, two under 300: at 150. */
        tr: { minApproval: 150, wordsPerSide: 2 },
        ar: { minApproval: 200, wordsPerSide: 2 },
        /* policy.v179: the Argentine side writes árabe ("el árabe cuando…", 332k; a reply "el árabe que…",
           303k) far more than saudí, and only the first two words were asked: all five. */
        es: { minApproval: 200, wordsPerSide: 5 },
        pt: { minApproval: 200, wordsPerSide: 1 },
        vi: { minApproval: 100, wordsPerSide: 1 },
      },
      maxWars: 6,
      maxPagesPerAsk: 2,
      passDeadlineMs: 120_000,
      /* policy.v175: $0.10 → $0.25. At $0.10 the day's ~$0.065 (v169's) plus v175's ~$0.13-0.18
         would stop the search by mid-afternoon; $0.25 caps the whole search at ~$7.50 a month. */
      cap: { dailyUsd: 0.25, judgeUsdPerPost: 0.00046, judgedShare: 0.9 },
    },
    /* The owner, 2026-10-18: "build ... the quote search on 10M+ accounts ... $1.00". Over the three
       days to 2026-10-18, 325 held text posts by 10M+ accounts reached 5,000 likes within 3 hours by our
       readings (~110 a day), and 469 more had only an early reading under 5,000 (re-read below). Two
       asks each is ~220-300 asks a day; probed, a typical big post has 0-1 quotes at 300 likes by 3
       hours and a viral one 12 or more (the Tesla post). Search ~$0.07, re-reads ~$0.11, and ~150
       new quotes judged ~$0.20: ~$0.35-0.45 a day, the cap's $1.00 is a viral day's. */
    /* OFF from 2026-10-20, its money to the account watch (`accountWatch`): in the 7 days to then it
       found 216 English posts and none was a coined post of 100k views or more (2 coined at all), 5
       of 327 in the last 3 days reached For You. ~$0.20 to $0.30 a day of search and re-reads (its
       ledger, $0.21 by 12:35 UTC and $0.43 on 2026-10-19, less ~$0.0013 of judging a new quote). */
    reproductions: {
      on: false,
      everyMs: 300_000, // every 5 minutes
      minFollowers: 10_000_000,
      minApproval: 5_000,
      reproductionMinApproval: 300,
      askAtMin: [60, 180],
      askGraceMin: 45,
      maxCandidates: 200,
      /* About 350 big posts a day have only an early reading under 5,000; one re-read by id an age is
         ~700 ids, $0.11 a day, on this lane's cap. */
      rereadAfterMin: 15,
      maxRereadsPerPass: 50,
      maxPostsPerPass: 40,
      maxPagesPerAsk: 3,
      passDeadlineMs: 120_000,
      cap: { dailyUsd: 1, judgeUsdPerPost: 0.00145, judgedShare: 0.9 },
    },
    /* On from 2026-10-20 ("find viral X posts sooner without raising X spend"), paid for by the quote
       search and the backward name search going off (both below their own entries).
       Replayed on the coined posts of 2026-10-13 to 2026-10-20 (coin 0-48 hours after the post), each
       post's author on the list as it stood when the post went up (no look-ahead):
         100k views or more: 1,003 posts, 183 found before their coin today, 32 on For You before it;
         304 by listed accounts; every 3 minutes, +99 found before the coin and +54 on For You before
         it (judge said yes, 3 minutes found to shown), median 49 minutes earlier found. Every 2
         minutes: +106 and +55 for ~$0.32 a day more; every 5: +91 and +52 for ~$0.25 less.
         500k views or more: 410 posts, 71 found before, 11 on For You before; +33 and +20, median
         14 minutes earlier found.
       Many coins on the biggest accounts come within a minute of the post (bots); no cadence beats
       those, and they are counted as misses above.
       Cost, from the listed accounts' held posts of the 7 days to 2026-10-20 (a lower bound on what
       they post; doubled for the upper figure): 15 to a search, 9 groups, every 3 minutes, 4,320
       asks a day of which ~3,800 come back empty, 660 to 1,320 posts: $0.67 to $0.77 a day of search.
       20 to a search would be ~$0.10 less, at a query near the platform's length limit. The cap is
       that plus the judging of its new posts at the live judge's price, with room for a busy day. */
    /* ★ 40 ACCOUNTS EVERY 6 MINUTES from 2026-10-20 (the owner's go; was every account with two coined
       posts, 124 of them, every 3 minutes). Its first 25 minutes live (12:56 to 13:21 UTC) answered
       640 posts, not the ~30 an hour the estimate above expected: 539 (84%) were one account's
       replies, an answering bot ranked 44th with 3 coined posts, which filled its group's three pages
       every ask and so hid its 14 group-mates. 543 of the 640 were replies, 5 quotes, 92 posts; 2 got
       the judge's yes and 1 reached For You (both from the top 40). Paced to $1.10 a day, that buys
       about one check an hour. The 40 with the most coined posts of 100k views (30 days; the list is
       already ranked) hold 529 of the 717 such posts the 124 did, and posted ~110 times an hour in
       that sample (none of them replies): 3 asks a pass, 720 a day, ~2,600 posts, ~$0.40-0.45 a day
       of search and ~$1.10 of judging, under a $2.40 day paced from 00:00 UTC.
       REPLIES STAY IN: 48 of those 529 coined posts were replies, 45 of them the first account's
       (30% of its 149), and once the bot is off the list replies are ~4% of what comes back. */
    accountWatch: {
      on: true,
      everyMs: 360_000, // every 6 minutes
      accountsPerAsk: 15,
      maxAccounts: 40,
      minCoinedPosts: 2,
      minReach: 100_000,
      lookbackMs: 2_592_000_000, // 30 days
      coinWithinMs: 172_800_000, // two days, the coin link's own window
      listEveryMs: 3_600_000, // hourly
      maxWindowMs: 900_000, // a quarter-hour back at most, after a restart
      maxPagesPerAsk: 3,
      passDeadlineMs: 90_000,
      cap: { dailyUsd: 2.4, judgeUsdPerPost: 0.00046, judgedShare: 0.9 },
    },
  },

  attention: {
    /* One search page each: at most 40 posts returned, $0.006 a read on the posts line. */
    repliesPerPost: 20,
    reproductionsPerPost: 20,
    postsPerPass: 10,
    /* About 1,000 text posts a day clear For You's bar (2026-10-13); 300 reads is at most $1.80 a
       day, the judged-yes posts first (services/runner/src/work/crypto-attention.ts).
       140 from 2026-10-20 (the owner): a post's reads cost about $0.0053, and 300 cost $1.58 on
       2026-10-20; 140 is about $0.74 a day.
       0 from 2026-10-20 (the owner's go): OFF, its money to the account watch (`feed.accountWatch`).
       300 reads cost $1.58 that day, $0.0053 a post, so 140 was ~$0.74 a day of the text source.
       Nothing else stops: posts already read keep their facts, and no read is no row, not a zero.
       Back on is this one number. */
    postsPerDay: 0,
    rereadAfterMs: 3_600_000, // an hour
    coinWords: ['coin', 'coins', 'memecoin', 'memecoins', 'token', 'tokens', 'pump', 'pumping', 'pumped', 'ticker', 'mcap', 'marketcap', 'dex', 'bonded', 'aped', 'rugged', 'launched', 'contract'],
    cryptoAccountWords: ['crypto', 'cryptos', 'memecoin', 'memecoins', 'degen', 'degens', 'trader', 'trading', 'web3', 'defi', 'nft', 'nfts', 'onchain', 'airdrop', 'airdrops', 'calls', 'caller', '100x', '1000x', 'gem', 'gems', 'sol', 'btc', 'eth', 'bnb', 'dex', 'pump', 'token', 'tokens', 'coin', 'coins', 'shitcoin', 'shitcoins', 'bitcoin', 'altcoin', 'altcoins', 'trenches', 'chart', 'charts'],
    tickerMinChars: 2,
    tickerMaxChars: 10,
    addressMinChars: 32,
    addressMaxChars: 44,
    hexAddressChars: 40,
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

  postCoin: {
    minLinkIdLength: 8,
    minVariantLength: 4,
    /* On gold, every right coin found by its picture was within 14 bits, no unrelated post's coin
       closer than 16; a same picture is held to 10, where the right coins sat at 0 to 2. */
    sameHashDistance: 10,
    widenHashDistance: 14,
    pictureFloor: 0.85,
    timingHalfLifeMin: 360,
    descriptionMinWord: 4,
    /* The lowest share at which the tuning half's likely coins were right three times in four. */
    likelyMinShare: 0.3,
    /* Fitted 2026-10-13 on the gold set's tuning half (eval/src/gold/run-matching.ts --fit): the
       order on the 25 posts whose right coin was one of several unproven candidates, then the base on all
       305 unproven posts against "none of these". Signals with no data yet (an address in the
       replies never named a gold coin; trading not measured on gold) stay at 0 until a refit. */
    /* The launchpad mints about 20 coins a minute; 60 a one-minute pass keeps up with a busy hour. */
    hashCoinsPerPass: 60,
    hashPostsPerPass: 40,
    hashMaxAttempts: 3,
    hashTimeoutMs: 10_000,
    pictureCandidatesPerPost: 5,
    nameCandidatesPerPost: 10,
    /* 2026-10-16, the owner: coin matching got more wrong, "roll back that part". Bisected on the
       same inputs (frozen gold, the owner's labels against today's database): the first-launch rule
       (2026-10-15 18:20) took the founders' 71 posts from 28 right / 2 wrong to 30 / 6 and the owner's
       labels from 12 / 7 to 19 / 17; weighing every linking coin (18:21) took them on to 18 / 30. Every
       new wrong was "Links this post" on a copycat launched seconds after the post (today's four
       wrong taps on the Flying Tesla Roadster posts among them). Both off restores Wednesday's rule. */
    firstLinkWins: false,
    linkedCandidates: false,
    /* 2026-10-16, measured before switching on, on the rollback's inputs (frozen gold, the stored fit,
       my 106 coin labels against today's database; right / wrong): off 10/0 held-out, 28/2 the 71
       origin posts, 11/7 my labels. On (10 coins a day, a minute): 11/0, 30/6, 15/16 — more right and
       more wrong, so it stays off. Every bar tried was worse: 3 or 5 coins, two minutes, the minute
       alone (18/18), the serial dev alone (15/16). The bots' coins mostly carry the post's own name
       (Tesla Roadster, THRUSTER), so the minute rule excuses them; many come from launchpads whose
       creator we do not hold; and the creators of my right coins launch 10 to 17 linking coins a day
       too. Without the earliest-launch part the filter alone is 10/0, 28/2, 10/8. */
    botFilter: { on: false, serialDevMinCoins: 10, serialDevWindowMs: 86_400_000, instantMs: 60_000 },
    /* Measured 2026-10-14 on 3,300 post vectors (2,800 embedded for this: every post the judge said
       yes to in the last day, GTA, tiger and game posts; the rest the owner's labelled posts) against
       the 20 posts the owner confirmed one of 13 coins on. One confirmed post alone: unrelated posts
       reach 0.686 (a 1986 gorilla-enclosure post to the tiger's $Altai) and 0.65 (OFFICER WHISKERS),
       so 0.70. Two confirmed posts of one coin each at 0.60: the closest unrelated post is Putinu
       (0.585 and 0.574 to two $Altai posts), so 0.60; this adds tiger and GTA 6 posts only. 0.45 with
       the judge's name or a shared story; names under 4 letters ("GTA", "RIP") are too common (the
       GTA Online shop post reached $GTA by "GTA"). Result: 146 posts get a story coin, one doubtful
       (a viral cat-lion meme to $Altai); 35 of 68 GTA 6 posts get $GTA and no GTA 5, GTA meme or
       Onitsuka Tiger post does; 25 tiger-story posts get $Altai. */
    /* 2026-10-14 evening: never on a post of fewer than 3 words once hashtags, mentions and links go
       ($ROAD had spread to three hashtag-only short videos), and every tier needs a shared detail —
       the same name, picture, or a topic word of 4+ letters. */
    storyCoin: { alone: 0.866, together: 0.844, togetherPosts: 2, near: 0.787, minNameChars: 4, minWords: 3, minTopicChars: 4 },
    /* Measured 2026-10-14 on the owner's coin labels (18 with a coin, 16 "No coin"): the list keeps
       the owner's coin as often as before (10 of 18; the other 8 were never in the name search's
       list) and shows 6.4 other coins a post instead of 12.8, 4.7 on a "No coin" post instead of
       15.7 (4 of 16 now say No coin yet). A coin of an ongoing story launched days before (Altai,
       HomeView) stays because the venue still quotes it; 1 h or 6 h of grace changed nothing. */
    /* maxCoins 6 (2026-10-14 evening, with the list ranked by fit): on the owner's 22 coin labels and
       live searches his coin is in 11 lists with 5.3 other coins each; 10 by market cap held it in 9
       with 9.2. */
    list: { graceBeforeMs: 10_800_000, quietAfterMs: 86_400_000, maxCoins: 6, descriptionShare: 0.5 },
    /* Off (a paid read). 60 hours after the post, every 2 hours, on a source whose re-read is at most
       a tenth of a cent a post: the text source's ($0.00015). The short-video source's is $0.003 a post
       plus $0.001 a run: raise the bar to 0.005 to include it. */
    /* On 2026-10-14 for the short-video source only (runner env BIO_REFRESH_SOURCES), the owner's call:
       about $0.45–1.75 a day. 0.005 a post lets its re-read in. */
    bio: { refreshOn: true, refreshForMs: 216_000_000, refreshEveryMs: 7_200_000, refreshMaxUsdPerPost: 0.005, refreshPerPass: 100, refreshPerDay: 6_000 },
    weights: { base: -7.232, linksPost: 1.175, linksAccount: -0.218, picture: 0.825, hash: 0.495, description: 0.205, authorAddress: 0, othersAddress: 0, timing: 2.134, nameExact: 2.768, nameVariant: -0.46, tradingJump: 0 },
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
      /* 6: the namer's top three names and their tickers, after the judge's 4. Free reads; ~349 posts
         searched a day at 10 names on 2 sources is ~7,000 calls, inside `perDay`. */
      guessNamesPerSubject: 6,
      /* 100: a fifth of the Analyst plan's 500 a minute, the rest left to market reads. */
      perMinute: 100,
      retries: 3,
      giveUpMs: 600_000, // ten minutes
      narrativePosts: {
        /* 4 a pass, a pass a minute, with the feed's posts always searched first: the day's cap, not
           this, is what bounds the sweep — about 1,200 a day, so the 2,000-odd posts of the pages on
           18 Oct are all searched in about two days, and the new ones each day well inside it. */
        perPass: 4,
        /* 5,000 calls: 500 feed posts at ten names, over twice the most the feed searched in a day (452, 16 Oct). */
        feedReserve: 5_000,
        liveKeepMs: 21_600_000, // six hours, as the feed's
        deadKeepMs: 259_200_000, // three days
        /* 2,000 (2026-10-18): a thousand coins a day enriched. The plan's allowance could not be
           confirmed and the two methods are not the provider's one-credit kind, while the backlog
           alone would have asked ~26,000. */
        chainReadsPerDay: 2_000,
      },
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
    /* No cap (the owner, 2026-10-15: "remove it for everyone"). Null, not a huge number, so "no
       cap" is a decision the code can see. A buy is bounded by the wallet's SOL, and every
       transaction is still simulated before it is offered for signing. It was 0.06 SOL. */
    maxSolPerTrade: null,
    defaultSlippageBps: 300,
    /* 15%: past this a launchpad coin's quote says little about what the trade will fill at. */
    maxSlippageBps: 1_500,
    platformFeeBps: 0,
    probeSol: 0.001,
    /* No cap, as for a buy (the owner, 2026-10-15). Any amount may be typed on Create; the launch
       is simulated, so a dev buy the wallet cannot pay for is refused. It was 0.05 SOL. */
    maxDevBuySol: null,
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
    /* Trador's Feed page (lib/server/socialFeed.ts FEED_PAGE). */
    feedPageSize: 20,
    /* One screen of faces under the empty Feed, not a directory. */
    peopleToFollow: 8,
    /* Seven days: "this week" on the People to follow rows. */
    peopleWindowMs: 604_800_000,
    /* Ten minutes either side of the landing, as 0109's settle step looks ten minutes back. */
    tradeCapWindowMs: 600_000,
    perClient: 60,
    windowMs: 60_000,
  },

  owner: {
    wallets: ['A1e82D9Lw4irgKMpXRpJbvLw8c7xCCyA42NdcxzKvvdL'],
    xHandles: ['hawabuilds'],
  },

  invites: {
    /* The coordinator's defaults for the owner, 2026-10-21: three each, a partner code for a
       hundred people, and caps on what one tap of the owner's can do. */
    perMember: 3,
    codeLength: 8,
    partnerDefaultUses: 100,
    partnerMaxUses: 10_000,
    maxLetIn: 500,
    maxGive: 10,
    topInviters: 10,
    joinedShown: 100,
  },

  learning: {
    retuneAt: ['00:00'],
    timeZone: 'Europe/London',
    startAheadMs: 1_200_000, // twenty minutes
    minGoldPass: 0.65,
    maxLiveNegativePass: 0.15,
    minMissedPass: 0.5,
    maxExamples: 120,
    /* The owner, 2026-10-16: the Flávio Hipotético picture post (coin confirmed by the owner), the one
       missed post the live judge caught and version 9 lost at 07:00 UTC. Taught so it is learned back. */
    alwaysTeach: [],
    /* The owner's three conditions, 2026-10-17: more of the fixed test caught, gold not lower, junk at
       most two points up, junk on the last three days of For You. */
    ownerGate: {
      on: true, maxJunkRise: 0.02, junkDays: 3, junkFeed: 'fyp', newsKinds: ['SHOWBIZ', 'CORP_NEWS', 'TRAGEDY'],
      /* The owner's numbers, 2026-10-18: 300 untapped posts, the old answers at 0.90, 0.6–0.8 unclear.
         About 150 of the 300 are old-label "not" and graded on both sides: ~$0.12 a run more. */
      untapped: { sample: 300, seed: 'junk-b-2026-10-18', fallbackCutoff: 0.9, unclearBand: [0.6, 0.8] },
    },
    coinedYes: {
      /* On: the owner approved it, 2026-10-16. Free: read from our own rows, no judge call. */
      on: true,
      minCoins: 2,
      lateMs: 600_000, // ten minutes
      /* Fifty from 2026-10-17 (was twenty): Nemotron, the live judge since 11:06 UTC, said no to 15 big
         lane posts that were coined later and yes to only 9; the owner chose to tune it rather than add a
         second opinion. Coined posts the judge said no to are the most direct lesson; 50 of 120 still
         leaves most of the block to the owner's own calls. */
      maxPerBlock: 50,
      deployerWindowMs: 420_000, // seven minutes
      deployerMinPosts: 3,
      /* The owner's test, 2026-10-18: animals and objects the judge already passes are not taught. */
      animalObjectWords: [
        'animal', 'cat', 'kitten', 'kitty', 'dog', 'puppy', 'doggo', 'bird', 'fish', 'frog', 'monkey', 'ape', 'bear', 'panda', 'capybara',
        'raccoon', 'otter', 'seal', 'hippo', 'sloth', 'penguin', 'duck', 'goose', 'horse', 'cow', 'pig', 'goat', 'sheep', 'rabbit', 'bunny',
        'hamster', 'mouse', 'rat', 'fox', 'wolf', 'lion', 'tiger', 'deer', 'owl', 'parrot', 'turtle', 'snake', 'lizard', 'shark', 'whale',
        'dolphin', 'octopus', 'crab', 'bee', 'porcupine', 'squirrel', 'koala', 'giraffe', 'elephant', 'zebra', 'hedgehog', 'bat',
        'robot', 'toy', 'plush', 'plushie', 'doll', 'statue', 'figurine', 'car', 'truck', 'shoe', 'hat', 'rock', 'banana', 'potato',
      ],
    },
    /* The owner's rule, 2026-10-18: two seconds on screen or opened, no "Not a meme" within 24 hours.
       Twenty of the 120 examples at most, after the coined posts; half an explicit label's weight in
       the coin model's fit. Free: our own rows. */
    seenKept: {
      keepWindowMs: 86_400_000, // 24 hours
      lookbackMs: 1_209_600_000, // 14 days, the coin model's own window
      teach: true,
      maxPerBlock: 20,
      afterCoined: true,
      fitWeight: 0.5,
    },
    /* The X language bug: from 16 Oct 23:20 UTC the posts supplier honoured only the last language
       asked, so the X search found almost only Japanese until the per-language fix at 09:22 on 18 Oct. */
    abnormalWindows: [{ from: '2026-10-16T23:20:00Z', until: '2026-10-18T09:22:00Z', why: 'X search returned only one language' }],
    maxMissedPerPaste: 10,
    scoreHeldOutShare: 0.3,
    scoreL2: 1,
    /* The owner's numbers, 2026-10-16: one point at a time, no higher than 0.95. */
    cutoffStep: 0.01,
    cutoffMax: 0.95,
    /* On: the owner asked for it, 2026-10-16. 25 rules, 3,000 characters: about 800 tokens more in
       every judge call, under a fifth of the block's. One call a run, about a cent at the writer's
       prices; a two-note pattern is a pattern, a one-note one is a post. */
    rulebook: {
      on: true,
      /* The owner's rule, 2026-10-17, word for word. The video sentence stays: the live judge is sent
         the cover of every video, on both sources, as a picture, and Nemotron describes it correctly
         (checked with three calls on Together, 2026-10-17). */
      /* The catchphrase rule (2026-10-17) was dropped by the owner on 2026-10-18: with it the candidate
         did worse twice. */
      ownerRules: [],
      maxRules: 25, maxRuleChars: 220, maxChars: 3_000, maxOutputTokens: 1_500, maxNotes: 30, minNoteUses: 2, maxNoteChars: 60 },
    shortVideo: {
      barAgesMin: [30, 60, 120],
      /* An hour: the re-reads are every half hour, so two readings an hour apart bracket any age. */
      readingGapMs: 3_600_000,
      /* 10: on 2026-10-16 we held 15 coined short videos and 3 had a reading under two hours old. */
      minEarlyCoined: 10,
      barCatchShare: 0.8,
      /* Off until the owner approves: about 60 more posts graded twice a run, ~$0.15 a run, $0.30 a day on the learning book. */
      gateOn: false,
      /* Off until the owner approves: about 28 new coined videos a day (193 in the week to 2026-10-16), one credit each, ~$0.05 a day on the learning book. */
      refetchOn: false,
      refetchPerRun: 20,
      reviewAfterMs: 259_200_000, // three days, the owner's
    },
  },

  notify: {
    /* Trador's rungs (lib/notifications/milestones.ts). */
    milestones: [2, 3, 5, 10, 25, 50, 100],
    defaultMultiples: [2, 5, 10],
    graduatingSoonAt: 0.9,
    minPositionUsd: 10,
    /* Six an hour by default: a busy day still reads as alerts, not noise. */
    defaultPerHour: 6,
    /* Sixty: the owner asked for every new For You post, one by one, which is about twenty an hour. */
    maxPerHour: 60,
    inboxLimit: 40,
    /* Two minutes: free price and curve reads for a handful of people, well inside the free tiers. */
    marketLoopMs: 120_000,
    /* Twenty seconds: a coin found for a For You post is pushed "as soon as" the projector writes it. */
    pipelineLoopMs: 20_000,
    /* Thirty minutes: two parse calls per wallet per half hour stays far inside a free tier. */
    positionsKeepMs: 1_800_000,
    deliverLoopMs: 5_000,
    /* Five seconds: the mint stream stores a coin about five seconds after it is made. */
    watchLoopMs: 5_000,
    watchMetadataPerPass: 40,
    watchMinNameChars: 4,
    /* Twenty narratives a pass, a pass every twenty seconds: 18 Oct had 13 first coins in three days. */
    firstCoinPerPass: 20,
    pushTtlS: 86_400,
    /* The owner's notification design, 2026-10-18. Bars from tools/notify-backtest.ts on the three
       days before (see the commit that set them). */
    blowingUp: {
      topN: 3,
      minPerMin: 3_000,
      perDay: 3,
      dayMs: 86_400_000,
      minGapMs: 10_800_000, // three hours, so three pushes spread over the day
      perPass: 3,
      newNarrativeMaxAgeMs: 21_600_000, // six hours
      newNarrativeMinPosts: 5,
      newNarrativeMinReach: 1_000_000,
    },
    starredSpeed: { minNewPosts: 3, minReach: 500_000, minRatio: 1.5, gapMs: 14_400_000 }, // four hours
    bigAccount: { minFollowers: 1_000_000, maxPostAgeMs: 21_600_000, perPass: 20, gapMs: 10_800_000 }, // three hours a narrative
    holdingDownAt: 0.5,
    /* Seven days, ten coins a pass, the newest twenty transactions: one signatures read and one parse per coin a pass. */
    creatorBuyers: { maxCoinAgeMs: 604_800_000, perPass: 10, signaturesRead: 20 },
    grouped: {
      follow: { waitMs: 600_000, gapMs: 3_600_000 }, // ten minutes to gather, an hour apart
      useful: { waitMs: 3_600_000, gapMs: 86_400_000 }, // an hour to gather, once a day
    },
    /* The owner's one push, 2026-10-20. Replayed on the live picks of 19 Oct 17:42 to 20 Oct 13:18
       UTC: 7 coins qualified (4 on the 19th, 3 on the 20th), so six a day never cut a real day and
       still stops a burst. Picks came 5 to 117 minutes after launch; three hours keeps those and
       drops the one narrative pick of a coin 40 hours old ("BENNY"). */
    /* 15 from policy.v161 (the owner, 2026-10-24: "raise it from 6 — I want to be notified when posts
       like the one I just sent get coined, so do my friends"). On 23 Oct a person with a phone was
       sent ~21 coin pushes and six reached them, all by 16:50 London; the rest only listed. */
    launch: {
      perDay: 15,
      dayMs: 86_400_000,
      maxLaunchAgeMs: 10_800_000, // three hours
      lateRunningMs: 86_400_000, // a day, while running (policy.v164)
      postsWithinMs: 172_800_000, // two days, oneCoin.linkMaxAgeMs
      ownerAlarmsPush: true,
    },
    /* The owner, 2026-10-24: a saved post's first push at $20,000 traded in the last hour, the
       strip's 20 trades kept (see the type for the measurement). */
    savedPost: { minVolume1hUsd: 20_000, minTrades1h: 20 },
    perClient: 60,
    windowMs: 60_000,
    /* The owner, 2026-10-18: "if any language's X finds per hour drop by more than 70% ... alert me",
       a rolling 3 hours against the same 3 hours the day before, at least 30 finds in the baseline.
       Recovery at half the window it dropped from, so a language hovering near the line is not said
       down and back each pass.
       Backtested 14 Oct 00:00 to 18 Oct 10:00 UTC (tools/language-drop-backtest.ts): on the text
       source nothing fired before the bug; English went down at 00:50 UTC on 17 Oct (Portuguese 00:40,
       no-text 01:30, media-only at the 23:20 onset and again at 20:30 when Japanese became the one
       language answered, every language together 01:50), all the same bug; the one push that was
       not a fault was media-only at 09:50 on 18 Oct, falling back from the day the bug made it the
       language answered. The short-video source fell in every language at once four times (three on
       15 Oct, one at 05:40 on 18 Oct): one push each for the whole source, none per language. */
    languageDrop: {
      on: true,
      everyMs: 600_000, // ten minutes
      windowMs: 10_800_000, // three hours
      baselineAgoMs: 86_400_000, // the same hours the day before
      dropShare: 0.7,
      recoverShare: 0.5,
      minBaselineFinds: 30,
      lookbackMs: 172_800_000, // two days
      announceWithinMs: 3_600_000, // an hour
      lanes: {
        text: ['all', 'media', 'slow', 'middle', 'narrative_name', 'quote'],
        video: ['watch', 'learned_tag', 'trending', 'trend', 'creator'],
      },
    },
    /* The owner, 2026-10-20: "when the judge's average cost per call over the last hour exceeds 2×
       the trailing 7-day median, alert me, at most once per 6 hours" (see JudgeCostPolicy). */
    judgeCost: {
      on: true,
      everyMs: 600_000, // ten minutes
      windowMs: 3_600_000, // an hour
      baselineMs: 604_800_000, // seven days
      factor: 2,
      /* 90 to 200 calls an hour on 2026-10-19 and 20; under 20 is a handful. */
      minCalls: 20,
      /* Half a day of normal hours before a median is trusted: the router's judge began on 2026-10-19. */
      minBaselineHours: 12,
      quietMs: 21_600_000, // six hours
    },
  },

  wallet: {
    keepMs: 30_000,
    perClient: 30,
    windowMs: 60_000,
    holdingsShown: 50,
    /* 200 transactions: two parse calls of a hundred, well inside a free parsing tier. */
    signaturesRead: 200,
    /* 1,000 rows: one index range read of a few hundred kilobytes; nobody trades that much here yet. */
    tradesRead: 1_000,
    /* Ten minutes: fine enough to see a real move, coarse enough that a day is 144 points. */
    snapshotGapMs: 600_000,
  },

  /* ONE POST, ONE COIN (the owner approved 2026-10-19). LIVE from 2026-10-19 18:40 London at the
     owner's word ("I want it live"), after half an hour of shadow; tools/onecoin-shadow.ts still
     prints picks against what ran. The numbers are the replay's: $15k, 3x, re-judged on
     every update, the rug floor at 30% of the peak; 15 buyers is provisional, no buyer data existed. */
  oneCoin: {
    mode: 'live',
    everyMs: 5_000,
    postWindowMs: 21_600_000, // six hours
    /* Two days, the owner's word (20 Oct): unbounded, links reopened 16-18 Oct posts a day or two on
       with copycats of the viral post and moved their pick. HI's quote link was 24 h. */
    linkMaxAgeMs: 172_800_000,
    launchLeadMs: 600_000, // ten minutes
    rematchMs: 180_000, // three minutes
    watchMs: 3_600_000, // an hour
    judgeFromMs: 300_000, // five minutes
    confirmByMs: 600_000, // ten minutes
    minCapUsd: 15_000,
    leadRatio: 3,
    minUniqueBuyers: 15,
    handOverRatio: 3,
    rugShareOfPeak: 0.3,
    /* A held coin's dip (the owner's "more forgiving", 20 Oct, after $Laura blanked for 18 minutes).
       Replayed on readings since live: of 22 drops kept at $10k / 30 min, 12 came back over the
       share within the hour and 10 were still trading over $15k; none was a rug. Without the floor,
       27 more were kept: 22 were $2-6k rugs that never came back (2 did, 3 unread). $15k kept the same set but would drop
       Laura's $12k; 20 minutes kept the same coins but two fewer were right at +30 min. */
    rugFloorUsd: 10_000,
    rugGraceMs: 1_800_000, // half an hour
    rugKeepAboveUsd: 50_000,
    crashCapRatio: 2,
    /* The owner's "earliest entry" (2026-10-26). tools/race-replay.ts --readings, 19-26 Oct, 1,585 posts:
       $10k / 1.5x showed the real coin earlier than the pick on 20 posts (median 9.8 min after launch,
       $42k), with 40 PvPs of which 9 never held the real coin and 4 were on posts where nothing ran;
       $20k / 3x: 10 posts earlier, 16 PvPs; top three from $5k: 15 earlier, 30 PvPs. */
    race: { on: true, windowMs: 1_800_000, minCapUsd: 10_000, gapRatio: 1.5, size: 2 },
    /* pump's opening cap in 15-19 Oct's first readings, the median. */
    openingCapUsd: 2_900,
    /* 17-19 Oct, readings at $15k or more: 469 readings of 213 coins had a pool under $1 (the most
       $0.27; "Kim" 5pwu…ZAV6 held $381,537 on $0.01 for three hours), and the next lowest was $473. */
    minLiquidityUsd: 100,
    tradeFeedFreshMs: 120_000,
    /* 10 bits is postCoin's same picture; 0.82 is the replay's "likely" picture. */
    picture: { maxHashDistance: 10, minSimilarity: 0.86 },
    /* The lookback: two days, the owner's word (19 Oct: "Rip Kim Jong-Un" was 17 h old when the
       posts he marked it right for came, its last reading 16 h stale and under the cap bar). Five
       coins a post at most: each is watched by the trade feed for an hour from the post; replayed
       on the 40 coinable posts the owner called on 16-19 Oct, the lookback added 4.6 a post. 50 of
       the market pass's 300 reads go to them, so the newest coins keep most of the bound. */
    existing: { readingWithinMs: 1_800_000, minCapUsd: 15_000, lookbackMs: 172_800_000, lookbackCoins: 5, readsPerPass: 50 },
    /* policy.v165 (the owner, 2026-10-24: "make sure I would've caught the right baldcat coin early
       before it took off"). The bar is the read-only replay's best under $20K (tools/sub20k-replay.ts,
       21-24 Oct, "climb 5x cap≥12K ≤30m link"): 12.7 picks a day, 9.3 on posts on For You before the
       coin, of which 5 ran past $50K and 23 died. $baldcat: taken at +8.8 min and $14.3K, against
       the live pick at +5.8 h and the launch push at $50K. Its reading must be one pass fresh (the
       market pass's own freshness). To everyone from the first ship (the owner: "ship it for everyone,
       let them decide whether they want to buy"), as a coin launch push: the same 15-a-day cap and
       quiet hours, once a coin. */
    early: {
      on: true,
      minCapUsd: 12_000,
      maxCapUsd: 20_000,
      lead: 5,
      fromMs: 120_000, // two minutes
      withinMs: 1_800_000, // half an hour
      rivalWithinMs: 3_600_000, // the watch: the hour before
      readingWithinMs: 480_000,
      push: { on: true, everyone: true },
    },
    perPass: { launches: 2_000, posts: 200, embeds: 20, subjects: 500 },
    refit: {
      everyMs: 604_800_000, // a week
      lookbackMs: 1_209_600_000, // two weeks
      minCases: 30,
      minCapsUsd: [5_000, 8_000, 15_000, 25_000],
      ratios: [2, 3, 5],
      minBuyers: [5, 10, 15, 25],
      truthAtMs: 3_600_000,
      truthMinCapUsd: 10_000,
    },
    /* The trade feed on the free plan (1M credits a month, about 33k a day; socket data billed
       2 credits per 0.1 MB, plan page read 2026-10-19). 20k a day is the owner's budget for it.
       20 MB a coin is 400 credits: a hot coin's hour on the curve at about 0.3 MB a minute, while
       the 19 Oct candidates' quiet curves cost a few kB each. History calls are counted at 10
       credits, an assumption on the safe side until the dashboard confirms the real rate. */
    tradeFeed: {
      on: true,
      coinCapBytes: 20_000_000,
      dayCapCredits: 20_000,
      billedBytes: 100_000,
      creditsPerBilledBytes: 2,
      creditsPerCall: 1,
      creditsPerHistoryCall: 10,
      openingLookupsPerDay: 300,
      truncatedLookupsPerDay: 300,
      maxCoins: 1_000,
      flushMs: 5_000,
      rereadMs: 10_000,
      probeEveryMs: 30_000,
      staleAfterMs: 75_000,
      reportEveryMs: 600_000, // ten minutes
      callTimeoutMs: 10_000,
    },
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
    scrollKeepMs: 259_200_000, // three days
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
    fypMaxAgeOn: true, // on 2026-10-14, the owner's call: For You's six hours again, $0
    feedBarCountsEveryReading: true, // on 2026-10-14, the owner's call: a first reading counts, $0
    watchMinReachPerMinute: 500,
    shortVideoReachScale: 12.5,
    /* Trending's floors, the owner 2026-10-18: 1h at 300. 6h and 24h from the 24 hours before, replayed
       hourly: 6h at 30 keeps a median 17 of 29 fresh posts with a trend (now 19 of 30); 24h at 10 keeps a
       median 10 of 11 (now 10 of 13). Fewer than 20 qualify because fewer than 20 posts have a trend at
       all, not because the floor is high. */
    forYouSorts: {
      freshMs: 1_800_000,
      minReadShare: 12,
      trendFloorsPerMin: [{ windowMs: 3_600_000, perMin: 300 }, { windowMs: 21_600_000, perMin: 30 }, { windowMs: 86_400_000, perMin: 10 }],
      /* The owner, 2026-10-18 (third design): 30 minutes now against the hour before, 1.15 times faster
         at least, over the 1h floor of 300 a minute; under 5 risers, filled to 10 with the 1h rule's
         picks. Half of each span read, and no gap over 20 minutes across the mark: the text source's
         older posts are read every 15 minutes, so one gap of 15 can cross it and still be a measurement. */
      risers: { nowSpanMs: 1_800_000, beforeSpanMs: 3_600_000, minCoverShare: 0.5, maxMarkGapMs: 1_200_000, minRatio: 1.15, floorPerMin: 300, fillBelow: 5, fillTo: 10 },
      mostViewedSpansMs: { today: 86_400_000, week: 604_800_000 },
      pageSize: 20,
    },
    shortVideoEarlyReach: 150_000,
    shortVideoEarlyWindowMs: 7_200_000, // two hours
    shortVideoFastReachPerMinute: 1_500,
    shortVideoFastWindowMs: 14_400_000, // four hours
    shortVideoSpeedBar: { enabled: true, earlyReach: 20_000, fastReachPerMinute: 250 },
    /* Off until the owner approves the cost; see RisingPolicy.speedBar for the replay. */
    /* On 2026-10-14: +$1.36 a day of judging, paid by fresh.cutStale's -$1.34. */
    /* forYouMinAgeMs, 2026-10-20, replayed read-only over 17-20 Oct (310 found X posts judged yes, kind
       not held, while under an hour old): at 15 minutes instead of 30, 45 of them join For You a median
       13 minutes sooner (p25 entry 31 -> 23 minutes), the same 256 join and no other; 10 of the 42 shown
       were tapped Not a meme, against 77 of 236 of all. $0: no read and no judge call changes. */
    speedBar: { enabled: true, horizonMs: 5_400_000, minAgeMs: 1_800_000, minReach: 15_000, recentMinSpanMs: 300_000, forYouMinAgeMs: 900_000 },
    narrativeMinPassingPosts: 2,
    /* 3 posts is where GROUP promotes a story; 8 posts, or a top post at 5M views (125 times
       the For You views bar), is a narrative most of the timeline has seen. */
    narrativeStages: { formingMinPosts: 3, bigMinPosts: 8, bigMinReach: 5_000_000 },
    boostMinSimilarity: 0.6,
    /* A "yes" up to a tenth under its bar: 0.60 on text or a picture, 0.65 with a video frame. */
    boostBarMargin: 0.1,
    /* 15 a pass, with a pass every minute or two: about 600 an hour. The ~2,100 posts judged in a
       day (2026-10-13) re-score in about 3.5 hours after a prompt change, near $0.70 an hour at
       the measured $0.0012 a post, on the live judge line and under its cap. */
    rescorePerPass: 15,
    /* 20 a pass, a pass every minute or two: the 2026-10-17 outage's ~460 passed posts in under an
       hour, at about $0.0004 a post on the kind line (Nemotron). */
    kindCatchUpPerPass: 100,
    scorePassBar: null,
    /* Replayed 2026-10-20 over For You's last 7 days (2,408 posts, 945 the owner called Not a meme),
       each post scored by the fit applied when it was first shown: no judge confidence, view bar or
       hourly cap kept 95% of the owner's memeable posts while cutting more Not a memes than memes;
       the junk fit alone did. Held out (5 folds), today's fit keeps 192 of 198 memeable posts under
       0.90 and 189 under 0.85 (95.5%), and cuts 21% and 33% of the Not a memes. On the 1,157 posts
       with a vector at admission: 319 a day to 292 (0.90) or 272 (0.85), every one of the owner's 27
       "this is the coin" posts kept, no post shown later. $0: the vectors are already stored. */
    junkBar: { on: true, keepShare: 0.95, keepGroups: ['gold', 'missed', 'meme'], minTested: 100 },
    /* 2026-10-15, launch-trailer day: 44 of For You's 60 were one game, most named for it. Measured on
       that frame, the posts about it under other names (its music, art, city) sat 0.60 to 0.75 from a
       game post, and every unrelated post's nearest neighbour 0.52 or less; one cast post at 0.58 stays
       its own topic. Three in twenty keeps a big topic on screen, not the screen. */
    varietyOn: true,
    varietyPerWindow: 3,
    varietyWindow: 20,
    varietySameMeaning: 0.844,
    authorShare: { on: true, perWindow: 2, window: 60 },
    /* Two batched reads of 50 a pass; 1,000 posts a day is at most $0.15 at $0.00015 a post. */
    refillPerPass: 100,
    refillPerDay: 1_000,
    refillMaxTries: 3,
    /* The text source's read by id quotes $0.00015 a post; the short-video source's quotes a full
       run (over $0.15), so only the first is asked for authors. */
    refillAuthorMaxUsdPerPost: 0.0005,
    /* 2026-10-16, three days of coin links: of 15,851 posts a coin named, 313 pass (309 text, 4 short
       video; about 100 a day), 98 of them judged yes and 84 not held by kind. 51 reached For You —
       25 before any coin named them, 26 after, the median 38 minutes after the link. Six hours is For
       You's own (`fypMaxAgeMs`), 5,000 the credit's (`finders.coinLinks.textMinApprovals`). */
    coinLinked: { on: true, maxPostAgeAtLaunchMs: 21_600_000, minApprovals: 5_000 },
    /* 2026-10-20, replayed read-only over 13-20 Oct: coins whose own link named a post we did not
       hold or had not judged, and that reached $15k in their first hour, came to about 115 a day;
       about 50 posts a day had no answer yet when their coin reached the bar (13 were never judged
       at all) and 11 a day were never read. 200 / 200 is room for four times that; at $0.00015 a
       read and the open judge's $0.00017 (the paid judge's $0.002 if it is primary) a full day of both is
       $0.06 ($0.43), the measured day about a cent ($0.10). Watch the pick's hour; admit within two. */
    /* `origin`, replayed 2026-10-20 over 17-20 Oct (tools/coin-origin-replay.ts, the walk itself, with
       345 posts read by id for $0.05): of 483 posts linked by coins that reached $15k, 35% are the
       viral post themselves, 38% point at an original (28% by one quote, 10% by two or three hops, a
       handful by link or repost) and 23% are launchers' posts with nothing to follow; of the 13 posts
       the route had put on For You since it went live that afternoon, 9 were such pointers. Three
       hops reach all but 1% of chains. The launcher bars: every account at 5 coined posts, half its
       posts and under 15,000 followers in the replay was a launcher (chieh128, Felixonchain,
       Sizeyon...); at 50,000 they took in accounts that post their own work (Sauers_, aizendyor).
       Reads: about 9 originals a day we do not hold, and for the first two days after deploy the held
       posts stored before their links were kept — 115 a day replayed, $0.02, well inside 200. */
    coinFirst: {
      on: true, fetchesPerDay: 200, judgementsPerDay: 200, perPass: 10, lookbackMs: 3_600_000, admitWithinMs: 7_200_000,
      origin: { maxDepth: 3, rereadLinks: true, launcherLookbackMs: 604_800_000, launcherMinLinkedPosts: 5, launcherMinLinkedShare: 0.5, launcherMaxFollowers: 15_000 },
    },
    /* 2026-10-16, read-only from here against the live database: the full frame's For You and Popular
       took 67 s (61 s of it weighing coins for every passing post), and the service's frames began
       five minutes apart that evening; a quick frame over 2, 5 and 30 minutes of changes (50, 84 and
       311 posts) took 1.1, 2.1 and 2.5 s, and its probe 20 ms. The answers came in 121 bursts in six
       hours and were quiet 92% of the time, so a ten-second settle seldom waits. */
    quickFrame: { on: true, checkEveryMs: 5_000, minGapMs: 20_000, settleMs: 10_000, kindsInSkipsWait: true },
    /* policy.v167, replayed read-only over 21-24 Oct: 24 For You posts (2 Popular) would have left
       (the @Infinitidigits promotion of @prtygal777's 6-day-old "Light Baby" among them); of 784 posts
       picked a coin, 239 were promotions: 136 originals take the coin, 19 older ones wait for it to run,
       2 of which did ($BI, $9daaq). No read, no judge call, no new spend. */
    promotion: { on: true },
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
    /* $25.50 from 2026-10-13 20:45 UTC: the judge sees the 10 closest labelled posts in every call
       (+$2.75 a day) and each judged post is embedded (+$0.90). Paid by moving $4 from the jobs and
       learning lines, which run well under them most days; the day stays $38. */
    /* $38 from 2026-10-13 21:40 UTC, the owner's call: the live feed's own ceiling is the whole $38 a
       day, so discovery, scoring and re-scoring never pause before it. The supplier lines below still
       warn at 80% and 95%. */
    /* $40.50 from 2026-10-16, with the owner's "whole day up to ~$50" for the two new lanes: the middle
       lane (feed.middle, its own $6) and the learned-tag lane (finders.learnedTags, its own $2) both
       spend inside this book and stop at their own caps first. Measured live days: $32.72 (10-14) and
       $31.88 (10-15) UTC; 10-16 was $14.70 by 08:30 UTC, heavier after midnight. With the lanes'
       expected $4.45 to $6.10 that is $36.30 to $38.80, and $40 at both lanes' caps. Paid by taking
       the learning book from $10.75 to $8.50 (its full days were $6.75 and $5.06; $10.38 on the
       re-tune-heavy 10-13) and the jobs book from $1.75 to $1 (nothing spent since 10-13), so live +
       learning + jobs is $50.00. Discovery is never cut to pay for learning (the owner, 2026-10-13).
       $43.50 from 2026-10-16 18:20 UTC for the view readings (feed.readings, its own $3.75 cap), the
       owner's option 1: about $49 measured for the whole day; the books' caps sum to $53 as headroom. */
    /* $48.50 on 2026-10-19 only (X ran over and the owner wanted the night running); back to 43.5 on the 20th. */
    /* $48.50 for 2026-10-20 only, the owner's yes: the short-video scraper's price rise spent the day by 16:20 London; back to 43.5 on the 21st, after DAILY_BUDGET_USD is. */
    dailyUsd: 48.5,
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
    /* actors $2 from 2026-10-14 (was $1): the owner approved up to $1 a day more on the scraping line
       for short-video searches every 15 minutes and more re-reads of young videos. */
    /* pictures $4.50 from 2026-10-14 (was $2), the owner's +$2.50: the live book spent $2.94 on
       them in the 24 hours to 11:30 UTC, so the $2 line warned every day without stopping anything. */
    /* secondVideo $2.50 from 2026-10-16: the short-video source's second vendor, measured at a credit
       ($0.00188) a request — the feed's trial $0.36 a day, re-reads ~$0.69, creator pages $0.45 and
       young re-reads $0.54, about $2.04 — and a quarter over it. The scraping lines stay as they were,
       since they carry the work whenever the second vendor fails. A warning line, as the others. */
    /* posts $14 and video $4.50 from 2026-10-16, for the two new lanes (warning lines, as the others):
       the text source's live search, re-reads and replies were $9.24 in the 24 hours to 08:30 UTC and
       the middle lane adds $2.75 to $3.45; the scraper's live runs were $3.22 and the learned-tag lane
       adds about $1.10. Each line is that and about a tenth, so the warnings mean something again. */
    /* embeddings was $6 and posts $24 on 2026-10-19 only (an outage catch-up, then X re-reads over the line); back on the 20th. */
    shortVideoFirstScraperOff: true,
    supplierLines: { posts: 17, judge: 10.5, video: 4.5, actors: 2, embeddings: 4.5, secondVideo: 2.5 },
    warnAt: [0.8, 0.95],
    /* $6: tonight's measuring and re-scoring had already spent $4.44 of the judge by 02:00 UTC. With the live $21 the day's total is $28, under the owner's $30; $7 lets the smaller-picture test run tonight. */
    /* $8.75 from 2026-10-13 05:30 UTC: $1.25 moved from the live posts line ($11.25 → $10; measured
       full-speed X is $5.72 a day) and $1 from the live judge ($8.50 → $7.50; measured $4.48), so the
       judge can be re-tuned on the live negative set today. The day stays $29.75. */
    /* $4.75 from 2026-10-13 07:00 UTC, with the learning work moved to its own $4 line below. Live
       $21 + jobs $4.75 + learning $4 = $29.75 a day, under the owner's $30. */
    /* $1 from 2026-10-16 (was $1.75), toward the live book's $40.50: the jobs book has spent nothing
       since 2026-10-13. Live $40.50 + learning $8.50 + jobs $1 = $50, the owner's day. */
    jobLines: { dailyUsd: 1, posts: 0.25, judge: 0.5, video: 0.125, embeddings: 0.125 },
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
    /* $8.50 from 2026-10-16 (was $10.75), toward the live book's $40.50 for the two new lanes: its full
       days were $6.75 (10-14) and $5.06 (10-15); two re-tunes a day at a $1.45 baseline and a ~$3 worst
       case each still fit ($8.90 only if both hit their worst case, and then the second test waits). */
    /* The reserve and the tests' line from 2026-10-16 (the owner). Sized at the open model's prices,
       since the re-tune runs on it alone: a run grades about 700 posts twice (new block and live) at
       40 precedents: measured $0.00032 a post for both questions (2026-10-16, 20 posts), so about 860
       posts a side cost about $0.28 a side, $0.56 a run with the rulebook's one call ($0.0016), and a
       side must fit its pessimistic estimate (about $1.40) before it starts. $2.50 holds two runs a
       day with the second's estimate still fitting. Tests and experiments: $1 a day, every vendor. */
    /* $10 for 2026-10-16 only, the owner's +$1.50 for the evening re-tune on the open model. */
    learningLines: { dailyUsd: 10, posts: 1.5, judge: 5.75, video: 0.5, embeddings: 0.75, retuneReserveUsd: 2.5, testsUsd: 1 },
    ledgerRefreshMs: 60_000,

    /* Both on, because the owner's binding constraint is money. `paidOnlyWhenFreeIsEmpty`
       is the one with a coverage cost, stated on its field, and is the first thing to
       turn off the day the constraint becomes coverage instead. */
    freeSourcesFirst: true,
    paidOnlyWhenFreeIsEmpty: true,
  },

  /* The namer (NamesPolicy). Off until the owner switches it on. Measured 2026-10-14 on 271 held-out
     posts (tools/name-guess-eval.ts): $0.00158 a post with its picture, so ~2,400 posts a day over
     the bar is ~$3.80 a day on the judge's line, ~$0.70 with `feedOnly` (~450 feed posts a day).
     The real coin's name or ticker in the first five guesses: 72% against the judge's names' 40%. */
  names: {
    /* On 2026-10-14 for For You and Popular only (the owner: "~$0.70/day"), watched for its first day. */
    on: true,
    /* Off (the owner's safety net, 2026-10-14): a coin found only through a guessed name stays in
       "See N coins" and is never a card's coin until the gate passes. */
    cardsFromGuesses: false,
    k: 10,
    sameSourceFirst: 0, // off until the owner switches it on; 5 is the proposal (see NamesPolicy)
    guesses: 5,
    createIdeas: 3,
    perCall: 10,
    openPerCall: 1,
    openParallel: 4,
    perPass: 40,
    examplesPerPass: 60,
    maxChars: 300,
    exampleChars: 160,
    maxOutputTokens: 2_000,
    /* "Pringles" for "Pringle", "GTA6" for "GTA 6": one letter apart in a word of five or more. */
    closeSpelling: { minChars: 5, maxEdits: 1 },
    maxTickerChars: 10,
    windowMs: 21_600_000, // six hours
    feedOnly: true,
    watch: { hours: 24, minWrong: 1 },
  },

  translate: {
    /* On from 2026-10-14, the owner's yes: about $0.01 a day at that day's mix (tools/translate-backfill.ts). */
    on: true,
    perCall: 10,
    perPass: 20,
    maxChars: 600,
    maxOutputTokens: 3_000,
    windowMs: 21_600_000, // six hours
    /* policy.v176, the owner's yes (2026-10-25): about 50 posts a day join a shown narrative in a
       language other than English and are on no feed (330 over the week to then), at the translate
       line's measured ~$0.0014 a post, about $0.07 a day; the week behind it once, about $0.45. */
    narrativesWindowMs: 604_800_000, // seven days
    minLetters: 2,
    englishCodes: ['en'],
    /* 'zxx' no linguistic content, 'und'/'un' undetermined, 'qme' media only, 'qam' mentions only, 'qht' hashtags only, 'qst' very short, 'qct' cashtags only. */
    noWordsCodes: ['zxx', 'und', 'un', 'qme', 'qam', 'qht', 'qst', 'qct'],
  },

  narrative: {
    on: true,
    everyMs: 120_000,
    windowMs: 172_800_000, // two days, the board's own window
    /* The day of 2026-10-16 held 1,900 judged-yes posts with a vector in two days; the pass compares
       every pair in memory (about 2 s at 1,500). */
    maxPosts: 1_500,
    /* 30 of the 594 good posts had no vector on 2026-10-16; a post with its picture is about 1,500
       tokens at $0.12 a million, so a full pass of 25 is under half a cent. */
    embedPerPass: 25,
    /* Off, the owner's to turn on: on 2026-10-16 38 of the board's 48 narratives were built from such
       posts, and 1,148 of the two days' judged-yes ones had no vector — about $0.10 a day to embed. */
    searchedPosts: true, // the owner, 2026-10-16: in, if they pass the judge like every other post
    /* 0.7 (a shared topic word or picture), `nameMeaning` 0.6 (a shared name) and `mergeMeaning` 0.7
       from 2026-10-18 (tools/narrative-tune.ts: the two days' 1,500 good posts replayed with no pins
       and none of the owner's calls). At 0.6 / 0.6 / 0.55 the two biggest groups held 277 and 263
       posts ("France protests and cat memes"), 28% of a narrative's posts carried its most common
       name, and 1,780 links were a shared topic word alone; now the biggest is 29, 67% carry its
       name, 147 links are a topic word, 1 of the 43 post pairs the owner called Not a narrative is
       still grouped (as before), and 245 of the 251 same-name pairs from different accounts at 0.75
       or closer join (242 before: the blobs' drift step pushed some out). `nameMeaning` 0.65 is a
       little purer (0 of 43, 248 of 251) but loses the text post and short video of one story at
       0.64 (GTA 6), so it stays 0.6. */
    sameMeaning: 0.866,
    nameMeaning: 0.844,
    maxGapMs: 86_400_000, // a day: an old story and a new one with the same word stay apart
    maxSpanMs: 172_800_000, // two days
    minLinkShare: 0.5,
    /* Measured 2026-10-16 on the first dry run's 51 groups, each part's posts against the other part's
       average: the parts of one story 0.55 to 0.79 (the Roadster's dozen parts 0.65–0.73 from its
       biggest, GTA 6's 0.55–0.75, the Bend shooting hero's two 0.60); different stories at most 0.49
       (GTA 6's posts from the Roadster's average). Averages against averages do not separate them: a
       big group's average drifts toward the feed's, and GTA 6 and the Roadster read 0.56 that way. */
    mergeMeaning: 0.866,
    minPosts: 2,
    minAccounts: 2,
    /* Measured 2026-10-18 on the 436 open narratives' stored posts: every pair 0.8 or closer with the
       same most common name was one story told twice (Neo the raccoon three times, Comet the deer
       three, Gus, Konasu, GTA 6's own pages at 0.68 were left apart as the cautious side); pairs as
       close with different names were not (0.99 "AI agents" beside "Nakama": a shill's words read
       alike whatever they are about). So the name decides and the meaning only confirms. */
    same: {
      on: true,
      meaning: 0.877,
      nameShare: 0.34,
      lookbackMs: 604_800_000,
      minNameChars: 3,
      genericNames: ['cat', 'cats', 'dog', 'dogs', 'kitten', 'kitty', 'puppy', 'pepe', 'doge', 'frog', 'bear', 'monkey', 'penguin', 'raccoon', 'hippo', 'viralcat', 'viraldog', 'catcoin', 'dogcoin', 'elon', 'musk', 'trump', 'tesla', 'france', 'french'],
    },
    single: { on: false, minReach: 500_000, minPerMinute: 2_000, growthWindowMs: 3_600_000, growthMinSpanMs: 1_200_000 },
    /* Five minutes over the day, 288 numbers a page: the phone's finest chart interval is 5m, and it
       adds these up into 15m, 1h, 4h and 1D. */
    /* "All" in half-hours: two days at most is 96 numbers a page. */
    reach: { stepMs: 300_000, spanMs: 86_400_000, gainWindowMs: 3_600_000, allStepMs: 1_800_000 },
    trend: {
      windows: [
        { ms: 3_600_000, ageMs: 86_400_000 }, // 1h: one off a day old
        { ms: 21_600_000, ageMs: 172_800_000 }, // 6h: one off two days old
        { ms: 86_400_000, ageMs: 345_600_000 }, // 24h: one off four days old
      ],
      reachWeight: 1,
      speedUpWeight: 0.5,
      speedUpMaxDoublings: 3,
      speedUpEven: 5_000,
      postWeight: 0.6,
      breadthWeight: 0.5,
      bothSourcesBoost: 0.3,
      coinCapWeight: 0.3,
      coinCapMaxGrowth: 4,
      coinBuyWeight: 0.2,
      ageWeight: 1,
      ageMaxUnits: 3,
      keepAgeing: 0.5,
      /* policy.v157, uncalibrated: a doubling of viral accounts is worth a bit more than a doubling of
         posting accounts (`postWeight`), and a viral post in every sixth of the window is worth a
         tenfold of views gained — big enough that a war posting viral posts all day stays near the
         top, small beside a story gaining a hundred times the views. tools/trending-backtest.ts
         replays it. */
      viralWeight: 0.8,
      steadyWeight: 1,
      steadySlots: 6,
      /* policy.v166. 24 Oct 13:00, the live pages: 11 of 71 had two viral posts or more in their 24 hours
         (counted by post — accounts were not on the page yet; France vs Japan 8, a mustached newborn 5,
         the Oregon father 4), while 2 of the 71 had speeds for the tab's Trending at all. */
      listMinAccounts: 2,
      listWindowHours: 24,
    },
    /* About 600 input and 20 output tokens a call on the open model: $0.00006, under a cent a day. */
    title: { on: true, perPass: 10, retitleGrowth: 0.5, postsSent: 6, maxChars: 240, maxOutputTokens: 40, maxTitleChars: 60 },
    /* 2026-10-18 on live data, read-only: 9,251 judged-yes posts went up between seven and two days
       back (0.2 s by the judged-time index). The step took 1.4-2.2 s on a pass that read them and
       0.13-0.15 s on the passes between, beside the pass's own 3-8 s; 16 of 109 narratives were given
       early posts, 417-432 in all, the Roadster 196 (its first post Wednesday 14:47, not Saturday
       13:30). Free: stored rows and stored vectors, nothing embedded. */
    early: {
      on: true,
      lookbackMs: 604_800_000, // seven days, the owner's
      refreshMs: 1_800_000, // half an hour
      maxArchive: 15_000,
      perPass: 30,
      maxVectorsPerPass: 1_500,
      maxPerNarrative: 200,
    },
    /* On from 2026-10-18 (the owner). On 18 Oct the narrative pages named 8 coins, none with a chain
       time; 99 to 245 narratives were first shown a day (16-18 Oct) and about 8 in 100 name a coin,
       so about 8 to 20 new coins a day, one call each: 8 calls on the first pass, then about 8-20
       calls a day. `perDay` 100 is the worst case a day (plus 100 more on each restart, which
       starts the count again); a coin's history length never changes it. */
    launchClock: { on: true, perPass: 20, perDay: 100 },
    /* The owner's 48 hours. 25 pages a frame: the frame projects at most 200 narratives in full, so
       25 more is an eighth on top; at a frame a minute, 1,500 older narratives are each re-read
       about once an hour. */
    dead: { afterMs: 172_800_000, pagesPerFrame: 25, pageSize: 20 },
    /* On from 2026-10-18 (the owner): 3 posts or more, once a narrative, seven days back, three
       pages, its own $0.50 a day apart from the forward name search's $0.35. 99 to 245 narratives
       were first shown a day (16-18 Oct) and about half reach 3 posts (52 of 107 live on 18 Oct).
       An ask is at most three pages of 20 at $0.00015 a post returned ($0.009) and its new posts
       judged at $0.00145 x 0.9 (at most $0.078), so at most $0.087 a narrative; a name before its
       story began finds few posts at 1,000 likes, about $0.01-0.03 a narrative, so the $0.50 is
       spent on the busiest days and the smallest wait to the next. Two days, not one hour, so a
       narrative that reaches 3 posts on its first or second day is asked, and the ones live when it
       was switched on (the Roadster, first shown 16 Oct) are asked once. */
    /* OFF from 2026-10-20, with the quote search: it searches before a narrative's first post, so
       nothing it finds can come before that post's coin, and it spends its whole day in the first
       minutes after 00:00 UTC ($0.47 by 00:08 on 2026-10-20). Its search part is ~$0.05 to $0.12 a
       day (most of its ledger is the old judge price on its new posts). What is lost: a narrative's
       older first post, when no other lane held it. One switch to bring back. */
    backSearch: {
      on: false,
      minPosts: 3,
      formedWithinMs: 172_800_000, // two days
      lookbackMs: 604_800_000, // seven days
      maxPagesPerAsk: 3,
      perPass: 10,
      cap: { dailyUsd: 0.5, judgeUsdPerPost: 0.00145, judgedShare: 0.9 },
      passDeadlineMs: 120_000,
    },
    /* ── narrative.origin: the starting post and one story across languages (policy.v143) ── */
    origin: {
      on: true,
      lookbackMs: 604_800_000, // seven days before the narrative's first post, as the early posts
      maxHops: 2,
      linkMeaning: 0.787,
      nameAverage: 0.844,
      maxPerNarrative: 5,
      mergeOn: true,
      formedWithinMs: 43_200_000, // twelve hours
      mergeMeaning: 0.844,
      minLinkPosts: 3,
      liveMs: 172_800_000, // two days, the board's window
      perPass: 400,
      viralFloor: true, // the owner, 2026-10-23: never a narrative of small posts
      /* ── policy.v145: the quote root, the loose posts' join and the pasted posts (the Vegeta war) ── */
      rootOn: true,
      rootMinQuoters: 2, // two of its posts quote it: one quote of a big post is a comparison, not a start
      rootMeaning: 0.709, // @liistrk's words-only post is 0.36 from the picture posts answering it
      joinOn: true,
      joinViral: true, // only a post that clears For You's views bar joins by a quote or the same words
      joinPerNarrative: 20,
      phraseMinChars: 4,
      phraseMinCjkChars: 2,
      phraseMaxShare: 0.005, // said by at most 1 post in 200 of those read
      phraseMeaning: 0.844, // the regroup's own shared-name bar (`nameMeaning`); @rayaneAlg00 is 0.66
      missedJudge: true, // one live judge call a pasted post, about $0.0015
      missedLookbackMs: 604_800_000, // seven days, as the early posts
      /* ── policy.v149: the merge on the story's own words (the Yotsuya goats) ──
         Replayed 2026-10-23 over five days (tools/narrative-origin.ts, 748 live narratives): with no
         share-of-posts bar, 28 merges, most wrong — generic pairs ("500k·views", "check·comments")
         that one post of a 266-post blob says pulled a dozen stories into it. With `wordsMinCoverage`
         0.34: the goats alone, on two words. At 0.25: the goats (ツ谷 ヤギ 四ツ 谷駅 除草, alike 0.78) and
         "GTA 6 Release Could Cost Billion" into "Grand Theft Auto VI Release Approaches" (0.76, the
         same $1B story is already in the bigger one). At 0.2, two more, both one story. 0.25 kept. */
      wordsOn: true,
      wordsMinShared: 2, // two rare words between them (the goats share five)
      wordsMaxNarratives: 3, // a word four live stories say marks none of them
      wordsMinCoverage: 0.25, // said by a quarter of each side's posts: its own word, not one post in a blob
      wordsMeaning: 0.844, // the merge's own bar (`mergeMeaning`); the goats are 0.78, every replayed merge 0.69 or more
      wordsFormedWithinMs: 345_600_000, // four days
      /* policy.v166: the loose post's single rare words (the Nara fawns). Copy-tested read-only on the
         stored posts of 22-24 Oct: see the commit. Only a short list of the same thing said another way. */
      looseWordsOn: true,
      /* Below the phrase bar: a post in another language reads far from a narrative in English (@hezuruy
         0.41 from the fawns' average). The name the two must share keeps it safe — copy test of 22-24 Oct,
         93 loose viral posts sharing two rare words: with a shared name 21, and at 0.41 or closer 13, the
         nearest wrong ones at 0.403 ("Florida" + "hospital") and 0.402 (a streaming site + "streamer") left out. */
      looseWordsMeaning: 0.76,
      wordStems: { fawn: 'deer', deers: 'deer' },
    },
    /* ── narrative.fight: online meme wars between countries (policy.v154) ──
       Fields: on, activeMs, perPass, maxCountries, minPosts, maxOutputTokens. The question rides on the title call, a few
       hundredths of a cent each; `perPass` bounds the one-time catch-up of narratives titled before. */
    fight: {
      on: true,
      activeMs: 604_800_000, // seven days, the owner's "active in the last week"
      perPass: 10,
      maxCountries: 4,
      minPosts: 3,
      maxOutputTokens: 100,
      /* policy.v157. Free: stored posts and their stored counts, no search and no judge call; a seed is
         one title call (~$0.00006). Measured 2026-10-24 on the stored posts of the 8 days before, at
         40k views (For You's bar, `rising.fypMinReach`): French naming Japan 0-1 a day, then 10 posts
         from 9 accounts on 23 Oct (the war); Chinese naming Turkey 1-2 a day, Turkish naming China
         0-1; Japanese naming France 4, 40 (the riots, 18 Oct) and 7. So three posts from three
         accounts in a day seeds, and the titler decides whether it is shown. */
      native: {
        on: true,
        minReach: 40_000,
        lookbackMs: 172_800_000, // two days, the regroup's window
        maxRead: 2_000,
        perPass: 100,
        /* policy.v166. The catch-up read, measured 2026-10-24: five days of stored posts, the live wars'
           words pre-matched in the database, 120 rows in 0.95 s — so every ten minutes, not every pass. */
        catchUpEveryMs: 600_000,
        warLeadMs: 172_800_000, // two days, the regroup's window
        moveMaxPosts: 3,
        /* policy.v169. Free: stored posts, their stored quotes and links. Replayed read-only 2026-10-24
           over 7 days: France vs Japan gains 1 post (the 4.9M Japanese Vegeta answer, as early), China
           vs Turkey none (its Chinese quote of a Turkish post, 8.9M, was in already). 0.4-0.9 s a read. */
        answersOn: true,
        seedMinPosts: 3,
        seedMinAccounts: 3,
        seedWithinMs: 86_400_000, // a day
        seedMaxPosts: 30,
        pendingPerPass: 5,
        /* policy.v175: es, pt and ar are this week's wars' sides (Argentina, Brazil, Saudi Arabia and
           Egypt), though each is spoken in many countries; a post in one still joins only a live war
           holding both countries of its pair, and Arabic (two homes) seeds only a pair of `named`. */
        home: { fr: 'France', ja: 'Japan', zh: 'China', tr: 'Turkey', ko: 'South Korea', ar: ['Saudi Arabia', 'Egypt'], es: 'Argentina', pt: 'Brazil', vi: 'Vietnam' },
        /* policy.v175, measured 2026-10-25 on X: the Japanese side of France vs Japan is mostly 5k-40k
           views, the French side 40k-2.9M. Joins only; a seed still needs `minReach`. */
        minReachByLang: { ja: 5_000 },
        names: {
          fr: { Japan: ['japon', 'japonais*', 'japonnais*'], China: ['chine', 'chinois*'], Turkey: ['turquie', 'turc', 'turcs', 'turque', 'turques'], 'South Korea': ['corée', 'coréen*'] },
          /* policy.v169 (the owner, 2026-10-24): "French people" as Japanese writes it, in katakana
             and in the old kanji short form, and France in kanji. フランス人 holds フランス, so the join
             matched it already; it is here for the words search, which asks a word as written. Not
             仏 alone: on 14-24 Oct its 18 stored Japanese posts were news (仏で, 仏大統領, 仏独合意) and
             Buddhism (神社仏閣, 仏滅), none the war. Not おフランス: it holds フランス too. */
          ja: { France: ['フランス', 'フランス人', '仏人', '仏蘭西'], China: ['中国'], Turkey: ['トルコ'], 'South Korea': ['韓国'] },
          zh: { Turkey: ['土耳其'], Japan: ['日本'], France: ['法国', '法國'], 'South Korea': ['韩国', '韓國'] },
          tr: { China: ['çin', 'çinli*', 'çince'], France: ['fransa*', 'fransız*'], Japan: ['japonya*', 'japon', 'japonlar*'], 'South Korea': ['kore*'] },
          ko: { Japan: ['일본'], China: ['중국'], France: ['프랑스'], Turkey: ['튀르키예', '터키'], Vietnam: ['베트남'] },
          /* policy.v175, this week's wars. An Arabic post naming Egypt pairs it with Saudi Arabia (one
             of Arabic's homes); no Saudi Arabia–Egypt war is live, so it joins nothing, and the pair is
             not in `named`, so it seeds nothing. */
          ar: { Argentina: ['الأرجنتين*', 'الارجنتين*'], Brazil: ['البرازيل*'], Egypt: ['مصر*', 'المصري*', 'المصريين'], 'Saudi Arabia': ['السعودية', 'السعودي*', 'سعودي*'] },
          es: { 'Saudi Arabia': ['saudí*', 'saudi*', 'arabia saudita', 'árabe*', 'arabe*'] },
          pt: { Egypt: ['egito', 'egípcio*', 'egipcio*'] },
          vi: { 'South Korea': ['hàn quốc', 'người hàn', 'hàn xẻng'] },
          /* No home: a post here must name two of a war's countries and be alike to the war (policy.v166). */
          en: { France: ['france', 'french', 'frenchies'], Japan: ['japan', 'japanese'], China: ['china', 'chinese'], Turkey: ['turkey', 'turkish', 'türkiye', 'turkiye', 'turks'], 'South Korea': ['korea', 'korean*'], 'Saudi Arabia': ['saudi*', 'ksa'], Argentina: ['argentin*'], Brazil: ['brazil*', 'brasil*'], Egypt: ['egypt*'], Vietnam: ['vietnam*', 'viet'] },
        },
        /* policy.v175 (the owner, 2026-10-25), measured on X that day (lang:ja, 3 days, 50+ likes):
           フランス alone returned 2 war posts in 20 (the rest figure skating, badminton, riot news);
           アルジェリア returned 20 in 20 — the war began with the French "Vegeta is Algerian" joke and
           the Japanese side answers about Algeria. ベジータ alone is half Dragon Ball merchandise, so
           only beside アルジェリア. */
        phrases: { 'France|Japan': { ja: ['アルジェリア人', 'ベジータ アルジェリア', '日仏', 'フランス人 日本人', '悪口合戦', 'レスバ'] } },
        /* policy.v175: the wars the owner named on 2026-10-25, searched before a narrative holds them. */
        named: [['Saudi Arabia', 'Argentina'], ['Brazil', 'Egypt'], ['Vietnam', 'South Korea']],
        aliases: { 'Türkiye': 'Turkey', Turkiye: 'Turkey', Korea: 'South Korea', 'Republic of Korea': 'South Korea', PRC: 'China', "People's Republic of China": 'China', KSA: 'Saudi Arabia', Saudi: 'Saudi Arabia', Brasil: 'Brazil', 'Viet Nam': 'Vietnam' },
      },
    },
  },

  /* The owner approved switching on what fits on 2026-10-15 ("approve and switch on when ready"),
     inside the live book's $38 with about $1.60 a day left: the coin links (about $0.65 a day at the
     judge's measured $0.002 a post, $1.32 at a cautious $0.0088), the reposts (about $0.15, $0.40)
     and the learned list (free). The rest stay off and are in the report with their cost. */
  finders: {
    coinLinks: {
      on: true,
      everyMs: 5_000,
      lookbackMs: 600_000, // ten minutes
      perPass: 40,
      concurrency: 8,
      readsPerPass: 10,
      creditMaxAgeMs: 259_200_000, // three days
      /* 5,000: about 61 coined X posts a day we did not already have clear it (48 hours to 2026-10-15
         17:00 UTC), against 119 at 1,000 — half the judging, inside the room left on the live book. */
      textMinApprovals: 5_000,
      /* policy.v155: For You's own views bar (`rising.fypMinReach`). 3 days to 24 Oct: 564 coin-named X
         posts had 40k+ views and no lane; 337 were judged anyway (113 yes), so about 76 a day more are
         judged — two questions at the open judge's ~$0.0003, about $0.02 a day. @TocRadio was one. */
      textMinReach: 40_000,
      /* 2026-10-16, three days: 144 posts `rising.coinLinked` passes had no answer yet when the link
         was recorded, about 50 a day, a few in the busiest minute; at the open judge's $0.00017 a
         post, under a cent a day with the kind question. */
      instant: { on: true, perMinute: 6, lookbackMs: 600_000, frameTries: 5, frameTriesOverMs: 600_000 },
    },
    reposts: {
      /* On from 2026-10-15: over 3.7 days of held X posts climbing fast, 22,774 short links led to
         120 different TikToks, about 32 a day to read at $0.004. None was one of that week's coined
         TikToks before its coin, so its lead is not shown yet; it is on because it is cheap. */
      on: true,
      everyMs: 300_000, // five minutes
      maxAgeMs: 21_600_000, // six hours
      minApprovalsPerMinute: 3,
      linksPerPass: 300,
      concurrency: 10,
      readsPerPass: 10,
      creditMaxAgeMs: 172_800_000, // two days
    },
    trends: {
      on: false,
      /* Daily, not hourly: the trend data is daily and about two days behind (read 2026-10-15 17:00
         UTC, its newest point was 2026-10-13), so an hourly read buys the same list 24 times. */
      everyMs: 86_400_000,
      regions: ['US', 'GB'],
      perKind: 10,
      asksOn: false,
      askEveryMs: 900_000, // fifteen minutes
      wordsPerAsk: 2,
    },
    learned: {
      on: true,
      everyMs: 86_400_000, // daily
      lookbackMs: 604_800_000, // a week
      minPosts: 2,
      topTags: 10,
      topSounds: 5,
      topCreators: 20,
      skip: ['fyp', 'foryou', 'foryoupage', 'fypシ', 'viral', 'trending', 'xyzbca', 'parati', 'original sound'],
    },
    /* On from 2026-10-16 with the money the re-reads' move saved (the owner: "spend the savings on
       creators with coined posts checked more often"): a creator's latest page is one credit on the
       second vendor, so 5 every half hour is 240 credits, $0.45 a day, and each of the 11 learned
       creators is checked about every 66 minutes; about 40 new videos a day to judge, ~$0.08. */
    creators: {
      on: true,
      askEveryMs: 1_800_000, // half an hour
      perAsk: 5,
      postsPerCreator: 3,
    },
    /* On from 2026-10-16, the same approval ("videos under 2 hours re-checked more often"): the 2
       fastest videos under two hours re-read every 10 minutes on top of the half-hourly re-reads, 288
       credits, $0.54 a day. 2, not 4: 4 would be $1.08 and the live book has about $1.60 left. */
    young: {
      on: true,
      maxAgeMin: 120,
      runEveryMinutes: 10,
      maxPosts: 2,
      /* On from 2026-10-16 under the same approval (young videos re-read more often). Measured over the
         24 hours to 00:40 UTC: 131 of 719 videos found were under an hour old when found, and of the 17
         found under 20 minutes only 8 had a reading between 20 and 60 minutes. A reading at 6 and at 50
         minutes for each video found by then is about 140 credits, $0.26 a day. */
      atAges: { on: true, ages: [6, 50], maxPosts: 10 },
      /* Off until the owner approves the cost. Measured over 24 hours: of 1,415 found videos, 303 had
         5,000 views or more before four hours and only 64 of them were read between four and six hours;
         at 20,000 views, 90 a day. One reading at five hours for those is 90 credits, $0.17 a day, and
         about 20 more judged ($0.04). */
      late: { on: false, ageMin: 300, minReach: 20_000, maxPosts: 10 },
    },
    /* On from 2026-10-16, the same approval ("learned hashtags and sounds"): 2 sounds an hour, at most
       48 credits ($0.09) a day. The learned list holds no sound yet (none is on two coined videos this
       week), so today it asks nothing. */
    sounds: {
      on: true,
      askEveryMs: 3_600_000, // hourly
      perAsk: 2,
    },
    trending: {
      /* Off until the owner approves the cost and 0084 is applied. Measured 2026-10-15 19:21 to 23:14
         UTC, 19 pages (US and GB, every 15 minutes): 199 different videos, 11 to 14 new on a page of
         about 16, a median 35 days old; 12 under six hours, 7 of those already past 100,000 views
         (a 763k-view video at 4.2 hours, BBC News at 2.7 hours), and our own searches held 1 of the
         199. At this cadence it is 192 pages a day, $0.36 at the dearer credit pack, and about 70
         young videos a day for the judge ($0.14 at $0.002 a post) — about $0.50 a day in all.
         On from 2026-10-16 00:16 UTC as the owner's approved 3-day trial (to 2026-10-19 00:16 UTC);
         at the trial's end it stays only if it found coined videos earlier than the searches did. */
      on: true,
      everyMs: 900_000, // fifteen minutes
      regions: ['US', 'GB'],
      creditMaxAgeMs: 21_600_000, // six hours
    },
    /* On from 2026-10-16, the owner's approval ("newest-first search on learned hashtags, ~$2/day").
       On the first scraper's newest-first search actor, the one the watch list uses, not the second
       vendor's keyword search: measured 2026-10-16 the second vendor's "date-posted" search gave
       "meme" videos 3 to 95 hours old (none under an hour) where the actor brings 15 to 24 under two
       hours a word, so a young video costs the actor about $0.0005 and the second vendor several
       credits ($0.00188 each) or nothing at all. So the second vendor's credits are not spent here.
       3 words a half-hour: 144 runs a day, quoted at $0.0137 a run ($1.97) and billed about $0.0076
       (the watch list's 143 runs in the 24 hours to 08:30 UTC cost $2.40 for about 315 words), about
       $1.10. Judging: the watch list's new videos were judged 179 of 1,079 that day (0.17, 0.2 kept)
       at $0.0017 a video; 700 to 2,200 new videos a day is $0.25 to $0.75. About $1.35 to $1.85 a
       day, stopped at $2. The 08:03 UTC re-tune of 2026-10-16 learned meme, animals, cat, memecut,
       blowthisup, dachshundpuppy and dancing; meme is the owner's own word and is left to the watch
       list, so today 6 tags, each searched every hour. Up to 10 as the set grows, every 100 minutes. */
    learnedTags: {
      on: true,
      askEveryMs: 1_800_000, // half an hour
      topTags: 10,
      wordsPerAsk: 3,
      cap: { dailyUsd: 2, judgeUsdPerPost: 0.0017, judgedShare: 0.2 },
    },
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

  /* Off until the owner's yes. A slimmed post had about 9 readings besides its first ones (12–18
     Oct), so a batch of 500 is ~4,500 rows and one DELETE of at most 5,000 usually finishes it; 40
     batches is 20,000 posts, a day of them and more, per hourly run. */
  slim: {
    on: false,
    afterMs: 604_800_000, // 7 days
    postsPerBatch: 500,
    rowsPerStatement: 5_000,
    batchesPerRun: 40,
    lockTimeoutMs: 2_000,
    statementTimeoutMs: 30_000,
  },

  /* 30 days, the owner's: past every reader of a coin's vector (the origin check reads it for a week).
     A day of coin vectors is ~12,000 rows of ~6 KB, so 1,000 a statement is a few seconds. */
  coinVectors: {
    keepMs: 2_592_000_000, // 30 days
    partBytes: 40 * 1024 * 1024,
    rowsPerRead: 1_000,
    rowsPerDelete: 1_000,
    daysPerRun: 3,
    lockTimeoutMs: 2_000,
    statementTimeoutMs: 30_000,
    /* On: the origin check needs a coin's own vector only until its check settles, which the rule
       waits for. On 16 Oct, of 11,430 pictured coins, 2,813 were read an hour or more after launch
       and showed no trade, 1,310 had traded, 7,307 had no reading after their hour — hence the reads. */
    untraded: {
      on: true,
      afterLaunchMs: 3_600_000, // an hour
      /* 2%: the dollar against the chain's coin rarely moves more in an hour; a 0.1-unit buy on a
         fresh curve moves its cap by about 0.7%, so a trade that size or smaller reads as none. */
      flatWithin: 0.02,
      rowsPerRun: 20_000,
      /* Fourteen days: twice the origin check's week, so a run missed for days still decides them. */
      decideWithinMs: 1_209_600_000,
      /* ~500 pictured coins an hour at the busiest, a market pass every five minutes: ~42 a pass. */
      readsPerPass: 100,
      readWithinMs: 21_600_000, // six hours after the hour
    },
  },

  /* Sized from 2026-10-21's volumes (tools/post-pics.ts status --sample 60): 675 new shown
     pictures a day over the week before (280 to 1,002), and 3,877 shown pictures whose links still
     loaded for the one backfill (344 had already expired). 54 KB a picture for both copies on
     average (79 KB a short-video cover), so ~35 MB a day, ~1 GB a month and ~200 MB for the backfill —
     inside the plan's 100 GB of files (`store.bill.storageIncludedGb`); over it, $0.0213 a GB-month. */
  postPictures: {
    on: true,
    /* 40 a pass every two minutes is 28,800 a day: a busy hour's ~100 new pictures are copied
       within a few passes, before any short-video link expires (they are signed for about a day). */
    perPass: 40,
    /* Three times the busiest day measured; the backfill reaches it on its first day and finishes
       the next, the short-video covers (which expire) first. */
    perDay: 3_000,
    concurrency: 6,
    /* The logo job's lane is shared: the logos take about 50 s, the faces at most 30. */
    budgetMs: 30_000,
    /* The largest shown picture measured was 0.8 MB; an X picture at full size can reach a few. */
    maxBytes: 8 * 1024 * 1024,
    /* 360: the size the cards already ask the X host for (mobile picture-size.ts). 1080: the
       sheet's picture across a phone at three pixels a point. */
    cardPx: 360,
    sheetPx: 1080,
    quality: 80,
    retryAfterMs: 21_600_000, // six hours
  },

  /* The owner, 2026-10-18: let the disk grow past 8 GB, tell me at 80% and when the bill heads over
     $40. The grow rule and prices are the host's published ones on that day: at 90% full the disk
     grows by half, at most once in 4 hours and 4 times a day; disk over 8 GB is $0.125 a GB-month of
     PROVISIONED size; files over 100 GB $0.0213 a GB-month. Egress is not modelled: no SQL reads it. */
  store: {
    disk: {
      on: true,
      everyMs: 3_600_000, // hourly
      provisionedGb: 8,
      growAt: 0.9,
      growBy: 1.5,
      growGapMs: 14_400_000, // 4 hours
      growsPerDay: 4,
      alertAt: 0.8,
      rearmBelow: 0.75,
      announceWithinMs: 10_800_000, // 3 hours
      growthDays: 7,
    },
    bill: {
      on: true,
      planUsd: 25,
      /* TO CONFIRM BY THE OWNER: the audit inferred the Medium compute size ($60 a month) less the
         plan's $10 compute credit. Not read from the host; computeConfirmed stays false until he says. */
      computeNetUsd: 50,
      computeConfirmed: false,
      diskIncludedGb: 8,
      diskUsdPerGbMonth: 0.125,
      storageIncludedGb: 100,
      storageUsdPerGbMonth: 0.0213,
      alertOverUsd: 90,
    },
  },

  /* policy.v148 adds `runningCoins`. Twelve is about two screen-widths of the strip at 390 points,
     so one loop shows each coin once in the 34 seconds it takes. Ten minutes: For You's frame is
     written about every minute and the board's every five to six (measured 23 Oct: 51 s and 5 m 40 s
     old), so a frame older than ten has missed a beat and its prices (already at most
     `market.readingFreshnessMs` old when written) are no longer "now". Thirty seconds of keeping:
     For You's frame moves about once a minute. */
  runningCoins: {
    maxCoins: 12,
    /* An hour since 2026-10-26: the strip reads the coins of every viral post, and a picked coin off
       For You is read every few passes (services/market pickedCoins), not every minute. */
    freshMs: 3_600_000,
    keepMs: 30_000,
    minCapUsd: 20_000,
    minVolume24hUsd: 24_000,
    /* policy.v150 (the owner, 2026-10-23: "coins that have volume right now — I don't want to see
       few-day-old dead coins"): only coins trading in the last hour, most dollars traded first.
       Measured 23 Oct ~22:50 UTC on 590 launchpad coins we read: 91 had no trade in the hour; of
       the rest the median hour was $420 and 25 trades, the 75th percentile $2,193 and 86 trades.
       $1,000 is about $17 a minute: 184 of the 590 pass it, against 294 at $100 and 43 at
       $10,000. Twenty trades costs a $1,000 coin almost nothing (169 of 184 still pass) and drops
       a coin moved by a handful of fills: the median trade was $19, so $1,000 in under 20 trades
       is a few large orders, not a market. Of the 20 coins the cards named that night it kept 7. */
    minVolume1hUsd: 1_000,
    minTrades1h: 20,
  },

  /* policy.v152 adds `lateNoCoin` (the owner, 2026-10-24: "show late posts that still have no coin").
     Replayed read-only over 19-23 Oct (tools/late-no-coin-replay.ts): 944 posts found more than six hours
     after they went up were judged yes once; 209 would have joined For You under these values — 52, 67,
     30, 8 and 51 a London day, beside For You's own 450, 170, 139, 16 and 201 — 176 if the yes had to
     clear For You's own bar. 13 got a running coin after joining, a median 10.7 hours later; those
     coins came 8 to 70 hours after their post, and a 168-hour cap added 49 posts for one more coin, so
     72. The moustache-baby post (0.72 on a video frame, under the 0.75 bar) joins only with `nearBar`:
     at 08:21 London on 23 Oct, 13 hours before its running coin launched. $0: no read or judge call. */
  lateNoCoin: {
    on: true,
    maxPostAgeMs: 259_200_000, // 72 hours
    nearBar: true,
  },

  /* policy.v155 adds `runnerLink` (RunnerLinkPolicy above), after v152's `lateNoCoin`, v153's saved-post push and v154's meme wars. The miss: on
     23 Oct "You Missed Coin" ($BITCHES) launched 71 minutes after the post that stated that name,
     ran to about $3.7M, and never took the post's pick from the copycat "You Missed Bitches" ($YMB):
     it had no market reading at all (the reader reads the newest 300 coins a pass; 3,026 of the
     11,242 coins first seen 18:00-22:00 UTC that day were never read) and the trade feed was at its
     day cap. Two days for the stated name: the owner's link bound (oneCoin.linkMaxAgeMs).
     running: $250k is about the cap a launch reaches when people are buying it hard; picks over it
     or over the strip's last-hour bar, one post a coin, pulled back 45 posts For You never showed in
     the three days to 24 Oct. missed: replayed over the same three days with two pooled readings,
     $250k found 90 coins no pick held, $500k 25 (10 tied to a post we hold, 15 without), $1M 18:
     $500k is about eight alerts a day. A half for the origin: @TocRadio over @LauraLoomer's retelling. */
  runnerLink: {
    stated: { on: true, withinMs: 172_800_000, genericWords: ['coin', 'token'] },
    running: { on: true, minCapUsd: 250_000, readingWithinMs: 1_800_000, pickWithinMs: 172_800_000, marketReadsPerPass: 60 },
    missed: { on: true, everyMs: 600_000, seenWithinMs: 86_400_000, minCapUsd: 500_000, minReadings: 2, postLookbackMs: 172_800_000, originShareOfTop: 0.5, perPass: 50, alert: true },
    /* policy.v160. Replayed read-only on production from 23 Oct 23:21 UTC (the first reading with a
       last hour, 0127) to 24 Oct ~13:30: 2 posts handed over (baldcat over $CAT 73 minutes after its
       launch, at $53K and $530K traded in the hour against $0; Kugen over $Friendship at $34K). Without
       the $15K cap bar 9, seven of them $3-6K coins churned past $20K in an hour by bots that never
       reached $17K. A minute: the market reader lands a reading about every five. */
    handover: { on: true, everyMs: 60_000, push: true },
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
