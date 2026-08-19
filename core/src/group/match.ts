/**
 * Scoring one (item, story) pair. The unit of work in GROUP is a PAIR, not an
 * arrival — which is why this stage's cost grows with the size of a candidate block
 * rather than with the number of things arriving, and why "predictions per day" is
 * the wrong way to size it.
 *
 * The six match features are the two free carrier tiers, the lineage pointer, the
 * representation similarity, source agreement and time proximity. Hand-set weights
 * today; a logistic regression over the same six once there are a few hundred
 * hand-labelled pairs, which is about three hours of work once and is the cheapest
 * model in the system.
 *
 * ONE BAR PER REPRESENTATION SPACE, NEVER SHARED. A bar calibrated on sparse term
 * geometry merges nearly everything when a dense space is dropped in behind it —
 * unrelated sentences sit well above the old constant. Policy.group.similarityBars is
 * keyed by space id for exactly that reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THIS FILE DECIDED, EACH OF WHICH WOULD OTHERWISE BE REDISCOVERED.
 *
 * 1. SEVEN WEIGHTS, NOT SIX. The header above counts the carrier tiers as two
 *    because it is naming tiers; there are four carrier KINDS, and the two
 *    exact-match ones (a template id, a named span) are neither image nor text.
 *    They share one weight — `exactCarrier` — because they share one evidential
 *    shape: a token present verbatim on both sides. What separates them is
 *    reliability, and reliability is already carried by the persistence weight,
 *    which zeroes a symbol everybody mentions and leaves a template id alone.
 *
 * 2. THE DISTANCE BAR IS THE JUDGEMENT; THE DISTANCE IS NOT A GRADIENT. A carrier
 *    inside its radius contributes its full channel weight, whether the hamming
 *    distance was 0 or 31. The first draft of this file faded the contribution
 *    linearly to zero at the bar, which quietly meant a carrier the policy calls a
 *    match was worth almost nothing — the bar said yes and the score said no.
 *    Policy owns the yes/no; the measured distance rides on the evidence and in
 *    the feature vector, where a fit over labelled pairs can learn the gradient
 *    nobody can currently defend typing.
 *
 * 3. TIME AND SOURCE ARE CORROBORATION, NOT IDENTITY, and their weights sum to
 *    less than `matchBar` on purpose. Two posts landing in the same ten minutes on
 *    a story that already spans sources is a coincidence that happens thousands of
 *    times an hour. If a pair of coincidences could add up to a join, a busy hour
 *    would merge everything posted during it.
 */

import type { MatchEvidence, Story } from '@insidor/contracts/story.ts';
import type { ItemId, StoryId } from '@insidor/contracts/ids.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { FingerprintKind, Item } from '@insidor/contracts/vocabulary.ts';

import { clamp01 } from '../math.ts';
import { carrierMatches, type CarrierCorpus, type CarrierMatch } from './carriers.ts';

export interface MatchResult {
  readonly story: Story;
  /**
   * The weighted sum of the channels that fired. Floored at zero and — ★ deliberately
   * — NOT capped at one.
   *
   * THE CEILING WAS A TIE GENERATOR. This was `clamp01`, and the seven weights sum to
   * 2.05, so any pair carrying a lineage pointer plus two carrier tiers saturates. Two
   * candidates at raw 1.9 and raw 1.1 both clamped to exactly 1.0, `adjudicate`
   * measured a margin of 0.0 against an adjudication band of 0.05, and a join a human
   * would call obvious went to the adjudication queue as "we cannot tell these apart".
   * The clamp destroyed the ordering it was then asked to rank on.
   *
   * The floor stays: a policy is allowed negative weights (ADMIT already has them), and
   * a negative total is "no evidence", not "evidence against". It cannot manufacture an
   * ambiguity the way the ceiling did, because a floored score is below `matchBar` and
   * the bar runs before the band.
   *
   * Nothing downstream needed the ceiling — `Decision.score` carries no [0,1] contract,
   * and the calibrated-to-[0,1] promise in features.ts is made by `Scorer.score`, which
   * replaces this number entirely when a model is loaded.
   */
  readonly score: number;
  /**
   * The cheapest tier that settled the pair, or null.
   *
   * NULL IS NOT AN OVERSIGHT AND IT IS NOT A SIXTH VARIANT. A candidate block is
   * "open stories sharing at least one carrier OR time bucket", so a pair can be
   * scored while sharing nothing at all — and `MatchEvidence` has no member
   * meaning "nothing", because it exists to say why a member row was written.
   * Inventing a variant, or emitting a carrier with a fabricated key, is exactly
   * the poisoning of the carrier join that phash.ts refuses in the adapters. A
   * pair with null evidence can never become a member row: `adjudicate` below
   * cannot return a `join` holding one, so the type forecloses it rather than a
   * reviewer having to notice.
   */
  readonly evidence: MatchEvidence | null;
}

