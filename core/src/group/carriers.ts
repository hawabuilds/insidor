/**
 * Carriers — the free tier of grouping, and the tier that does most of the work.
 *
 * A carrier is something two items can share exactly: a perceptual image hash, a
 * near-duplicate text hash, a format id, an explicit lineage pointer. Matching on one
 * costs no API call, no model and no language — the same image posted on two
 * different platforms in two different languages produces the same bits. That is what
 * makes the grouper multilingual and cross-source BEFORE any model exists, and it is
 * why this tier ships first and alone.
 *
 * The tier below it, learned representations, must never become a precondition for
 * joining. If it does, a representation outage stops grouping instead of degrading it,
 * and nobody will have decided to accept that.
 *
 * ── ★ NOT EVERY SHARED THING IS A CARRIER ────────────────────────────────────
 *
 * The failure this file has to prevent is not "we missed a join". It is the join that
 * should never have happened: a stock avatar, a template everyone uses, a symbol that
 * means "money". Two items sharing one of those are not two versions of the same
 * moment — they are two items that both mentioned money, and one story in the build
 * this replaces accreted thirty-nine unrelated posts on exactly that.
 *
 * So a shared carrier comes back with a WEIGHT, and there are two independent ways to
 * be worth nothing:
 *
 *   BY NATURE — a generic symbol is worth zero whatever its frequency, and no amount
 *               of rarity redeems it. That is group/qualify's curated list, consulted
 *               through carrierWeight(), and it is the floor that works on day one
 *               before any corpus exists.
 *   BY WEAR   — a term common across all fourteen daily buckets is background. Note
 *               this is persistence, NOT raw document frequency: a term that spiked in
 *               the last two buckets keeps almost all its weight, because a meme that
 *               spawns many posts raises its own terms' frequency and a plain
 *               frequency cutoff punishes exactly the story the product exists for.
 *
 * A zero-weight match is still RETURNED, not filtered out. "They share nothing" and
 * "they share something worthless" are different findings and the stage owes them
 * different reason codes — M6_no_candidate_block or M3_below_match_bar against
 * M5_generic_carrier. Filtering here would erase the distinction before the stage
 * could log it, and a reason code nobody can tell apart is a dead stage and a quiet
 * night wearing the same row.
 */

import type { Fingerprint } from '@insidor/contracts/vocabulary.ts';
import { FINGERPRINT_KINDS } from '@insidor/contracts/vocabulary.ts';
import type { Policy } from '@insidor/contracts/policy.ts';

import { isHexHash } from '../bits.ts';
import { carrierWeight } from './persistence.ts';
import { imageHashDistance } from './phash.ts';
import { hammingHex } from './simhash.ts';

/**
 * One shared carrier, with how close it matched and what that match is WORTH.
 *
 * The weight is on the match rather than left to the caller because "these two share a
 * carrier" is not evidence on its own — a symbol every member of a corpus mentions is
 * shared by everything and means nothing. Keeping the weight beside the carrier makes
 * it impossible to count presence and forget value, which is a mistake this codebase has
 * already made once at the merge sweep (see `group/merge.ts`).
 *
 * `distance` is null for exact-match kinds and that is not "distance zero": an exact
 * carrier has no metric at all, and a null says so rather than implying a perfect score
 * on a scale that does not exist here.
 */
export interface CarrierMatch {
  readonly carrier: Fingerprint;
  /** Hamming-style distance for hash carriers; null for exact-match kinds. */
  readonly distance: number | null;
  /** From persistence.ts. A carrier everyone shares is not evidence. */
  readonly weight: number;
}

/**
 * What the corpus knows about one carrier key. Both fields are store queries
 * (CarrierRepo.dailyFrequency and the 24-hour index), so they arrive as data: core
 * cannot count documents, and a weighting that read a live count would not replay.
 */
export interface CarrierStats {
  /** Inverse document frequency over the last 24 hours. */
  readonly idf24h: number;
  /** Document frequency per daily bucket, oldest first. Feeds persistence(). */
  readonly dfByBucket: readonly number[];
}

/**
 * Corpus statistics for the carriers in play, keyed by `corpusKey`.
 *
 * Keyed by KIND AND KEY together, because a Fingerprint's key is opaque and
 * comparable only against the same kind — an entitySpan and a formatId that happen to
 * spell the same string are two different things, and a shared map would let one's
 * document frequency silence the other.
 */
export type CarrierCorpus = Readonly<Record<string, CarrierStats>>;

