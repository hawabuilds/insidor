/**
 * The wide item feature set — the roughly forty numbers a model gets that the rule
 * does not.
 *
 * WHY THIS IS SEPARATE FROM admit/stage.ts's extract(): the rule's vector is small
 * because a rule can only use what a person can reason about. The model's vector is
 * wide because a tree does not care. Both are frozen at decision time, both are
 * logged, and the `featureSet` on the row says which one produced it — so the two can
 * coexist during the changeover instead of requiring a cutover.
 *
 * THE ONE PROHIBITION: no feature here may be an absolute counter from a source.
 * `reach` is autoplay on one source and impressions on another, and does not exist on
 * a third. Every number is a rate, a ratio to the item's own basis, or a percentile
 * within its own source — which is the mechanism that makes a model fitted on one
 * source still valid when a second arrives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ WHAT THE PROHIBITION DOES AND DOES NOT COVER, because the line is not where a
 * first reading puts it. It is about whose number it is, not about whether the number
 * happens to be an integer. `media.length` and `fingerprints.length` are counts, and
 * they are OURS: they count objects an adapter handed us after translating a payload
 * into this vocabulary, so they mean the same thing on every source and will keep
 * meaning it when the next one arrives. `counters.reach.value` is also a count and is
 * THEIRS, and it means a different thing per source and nothing at all on a source
 * that does not expose it. The first kind is admitted here and named as such; the
 * second kind never appears, in any form, including as a difference or a maximum.
 *
 * ★ AND WHAT ABSENCE COSTS, which is the rule this file is most tempted to break.
 * A model wants a number. Every one of the ratios below is null — never 0 — when
 * either side of it is missing, and every null has a companion feature that says WHY
 * it is missing: `reachObserved`, `corpusUsable`, `measuredExposureMin`,
 * `censoredReadShare`. A defaulted zero would make "this source cannot count
 * reproductions" and "nobody reproduced this" the same row for ever, and the first is
 * a fact about a vendor while the second is the product's entire thesis.
 */

import type { FeatureSetId, FeatureVector } from '@insidor/contracts/features.ts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { CounterKind, Item, Observation } from '@insidor/contracts/vocabulary.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

import { burst } from '../detect/burst.ts';
import { ewmaUpdate, type Ewma } from '../kinetics/ewma.ts';
import {
  MS_PER_MINUTE,
  clamp01,
  gammaQuantile,
  percentileRank,
  safeRatio,
} from '../math.ts';

/**
 * v1. The name is part of the type and the shape is asserted against a frozen key
 * list in this package's tests, so a builder that silently stops emitting a field
 * fails at load rather than showing up months later as a model that got worse.
 */
export const FEATURE_SET: FeatureSetId = 'item.wide.v1';

const PRESENT = 1;
const ABSENT = 0;

/**
 * The source's own trailing distributions, so a number can be stated as a percentile
 * WITHIN ITS OWN SOURCE rather than as a level nobody can compare.
 *
 * ★ WHY IT IS AN ARGUMENT AND NOT SOMETHING THIS FILE FETCHES: it is a store query,
 * and core does not query. Same shape and same reason as GROUP's `CarrierCorpus`.
 * Empty is the honest day-one state and is handled below by emitting nulls with
 * `corpusUsable: 0` beside them — never by falling back to a fabricated median, which
 * would put every item on a new source at the fiftieth percentile of a distribution
 * that does not exist.
 *
 * The two rate maps hold the SAME quantity as the features they normalise, which is
 * the only way a percentile means anything: `ratePerMin` is raw measured rates and
 * normalises the raw rate, `rateLcbPerMin` is shrunk lower bounds and normalises the
 * shrunk lower bound. Ranking a shrunk number against raw ones would report a
 * shrinkage as a fall in popularity.
 */
export interface SourceCorpus {
  readonly source: SourceId;
  /** Raw measured per-minute rates from this source's recent items, by counter. */
  readonly ratePerMin: Readonly<Partial<Record<CounterKind, readonly number[]>>>;
  /** The same items' shrunk lower-bound rates, by counter. */
  readonly rateLcbPerMin: Readonly<Partial<Record<CounterKind, readonly number[]>>>;
  /** Text lengths from the same sample. */
  readonly textLen: readonly number[];
  /** How many items the sample was drawn from. Below policy it is unusable. */
  readonly items: number;
}

/** The empty corpus, spelled once. Day one is a real state, not a missing argument. */
export function emptyCorpus(source: SourceId): SourceCorpus {
  return { source, ratePerMin: {}, rateLcbPerMin: {}, textLen: [], items: 0 };
}

/* ── counters, as levels we are allowed to divide by ──────────────────── */