/** A MatchResult that has something to write on a member row. */
export type EvidencedMatch = MatchResult & { readonly evidence: MatchEvidence };

/**
 * An explicit pointer from this item to an item that is already somewhere, resolved
 * by the service before the stage runs.
 *
 * WHY IT ARRIVES AS DATA: `Item.reproductionOf` names an ITEM, and `Story` carries
 * no member list, so nothing inside core can turn "points at item X" into "points
 * into story S" — that is a store lookup, and a stage that could do a lookup could
 * do a fetch. Same shape as QUALIFY's judgement: the expensive resolution happens
 * outside, the answer comes in as a field, and the replay needs neither.
 */
export interface LineageLink {
  readonly via: 'reproduction' | 'rebroadcast';
  readonly toItem: ItemId;
  /** The story that item is already a member of. */
  readonly story: StoryId;
}

/**
 * Everything the service resolved before this stage ran, in one optional bag.
 *
 * It is a bag rather than two more positional parameters because both members are the
 * same KIND of thing — an answer to a question core is not allowed to ask — and both
 * are legitimately absent. A replay that has neither still scores the pair; it scores
 * it on the free geometry alone and the vector records that that is what happened.
 */
export interface PairContext {
  readonly lineage: LineageLink | null;
  /**
   * Persistence statistics for the carriers in play. Empty means "no corpus yet",
   * which is the honest state on day one — carriers.ts weights an unknown carrier at
   * full strength rather than at zero, so grouping works on the first afternoon.
   */
  readonly corpus: CarrierCorpus;
}

/**
 * What a caller that has resolved nothing passes.
 *
 * FROZEN TO THE BOTTOM, and the inner freeze is the one that matters. `Object.freeze`
 * is shallow, so a single `Object.freeze({ corpus: {} })` leaves the corpus itself
 * writable — and because this value is exported and shared by every default-argument
 * call in the file, one line of `NO_PAIR_CONTEXT.corpus[k] = …` anywhere in the process
 * would silently reweight every replay that thought it was running with no corpus.
 * That is hidden mutable module state wearing a `readonly` type, which the compiler
 * cannot see and a replay cannot reproduce.
 */
export const NO_PAIR_CONTEXT: PairContext = Object.freeze({
  lineage: null,
  corpus: Object.freeze({}),
});

/* ── the seven channels ───────────────────────────────────────────────── */

/** Which weight a carrier kind spends. The two exact kinds share one; see (1) above. */
function carrierWeightKey(kind: FingerprintKind): 'imageCarrier' | 'textCarrier' | 'exactCarrier' {
  if (kind === 'imageHash') return 'imageCarrier';
  if (kind === 'textShingle') return 'textCarrier';
  return 'exactCarrier';
}

/** One carrier kind's side of the pair, as the feature vector needs to record it. */
export interface CarrierKindDetail {
  /**
   * Whether the ITEM carries a fingerprint of this kind at all. Absent is a
   * different fact from unmatched — no adapter can currently compute an image
   * hash, so an item with no image fingerprint has told us nothing about images,
   * and a model fit on a defaulted zero would learn that every such item is
   * image-dissimilar to everything.
   */
  readonly offered: boolean;
  /** Whether one of them landed inside the story's carriers, at any weight. */
  readonly shared: boolean;
  /** Distance of the best shared one. Null for exact kinds, which have no metric. */
  readonly distance: number | null;
  /** Its persistence weight. Null when nothing of this kind was shared. */
  readonly weight: number | null;
}