/**
 * The separator `corpusKey` joins on, written as an escape rather than pasted in as a
 * raw byte.
 *
 * It is NUL because no fingerprint key may contain one, which is what makes the
 * concatenation unambiguous — `entitySpan` + `a b` and `entitySpan a` + `b` must not
 * collide, and a space separator does not guarantee that.
 *
 * ★ SPELLED `\0`, NOT EMBEDDED. This used to be a literal NUL byte inside the template
 * string, where every editor and every `grep` renders it as a space. Anyone reading the
 * source saw `${kind} ${key}` and wrote a corpus keyed on a space — a lookup that
 * misses silently, so the carrier falls back to UNKNOWN_TO_THE_CORPUS and is weighted
 * at FULL strength instead of the zero its fourteen buckets of history earned it. An
 * invisible character deciding whether the persistence rule applies is exactly the kind
 * of thing that is discovered by a story that should never have grouped.
 */
const CORPUS_KEY_SEPARATOR = '\0';

/**
 * How a carrier is named in a CarrierCorpus. Kind first, then the opaque key, joined by
 * a character no key contains. Build a corpus with THIS function, never by hand.
 */
export function corpusKey(carrier: Fingerprint): string {
  return `${carrier.kind}${CORPUS_KEY_SEPARATOR}${carrier.key}`;
}

/**
 * What a carrier is worth when the corpus has never seen it.
 *
 * Unit IDF and no bucket history, which persistence() reads as persistence zero — so
 * an unknown carrier keeps its full weight and only the by-nature list can zero it.
 *
 * WHY that is the right default rather than zero: the daily bucket table accrues
 * forward only and is empty on day one, so a zero default would mean nothing joins at
 * all until fourteen days of history exist. Grouping has to work for free and on the
 * first afternoon. The cost of this direction is precision, not recall, and it is
 * bounded by the by-nature list, which needs no corpus.
 */
const UNKNOWN_TO_THE_CORPUS: CarrierStats = { idf24h: 1, dfByBucket: [] };

/**
 * What one carrier is worth against this corpus: zero for a generic symbol, zero for
 * something present in every daily bucket, near its IDF for a two-day spike.
 *
 * Exported because MERGE has to ask the same question MEMBERSHIP asks. A story-to-story
 * overlap built on carrier PRESENCE rather than carrier WEIGHT is the thirty-nine-post
 * failure at story granularity — two clusters that share nothing but "$SOL" score an
 * overlap of 1.0 and fold into one — and the by-nature list that protects a join is
 * useless if the merge sweep behind it does not consult it.
 */
export function weightOf(carrier: Fingerprint, p: Policy, corpus: CarrierCorpus = {}): number {
  const stats = corpus[corpusKey(carrier)] ?? UNKNOWN_TO_THE_CORPUS;
  return carrierWeight(carrier.key, stats.idf24h, stats.dfByBucket, p);
}

/** Ranking order for the exact-match kinds, so a tie breaks the same way on replay. */
const KIND_RANK: ReadonlyMap<string, number> = new Map(
  FINGERPRINT_KINDS.map((kind, index) => [kind as string, index]),
);

/**
 * The width and the bar this kind is compared at, or null when the kind is compared
 * as a string.
 *
 * A note that will otherwise be rediscovered expensively: the distance bars are
 * per-kind and per-bit-width, and a bar calibrated for one hash size is meaningless
 * for another. They live in Policy keyed by kind for that reason.
 */
function distanceRuleFor(
  carrier: Fingerprint,
  p: Policy,
): { readonly bits: number; readonly maxDistance: number } | null {
  if (carrier.kind === 'imageHash') {
    return { bits: p.group.imageHashBits, maxDistance: p.group.imageHashMaxDistance };
  }
  if (carrier.kind === 'textShingle') {
    return { bits: p.group.textHashBits, maxDistance: p.group.textHashMaxDistance };
  }
  return null;
}

/**
 * Distance between two hash carriers of the same kind, or null when they cannot be
 * compared at all.
 *
 * ★ THE UNCOMPARABLE CASE IS WHY THIS IS TOTAL AND phash.ts IS NOT. A fingerprint
 * whose key is not a hash of the configured width is not a far-away hash, it is not a
 * hash — today every adapter emits a textShingle whose key is the raw five-word
 * phrase while declaring 64 bits, which the store already refuses. Throwing here would
 * let one malformed row stop grouping for every item behind it in the block; returning
 * "no match" says the true thing, which is that we could not establish they share it.
 * Absence of evidence, spelled as absence.
 */