/**
 * The counter's level, or null when the source has no such concept or did not read
 * it this time. Never returned to the vector — it exists only as a DENOMINATOR or a
 * NUMERATOR of something scale-free.
 */
function level(item: Item, kind: CounterKind): number | null {
  const counter = item.counters[kind];
  if (counter === undefined) return null;
  // `absent` is the source saying it has no such concept. That is categorically not
  // a reading of zero, and the type carries the difference so this cannot be fudged.
  if (counter.fidelity.kind === 'absent') return null;
  return counter.value;
}

/** A ratio that is null unless BOTH sides were actually observed. */
function ratio(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  return safeRatio(numerator, denominator);
}

function observed(item: Item, kind: CounterKind): number {
  return level(item, kind) === null ? ABSENT : PRESENT;
}

/* ── the driving counter ──────────────────────────────────────────────── */

/**
 * Which counter carries this item's kinetics: the first entry of
 * `Policy.detect.preferredCounters` the source actually exposes.
 *
 * It reads DETECT's field rather than declaring a second one, and that is deliberate.
 * Two lists that must never disagree are one list with a bug waiting in it: if the
 * wide vector's driver and the detector's driver ever diverge, a model trained on
 * these rows is fitted against a different counter from the one the rule fired on,
 * and nothing anywhere would say so.
 */
function driverKind(item: Item, p: Policy): CounterKind | null {
  for (const kind of p.detect.preferredCounters) {
    if (level(item, kind) !== null) return kind;
  }
  return null;
}

/* ── exposure, which is where a censored reading must not become a zero ── */

interface Exposure {
  /** Arrivals, reconstructed from measured rates only. */
  readonly arrivals: number;
  /** The minutes those arrivals were measured over. Never the wall-clock span. */
  readonly minutes: number;
  readonly measuredReads: number;
  readonly censoredReads: number;
  /** The newest measured rate, or null when every reading was censored. */
  readonly latestPerMin: number | null;
}

/**
 * ★ THE ONE PLACE THIS FILE COULD REINTRODUCE THE MOST EXPENSIVE BUG IN THE SYSTEM.
 *
 * Arrivals and exposure accumulate over MEASURED intervals only. A censored reading
 * contributes neither a numerator nor a denominator — it is skipped, and the count of
 * skips is logged beside the result as `censoredReadShare`.
 *
 * The alternative — counting a censored interval as zero arrivals over its elapsed
 * time — is the `deltaPerMinute` bug wearing a different hat: it drags the estimated
 * rate toward zero in proportion to how UNREADABLE the source's counter is, so the
 * items whose counters round hardest look coldest, and they look coldest exactly when
 * they are moving fast enough for the rounding to hide the change. A zero looks like
 * data, which is why nobody found it the first time.
 */
function exposureOf(observations: readonly Observation[], kind: CounterKind | null): Exposure {
  let arrivals = 0;
  let minutes = 0;
  let measuredReads = 0;
  let censoredReads = 0;
  let latestPerMin: number | null = null;

  if (kind === null) return { arrivals, minutes, measuredReads, censoredReads, latestPerMin };

  for (const observation of observations) {
    if (observation.kind !== kind) continue;
    if (observation.rate.kind === 'censored') {
      censoredReads += 1;
      continue;
    }
    const over = observation.rate.overMs / MS_PER_MINUTE;
    arrivals += observation.rate.perMin * over;
    minutes += over;
    measuredReads += 1;
    // Newest last, by the Observation contract; the last assignment wins.
    latestPerMin = observation.rate.perMin;
  }

  return { arrivals, minutes, measuredReads, censoredReads, latestPerMin };
}

/**
 * The shrunk arrival rate's lower confidence bound — `Gamma⁻¹(q; a₀+R, b₀+t)`.
 *
 * ★ THIS IS THE `rateLcbNorm` EVERY HEAT SCORE CONSUMES, and it is computed here
 * rather than at the ranker because rank/heat.ts says in as many words that feeding a
 * raw rate in reintroduces the small-sample problem the whole design is avoiding:
 * a brand-new item with one lucky reading would outrank an item with an hour of
 * evidence. The bound is what makes an hour of evidence worth more than a minute of
 * luck, and it is a property of the ITEM, so it belongs in the item's vector.
 *
 * Null — never the prior mean — when there is no measured exposure at all. The prior
 * alone is a claim about how fast an item is moving, made without having successfully
 * measured it once, and an absence is not a claim.
 */
function rateLcbPerMin(exposure: Exposure, p: Policy): number | null {
  if (!(exposure.minutes > 0)) return null;
  const prior = p.features.ratePrior;
  return gammaQuantile(
    prior.lcbQuantile,
    prior.priorArrivals + exposure.arrivals,
    prior.priorExposureMin + exposure.minutes,
  );
}