export interface CarrierChannel {
  /** Total weight contributed by carriers that cleared the persistence floor. */
  readonly contribution: number;
  /**
   * The carrier this pair would be joined on: `carrierMatches`' own first result,
   * which it sorts heaviest-weight-first under a total order it documents as
   * reproducible on replay.
   *
   * When every shared carrier failed the weight floor this still holds the best of
   * them, and that is deliberate: "we shared a carrier and it was worth nothing" is
   * `M5_generic_carrier` and "we shared nothing" is `M3_below_match_bar`. Telling
   * those two apart downstream needs the failing carrier, not its absence.
   */
  readonly best: CarrierMatch | null;
  readonly sharedCount: number;
  readonly byKind: Readonly<Record<FingerprintKind, CarrierKindDetail>>;
}

export function carrierChannel(
  item: Item,
  story: Story,
  p: Policy,
  corpus: CarrierCorpus = {},
): CarrierChannel {
  const shared = carrierMatches(item.fingerprints, story.carriers, p, corpus);

  const byKind: Record<FingerprintKind, CarrierKindDetail> = {
    imageHash: kindDetail(item, 'imageHash'),
    textShingle: kindDetail(item, 'textShingle'),
    formatId: kindDetail(item, 'formatId'),
    entitySpan: kindDetail(item, 'entitySpan'),
  };

  // Contribution accrues per KIND, not per carrier: two shared image hashes are one
  // piece of evidence about one image, not two independent votes. Summing per carrier
  // would let an item carrying forty near-duplicate frames outscore an item whose
  // source published an explicit lineage pointer.
  const fired = new Set<FingerprintKind>();

  for (const m of shared) {
    if (m.weight > p.group.minCarrierWeight) fired.add(m.carrier.kind);

    const seen = byKind[m.carrier.kind];
    if (!seen.shared || m.weight > (seen.weight ?? 0)) {
      byKind[m.carrier.kind] = {
        offered: seen.offered,
        shared: true,
        distance: m.distance,
        weight: m.weight,
      };
    }
  }

  let contribution = 0;
  for (const kind of fired) contribution += channelWeight(kind, p);

  // ★ `shared[0]`, NOT our own re-ranking. carrierMatches returns strongest first
  // under a total order it documents as reproducible on replay, and it says in as
  // many words that matches[0] is the one the stage should log. A second ranking here
  // would be a second opinion about which carrier the member row records, and the two
  // would drift the first time either side is tuned.
  return { contribution, best: shared[0] ?? null, sharedCount: shared.length, byKind };
}

function kindDetail(item: Item, kind: FingerprintKind): CarrierKindDetail {
  const offered = item.fingerprints.some((f) => f.kind === kind);
  return { offered, shared: false, distance: null, weight: null };
}

function channelWeight(kind: FingerprintKind, p: Policy): number {
  return p.group.matchWeights[carrierWeightKey(kind)];
}

/** What the paid tier had to say, kept separate from whether it was consulted. */
export interface RepresentationRead {
  /** True when at least one space supplied a similarity AND has a calibrated bar. */
  readonly comparable: boolean;
  /** The best similarity among comparable spaces; null when there were none. */
  readonly similarity: number | null;
  readonly space: string | null;
  /** True when that similarity is at or over its own space's bar. */
  readonly fired: boolean;
  /**
   * ★ The best similarity ANY space returned, calibrated or not — null only when no
   * space answered at all.
   *
   * WHY IT EXISTS SEPARATELY, and it is not a duplicate of `similarity`: an
   * uninterpretable cosine may not be SCORED, but it must still be RECORDED, and the
   * two are different obligations. With the shipped `similarityBars: {}` every space is
   * uninterpretable, so recording only the comparable number meant the log kept `null`
   * for every answer the embed port ever gave. A bar is fit from logged similarities;
   * a bar that can only be fit from similarities that are only logged once a bar exists
   * can never be fit at all. That deadlock is what this field breaks.
   *
   * It is also the field that keeps the outage distinguishable. "The port is down" and
   * "the port answered and the space has no bar" are both `comparable: false`; only
   * `observed` tells them apart, and an outage that reads identically to a healthy
   * uncalibrated read is an outage nobody will notice.
   *
   * It contributes NOTHING to the score. `fired` is still gated on a calibrated bar,
   * which is this file's one-bar-per-space rule and is not being relaxed here.
   */
  readonly observed: number | null;
  readonly observedSpace: string | null;
}

