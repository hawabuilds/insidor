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
}

/* ── TRACK ────────────────────────────────────────────────────────────── */

export interface TrackPolicy {
  /** The re-read grid, in minutes. Geometric, so early minutes are dense. */
  readonly tierMinutes: readonly number[];
  /** Score bands that map an item onto a tier. Same length as tierMinutes − 1. */
  readonly tierCutoffs: readonly number[];
  /**
   * A fixed share of arrivals tracked on the full grid regardless of score, forever.
   * This is the only unbiased history in the system: without it, a post's history
   * length is decided by its early performance, which is the outcome.
   */
  readonly holdoutRate: number;
  /** Backpressure sheds tiers from the top down and NEVER touches probation. */
  readonly shedFromTier: number;
  /** Stop re-reading after this, unless the item is in the holdout. */
  readonly maxTrackedHours: number;
  /** Consecutive censored reads before the lifecycle demotes a tier. */
  readonly flatReadsToDemote: number;
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
   * A hard absolute floor beneath the relative test. An author's own baseline is
   * under an adversary's control in both directions — depress it with filler, then
   * buy engagement — and a gate an attacker can open by buying a hundred approvals
   * is worse than no gate.
   */
  readonly absoluteFloor: number;
  /** burst = fast/slow. Above this is bending upward. */
  readonly burstBar: number;
  /** Readings required before a baseline is usable at all. */
  readonly minBaselineReads: number;
  /** Which counter drives the burst statistic when several are present. */
  readonly preferredCounters: readonly CounterKind[];
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
  /** Term weighting: persistence over daily buckets, not raw document frequency. */
  readonly persistenceBuckets: number;
  readonly persistenceDfFloor: number;
  /** Promotion: what a candidate must show before anything downstream may look at it. */
  readonly promoteMinMembers: number;
  readonly promoteMinDistinctAuthors: number;
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
  /** The escape hatch: a genuinely explosive entrant skips the dwell. */
  readonly newEntrantBurst: number;
  /** Board stability floor, as rank correlation between consecutive ticks. */
  readonly kendallTauFloor: number;
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
     was not a window, and the version string is the only thing that says so. */
  version: 'policy.v4',

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
  },

  track: {
    tierMinutes: [4, 9, 14, 21, 30, 42, 58, 78],
    tierCutoffs: [0.9, 0.75, 0.6, 0.45, 0.3, 0.2, 0.1],
    holdoutRate: 0.02,
    shedFromTier: 0,
    maxTrackedHours: 168,
    flatReadsToDemote: 3,
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
    absoluteFloor: 50,
    burstBar: 1.35,
    minBaselineReads: 2,
    preferredCounters: ['reproduction', 'conversation', 'approval', 'reach'],
  },

  group: {
    imageHashMaxDistance: 31,
    imageHashBits: 256,
    textHashMaxDistance: 3,
    textHashBits: 64,
    minShingles: 6,
    similarityBars: {},
    adjudicationBand: 0.05,
    persistenceBuckets: 14,
    persistenceDfFloor: 3,
    promoteMinMembers: 3,
    promoteMinDistinctAuthors: 2,
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