/* ── burst, from the two continuous-time averages ─────────────────────── */

/**
 * fast/slow over the item's own measured readings. Null — never 1 — when either leg
 * is missing, because 1 is the claim "flat" and a missing leg is not a claim.
 *
 * The averages are the continuous-time form and not the discrete recurrence, for the
 * reason kinetics/ewma.ts gives: this system's read grid is irregular BY DESIGN, and
 * under the discrete form the items we look at most would appear to move most.
 */
function burstOf(
  observations: readonly Observation[],
  kind: CounterKind | null,
  now: Millis,
  p: Policy,
): number | null {
  if (kind === null) return null;
  let fast: Ewma | null = null;
  let slow: Ewma | null = null;

  for (const observation of observations) {
    if (observation.kind !== kind) continue;
    if (observation.rate.kind === 'censored') continue;
    fast = ewmaUpdate(fast, observation.rate.perMin, observation.capturedAt, p.kinetics.fastTauMin * MS_PER_MINUTE);
    slow = ewmaUpdate(slow, observation.rate.perMin, observation.capturedAt, p.kinetics.slowTauMin * MS_PER_MINUTE);
  }

  return burst(fast, slow, now, p.kinetics);
}

/* ── the vector ───────────────────────────────────────────────────────── */

/**
 * The wide item vector. Every value relative; none of them a raw count from a source.
 *
 * ★ THE SIGNATURE GAINED TWO ARGUMENTS THE STUB DID NOT DECLARE, and neither is
 * optional. `corpus` is the only way "a percentile within its own source" can be
 * computed at all — nothing on an `Item` carries the source's distribution, and a
 * builder that quietly fetched one would be a builder that can see data fresher than
 * the vector it is writing. `p` is the only way the arrival-rate prior and the corpus
 * floor can be read rather than typed, which is the rule `tools/check-policy.mjs`
 * enforces and the reason `contracts/src/policy.ts` exists.
 *
 * @param now the decision's clock, as a value. Never read here; ages are measured
 *            against it and the caller owns which clock it is.
 */