/**
 * A cosine in a space with no bar is not a weak signal, it is an uninterpretable
 * one — that is the whole argument of this file's header — so it contributes
 * nothing and can never be evidence. `similarityBars` is `{}` in the shipped
 * policy, which makes every space uninterpretable and the free tiers the only
 * path. That is the intended state, not a gap waiting to be filled in.
 *
 * Both picks below are order-independent: every comparison falls back to the space id,
 * so the winner does not depend on the insertion order of an object nobody controls.
 */
export function readRepresentation(
  similarityBySpace: Readonly<Record<string, number>>,
  p: Policy,
): RepresentationRead {
  let similarity: number | null = null;
  let space: string | null = null;
  let fired = false;
  let observed: number | null = null;
  let observedSpace: string | null = null;

  for (const [candidateSpace, cosine] of Object.entries(similarityBySpace)) {
    /* Recorded BEFORE the bar test, because the whole point of this pass is the answers
       the bar test is about to throw away. */
    if (
      observed === null ||
      cosine > observed ||
      (cosine === observed && candidateSpace < (observedSpace ?? ''))
    ) {
      observed = cosine;
      observedSpace = candidateSpace;
    }

    const bar = p.group.similarityBars[candidateSpace];
    if (bar === undefined) continue;
    const candidateFired = cosine >= bar;
    // A firing space beats a non-firing one; otherwise the higher cosine wins.
    // Ties break on the space id so the pick survives a replay.
    const better =
      similarity === null ||
      (candidateFired && !fired) ||
      (candidateFired === fired &&
        (cosine > similarity || (cosine === similarity && candidateSpace < (space ?? ''))));
    if (better) {
      similarity = cosine;
      space = candidateSpace;
      fired = candidateFired;
    }
  }

  return { comparable: similarity !== null, similarity, space, fired, observed, observedSpace };
}

/**
 * How close the item was posted to the story's window, as a decay rather than a
 * window test. Inside the window the gap is zero; outside it is the distance to the
 * nearer end.
 *
 * Null when the item carries no post time. NOT zero: "the source did not tell us
 * when this was posted" and "this was posted a week away" are different facts, and
 * a defaulted zero here would silently penalise every source that omits the field.
 */
export function timeGapMs(item: Item, story: Story): number | null {
  const postedAt = item.postedAt;
  if (postedAt === null) return null;
  if (postedAt < story.earliestPostAt) return story.earliestPostAt - postedAt;
  if (postedAt > story.lastMemberAt) return postedAt - story.lastMemberAt;
  return 0;
}

export function timeProximity(item: Item, story: Story, p: Policy): number | null {
  const gapMs = timeGapMs(item, story);
  if (gapMs === null) return null;
  return clamp01(Math.exp(-gapMs / p.group.timeProximityTauMs));
}

/* ── the pair score ───────────────────────────────────────────────────── */

/**
 * The floor, and only the floor. See `MatchResult.score` for why there is no ceiling:
 * a capped score ranks two decisively different candidates as a tie and hands the pair
 * to a human who can see at a glance that it was not close.
 *
 * NaN becomes zero rather than propagating. A NaN score sorts unpredictably — every
 * comparison against it is false — and an unpredictable sort is an unreproducible
 * replay, which is worse than a pair we decline to join.
 */
function floorAtZero(total: number): number {
  if (Number.isNaN(total)) return 0;
  return total < 0 ? 0 : total;
}

/**
 * TO BUILD: score the pair, cheapest evidence first, and stop as soon as a free
 * carrier settles it. The paid similarity is consulted only for what the free tiers
 * missed, and its absence must degrade the score rather than block the join.
 *
 * `context` is optional so the four-argument call in the design still type-checks: a
 * service that has resolved the pointer and loaded the corpus passes them, a replay
 * that has neither does not, and the vector records which of those happened.
 */