function comparableDistance(
  a: Fingerprint,
  b: Fingerprint,
  rule: { readonly bits: number; readonly maxDistance: number },
): number | null {
  /* A declared width that disagrees with the policy width is the same category error
     as a wrong-length key, and it is checked separately because a key can be the right
     length by accident. */
  if (a.bits !== undefined && a.bits !== rule.bits) return null;
  if (b.bits !== undefined && b.bits !== rule.bits) return null;
  if (!isHexHash(a.key, rule.bits) || !isHexHash(b.key, rule.bits)) return null;

  const distance =
    a.kind === 'imageHash'
      ? imageHashDistance(a.key, b.key, rule.bits)
      : hammingHex(a.key, b.key);

  return distance <= rule.maxDistance ? distance : null;
}

/**
 * Intersect an item's fingerprints against a story's carriers, applying the per-kind
 * distance bars in Policy.group and the persistence weighting.
 *
 * ONE MATCH PER ITEM FINGERPRINT, never the cross product. A story that has accreted
 * fifty text hashes would otherwise return fifty matches for one arriving hash, and
 * the stage would read fifty pieces of evidence where there is one. The story carrier
 * kept is the CLOSEST one, because that is the one that admitted the item.
 *
 * SORTED STRONGEST FIRST — heaviest weight, then nearest distance (an exact-match kind
 * outranks any near match), then the vocabulary's own kind order, then the key. The
 * last two exist only to make the order total: a replay has to reproduce the carrier
 * that was written into the member row, and a sort that ties has already stopped being
 * reproducible. `matches[0]` is therefore the evidence the stage should log, and
 * `matches[0].weight === 0` means every shared carrier is worthless — M5_generic_carrier,
 * not a join.
 *
 * @param corpus optional. Absent means "no corpus yet", which is the honest state on
 *               day one and is handled by UNKNOWN_TO_THE_CORPUS above, not by refusing
 *               to match. Core may not compute a document frequency itself; it is a
 *               store query, and a stage that ran one could not be replayed.
 * @returns an empty array when nothing is shared. Never throws for "no match".
 */
export function carrierMatches(
  itemFingerprints: readonly Fingerprint[],
  storyCarriers: readonly Fingerprint[],
  p: Policy,
  corpus: CarrierCorpus = {},
): readonly CarrierMatch[] {
  const matches: CarrierMatch[] = [];
  /* One match per DISTINCT carrier. Nothing stops an adapter emitting the same
     fingerprint twice — a repeated hashtag, the same format id read from two fields —
     and a duplicated match would let one carrier vote twice in whatever the stage does
     with this list. */
  const alreadyMatched = new Set<string>();

  for (const mine of itemFingerprints) {
    if (mine.key === '') continue;
    const identity = corpusKey(mine);
    if (alreadyMatched.has(identity)) continue;

    const rule = distanceRuleFor(mine, p);
    let bestDistance: number | null = null;
    let found = false;

    for (const theirs of storyCarriers) {
      /* Comparable ONLY against the same kind — the key is opaque, and two kinds that
         spell the same string are not the same thing. */
      if (theirs.kind !== mine.kind) continue;
      if (theirs.key === '') continue;

      if (rule === null) {
        /* formatId and entitySpan: exact string equality, and distance stays null.
           Null is not "distance zero" — these kinds have no metric, and the store's
           carrier_distance_needs_a_carrier constraint keeps that distinction. A zero
           here would claim we measured something. */
        if (theirs.key !== mine.key) continue;
        found = true;
        break;
      }

      const distance = comparableDistance(mine, theirs, rule);
      if (distance === null) continue;
      found = true;
      if (bestDistance === null || distance < bestDistance) bestDistance = distance;
      if (bestDistance === 0) break;
    }

    if (!found) continue;
    alreadyMatched.add(identity);

    matches.push({
      carrier: mine,
      distance: rule === null ? null : bestDistance,
      weight: weightOf(mine, p, corpus),
    });
  }

  return matches.sort(strongestFirst);
}

/** Total, deterministic, and reproducible on replay. See carrierMatches' doc. */
function strongestFirst(a: CarrierMatch, b: CarrierMatch): number {
  if (a.weight !== b.weight) return b.weight - a.weight;

  /* An exact-match kind has no distance and beats any near match, so it sorts as if
     it were nearer than zero. */
  const nearnessA = a.distance ?? -1;
  const nearnessB = b.distance ?? -1;
  if (nearnessA !== nearnessB) return nearnessA - nearnessB;

  const rankA = KIND_RANK.get(a.carrier.kind) ?? -1;
  const rankB = KIND_RANK.get(b.carrier.kind) ?? -1;
  if (rankA !== rankB) return rankA - rankB;

  if (a.carrier.key === b.carrier.key) return 0;
  return a.carrier.key < b.carrier.key ? -1 : 1;
}