export function itemFeatures(
  item: Item,
  observations: readonly Observation[],
  now: Millis,
  corpus: SourceCorpus,
  p: Policy,
): FeatureVector {
  // postedAt is null when the source omits it or is known to lie. First sight is the
  // honest fallback — it is when the item entered OUR world — and `originIsPostTime`
  // below records which clock was used, so a model can learn to distrust one of them.
  const origin = item.postedAt ?? item.firstSeenAt;

  const reach = level(item, 'reach');
  const approval = level(item, 'approval');
  const conversation = level(item, 'conversation');
  const rebroadcast = level(item, 'rebroadcast');
  const reproduction = level(item, 'reproduction');
  const retention = level(item, 'retention');

  const exposed = [reach, approval, conversation, rebroadcast, reproduction, retention].filter(
    (value) => value !== null,
  ).length;

  let exact = 0;
  let quantized = 0;
  for (const counter of Object.values(item.counters)) {
    if (counter === undefined || counter.fidelity.kind === 'absent') continue;
    if (counter.fidelity.kind === 'exact') exact += 1;
    if (counter.fidelity.kind === 'quantized') quantized += 1;
  }

  const driver = driverKind(item, p);
  const exposure = exposureOf(observations, driver);
  const lcb = rateLcbPerMin(exposure, p);

  // The corpus is either big enough to rank against or it is not, and every term that
  // depends on it goes null together rather than one at a time. Partial usability is
  // the shape that produces a vector where two rows disagree about what the source's
  // median was, which is unfindable later.
  const corpusUsable = corpus.items >= p.features.minCorpusItems;
  const driverRates = driver === null ? [] : (corpus.ratePerMin[driver] ?? []);
  const driverLcbs = driver === null ? [] : (corpus.rateLcbPerMin[driver] ?? []);

  const reads = observations.filter((o) => driver !== null && o.kind === driver);
  const firstRead = reads[0]?.capturedAt ?? null;
  const lastRead = reads[reads.length - 1]?.capturedAt ?? null;
  const observedSpanMin =
    firstRead === null || lastRead === null ? null : (lastRead - firstRead) / MS_PER_MINUTE;

  return {
    /* ── when, and whose clock ─────────────────────────────────────────── */
    ageMin: (now - origin) / MS_PER_MINUTE,
    originIsPostTime: item.postedAt === null ? ABSENT : PRESENT,
    /** How late OUR reader was. Null when there is no post time to be late against. */
    firstSeenLagMin:
      item.postedAt === null ? null : (item.firstSeenAt - item.postedAt) / MS_PER_MINUTE,

    /* ── the shape of the object, all of it ours ───────────────────────── */
    langKnown: item.lang === null ? ABSENT : PRESENT,
    hasMedia: item.media.length > 0 ? PRESENT : ABSENT,
    mediaCount: item.media.length,
    mediaHasMotion: item.media.some((m) => m.kind !== 'image') ? PRESENT : ABSENT,
    carrierCount: item.fingerprints.length,
    formatCount: item.formatIds.length,
    imageCarrierPresent: item.fingerprints.some((f) => f.kind === 'imageHash') ? PRESENT : ABSENT,
    textCarrierPresent: item.fingerprints.some((f) => f.kind === 'textShingle') ? PRESENT : ABSENT,
    namedSpanPresent: item.fingerprints.some((f) => f.kind === 'entitySpan') ? PRESENT : ABSENT,
    isRebroadcast: item.rebroadcastOf === null ? ABSENT : PRESENT,
    isReproduction: item.reproductionOf === null ? ABSENT : PRESENT,

    /* ── which counters this source even has, which is the reason column
          for every null below it ─────────────────────────────────────── */
    reachObserved: observed(item, 'reach'),
    approvalObserved: observed(item, 'approval'),
    conversationObserved: observed(item, 'conversation'),
    rebroadcastObserved: observed(item, 'rebroadcast'),
    reproductionObserved: observed(item, 'reproduction'),
    retentionObserved: observed(item, 'retention'),
    countersObserved: exposed,
    exactFidelityShare: exposed === 0 ? null : exact / exposed,
    quantizedFidelityShare: exposed === 0 ? null : quantized / exposed,

    /* ── levels, but only ever as ratios to the item's own basis ───────── */
    reproductionPerReach: ratio(reproduction, reach),
    rebroadcastPerReach: ratio(rebroadcast, reach),
    approvalPerReach: ratio(approval, reach),
    conversationPerReach: ratio(conversation, reach),
    retentionPerReach: ratio(retention, reach),
    /**
     * ★ THE THESIS, AS A RATIO. A rebroadcast creates no new authored object and a
     * reproduction creates one, so this is "how many people made their own version
     * per person who merely passed it on". It is the one number in this vector that
     * separates the product's claim from "a lot of people saw this", and it is null
     * rather than zero on a source that cannot tell the two kinds apart — which is
     * most of them, and is why the corpus-relative terms carry the weight there.
     */
    reproductionPerRebroadcast: ratio(reproduction, rebroadcast),
    conversationPerApproval: ratio(conversation, approval),

    /* ── how we read it, which is a fact about us and belongs in the row ─ */
    readCount: observations.length,
    driverReadCount: exposure.measuredReads + exposure.censoredReads,
    driverIsReproduction: driver === null ? null : driver === 'reproduction' ? PRESENT : ABSENT,
    observedSpanMin,
    readIntervalMeanMin:
      observedSpanMin === null || reads.length < 2 ? null : observedSpanMin / (reads.length - 1),
    /**
     * The share of readings that told us nothing. Not a diagnostic — a feature: a
     * high censoring share means every rate on this row is estimated from less
     * evidence than the read count suggests, and a model that cannot see that will
     * trust a rounded counter exactly as much as an exact one.
     */
    censoredReadShare:
      exposure.measuredReads + exposure.censoredReads === 0
        ? null
        : exposure.censoredReads / (exposure.measuredReads + exposure.censoredReads),
    measuredExposureMin: exposure.minutes,

    /* ── the kinetics, all scale-free or shrunk ────────────────────────── */
    driverRatePerMin: exposure.latestPerMin,
    driverRatePct:
      corpusUsable && exposure.latestPerMin !== null
        ? percentileRank(driverRates, exposure.latestPerMin)
        : null,
    rateLcbPerMin: lcb,
    /** What rank/heat.ts consumes. Shrunk, then ranked inside its own source. */
    rateLcbNorm: corpusUsable && lcb !== null ? percentileRank(driverLcbs, lcb) : null,
    /** How much the shrinkage cost, in [0,1]. A direct read on small-sample risk. */
    rateShrinkage:
      lcb === null || exposure.latestPerMin === null || !(exposure.latestPerMin > 0)
        ? null
        : clamp01(1 - lcb / exposure.latestPerMin),
    burst: burstOf(observations, driver, now, p),

    /* ── where this item sits in its own source ────────────────────────── */
    corpusUsable: corpusUsable ? PRESENT : ABSENT,
    corpusItems: corpus.items,
    textLenPct: corpusUsable ? percentileRank(corpus.textLen, item.text.trim().length) : null,
  };
}