export function matchScore(
  item: Item,
  story: Story,
  similarityBySpace: Readonly<Record<string, number>>,
  p: Policy,
  context: PairContext = NO_PAIR_CONTEXT,
): MatchResult {
  const w = p.group.matchWeights;
  const { lineage } = context;
  const carriers = carrierChannel(item, story, p, context.corpus);

  const pointsHere = lineage !== null && lineage.story === story.storyId;

  /* The two corroborating channels. Free, local, and — by property (3) at the top of
     this file — incapable of adding up to a join between them.

     TIME PROXIMITY is a pair fact: how far the item was posted from the story's
     window, decayed rather than windowed.

     SOURCE AGREEMENT is not, and the limitation is worth stating rather than
     discovering. `Story` carries `distinctSources` but not WHICH sources, so this
     cannot be the intersection test the name suggests — it reads "has this story
     already crossed a source boundary", which is evidence that the story is a real
     spreading thing rather than one feed's artefact. It still orders a candidate
     block, because the block is several stories against one item. The day `Story`
     carries its source set, this becomes "and the item's source is a NEW one", which
     is strictly better and is why the weight is the smallest of the seven. */
  const proximity = timeProximity(item, story, p);
  const agrees = story.distinctSources > 1;

  const free =
    (pointsHere ? w.lineage : 0) +
    carriers.contribution +
    (agrees ? w.sourceAgreement : 0) +
    (proximity === null ? 0 : w.timeProximity * proximity);

  // The evidence a free tier would write, cheapest and most certain first: a pointer
  // the SOURCE published beats a hash WE computed, because one is a statement and the
  // other is an inference.
  const freeEvidence: MatchEvidence | null = pointsHere
    ? { kind: 'lineage', via: lineage.via, toItem: lineage.toItem }
    : carriers.best === null
      ? null
      : {
          kind: 'carrier',
          carrier: carriers.best.carrier.kind,
          key: carriers.best.carrier.key,
          distance: carriers.best.distance,
          weight: carriers.best.weight,
        };

  // ★ THE SHORT CIRCUIT THE TODO TEST IS ABOUT. When the free tiers already clear the
  // bar we return without ever reading `similarityBySpace`. That is what "joins with
  // no model call" means in a pure function: not that the call was cheap, that the
  // argument was never touched.
  if (free >= p.group.matchBar && freeEvidence !== null) {
    return { story, score: floorAtZero(free), evidence: freeEvidence };
  }

  // Only now, for what the free tiers missed. An absent entry degrades the score by
  // contributing nothing — it does NOT block, and it does not score as a zero
  // similarity, because "we did not look" is not "we looked and saw nothing alike".
  const representation = readRepresentation(similarityBySpace, p);
  const total = free + (representation.fired ? w.representation : 0);

  const evidence: MatchEvidence | null =
    representation.fired && representation.similarity !== null && representation.space !== null
      ? { kind: 'representation', similarity: representation.similarity, space: representation.space }
      : freeEvidence;

  return { story, score: floorAtZero(total), evidence };
}

/**
 * Whether the paid tier was consulted at all for this pair — the free tiers having
 * settled it is a different fact from the embed port being down, and the log has to
 * be able to tell them apart. Recomputed rather than returned so `matchScore` keeps
 * its stated signature.
 */
export function representationConsulted(
  item: Item,
  story: Story,
  p: Policy,
  context: PairContext = NO_PAIR_CONTEXT,
): boolean {
  // The probe is the same pair scored with an EMPTY similarity map, which is exactly
  // the free-tier total. Recomputing beats returning it from matchScore, which would
  // mean widening a signature the design states verbatim.
  const probe = matchScore(item, story, {}, p, context);
  return probe.score < p.group.matchBar || probe.evidence === null;
}

/* ── ★ the three outcomes ─────────────────────────────────────────────── */

/**
 * ★ JOIN, DO NOT JOIN, AND CANNOT TELL — as a union, so a caller cannot collapse the
 * third into either of the others by forgetting it exists.
 *
 * A boolean plus a comment is what this replaces, and the reason a boolean is wrong
 * here is the same reason it is wrong in RESOLVE (see margin.ts): a high score on the
 * best candidate proves nothing when candidate number two scores the same. A grouper
 * that always picks the higher of two indistinguishable stories is not more accurate
 * than one that abstains, it is equally accurate and no longer able to say so.
 *
 * `join` carries an `EvidencedMatch`, so the compiler will not let a member row be
 * written without the reproducible fact it is supposed to record.
 */
export type MatchOutcome =
  | {
      readonly kind: 'join';
      readonly best: EvidencedMatch;
      readonly runnerUp: MatchResult | null;
      readonly margin: number | null;
    }
  | {
      /** Two candidates we cannot separate. A human decides; this stage never guesses. */
      readonly kind: 'ambiguous';
      readonly best: MatchResult;
      readonly runnerUp: MatchResult;
      readonly margin: number;
    }
  | {
      /** We looked at the whole block and said no. Distinct from having nothing to look at. */
      readonly kind: 'rejected';
      readonly best: MatchResult;
      /**
       * ★ CARRIED EVEN THOUGH THIS OUTCOME IS A DROP, because the vector built from it
       * is replayed against policies this one is not.
       *
       * `rejected` used to hold no runner-up, so `stage.ts` logged `secondScore: null`
       * and `scoreMargin: null` for every dropped pair. Replay a block of two
       * indistinguishable candidates under a LOWERED `matchBar` — the exact experiment
       * `gate()` exists to make possible — and the null margin skipped the
       * `M4_ambiguous_match` test entirely: `gate` returned null, which means join. The
       * band silently became opt-out on replay, and "we cannot tell" came back as
       * "join", which is the one collapse the union was built to prevent.
       *
       * Null here means there genuinely was no second candidate, not that we declined
       * to write it down.
       */
      readonly runnerUp: MatchResult | null;
      readonly why: 'below_bar' | 'generic_carrier';
    }
  | { readonly kind: 'empty' };

/**
 * Order the block and apply the two bars in the order that makes the reason honest.
 *
 * THE BAR RUNS BEFORE THE BAND, and that ordering is a decision. Two candidates that
 * both scored under the match bar are two things we looked at and rejected — sending
 * that pair to a human as "ambiguous" would fill the adjudication queue with pairs
 * where the right answer is obviously neither. The band is for the case where the
 * best candidate is good enough to join and the runner-up is just as good.
 *
 * The band applies whatever the runner-up scored, exactly as `isConfident` in
 * resolve/margin.ts does: what makes a pick unsafe is that the ordering is inside the
 * noise, and that is true whether the loser was close from above or from below.
 */
/**
 * Descending by score; ties break on the story id. A tiebreak that is not deterministic
 * is a replay that disagrees with the run it is replaying.
 *
 * ★ IT RETURNS 0 FOR TWO RESULTS ON THE SAME STORY, and the previous spelling — a bare
 * `a < b ? -1 : 1` — returned 1, so `compare(x, x) === 1`. That is not a total order:
 * it claims an element sorts after itself. The candidate block is caller-supplied and
 * nothing in the types stops it holding one story twice, and V8's sort is free to
 * produce a different permutation from an inconsistent comparator depending on run
 * length. A grouper whose ranking depends on how many candidates happened to be in the
 * block is not replayable, which is the property this whole package is built on.
 *
 * Deliberately the same shape as `strongestFirst` in carriers.ts, which already got
 * this right.
 */
function strongestPairFirst(a: MatchResult, b: MatchResult): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.story.storyId === b.story.storyId) return 0;
  return a.story.storyId < b.story.storyId ? -1 : 1;
}

export function adjudicate(results: readonly MatchResult[], p: Policy): MatchOutcome {
  if (results.length === 0) return { kind: 'empty' };

  const ranked = [...results].sort(strongestPairFirst);

  const best = ranked[0];
  if (best === undefined) return { kind: 'empty' };
  const runnerUp = ranked[1] ?? null;

  if (best.score < p.group.matchBar) {
    // A carrier was shared and weighed nothing — the thirty-nine-post story, where
    // every member mentioned the same symbol. Naming it separately from a plain miss
    // is what makes "how much traffic does the generic carrier rule eat" one query.
    const why =
      best.evidence !== null &&
      best.evidence.kind === 'carrier' &&
      best.evidence.weight <= p.group.minCarrierWeight
        ? 'generic_carrier'
        : 'below_bar';
    return { kind: 'rejected', best, runnerUp, why };
  }

  if (runnerUp !== null) {
    const margin = best.score - runnerUp.score;
    if (margin < p.group.adjudicationBand) {
      return { kind: 'ambiguous', best, runnerUp, margin };
    }
  }

  const evidence = best.evidence;
  if (evidence === null) {
    // Unreachable while the corroborating weights sum to less than the bar, which is
    // property (3) at the top of this file and is asserted in the tests. It is a
    // branch rather than an assertion so that a future weight edit which breaks that
    // property produces a drop, not a member row claiming a join with no basis.
    return { kind: 'rejected', best, runnerUp, why: 'below_bar' };
  }

  return {
    kind: 'join',
    best: { ...best, evidence },
    runnerUp,
    margin: runnerUp === null ? null : best.score - runnerUp.score,
  };
}
