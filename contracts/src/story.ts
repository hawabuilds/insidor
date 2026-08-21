/**
 * STORY — the claim that several items are versions of one real-world moment.
 *
 * This is the noun the product is about: not "a post did well" but "people are
 * making their own versions of this". The evidence for that claim is recorded per
 * member, as a discriminated union, because the tiers cost wildly different amounts
 * and degrade independently — a representation outage must downgrade grouping to
 * the free carrier tiers, not stop it. If anything ever makes the paid tier a
 * precondition for joining, that resilience is gone and nobody decided to lose it.
 *
 * Nothing here is a title, a thumbnail or a display string. What a person sees is
 * a projection, built in store/, from a separate wire vocabulary.
 */

import type { AssetOrigin } from './asset.ts';
import { OBSERVED_ASSET_ORIGINS } from './asset.ts';
import type { AuthorKey, ItemId, SourceId, StoryId } from './ids.ts';
import type { Fingerprint, FingerprintKind, Millis } from './vocabulary.ts';

export const STORY_STATES = [
  'candidate', // has members, has not earned a place anywhere yet
  'promoted', // crossed the promotion bar; downstream stages may look at it
  'merged', // folded into an older story that shares its carriers
  'closed', // no longer accreting members
] as const;

export type StoryState = (typeof STORY_STATES)[number];

/* ── where the row came from ──────────────────────────────────────────── */

/**
 * ★ HOW THIS STORY ROW CAME TO BE HERE — what kind of contact with the world produced it.
 *
 * A story is the one noun in this system with no observation of its own. It is a CLAIM
 * ABOUT ITEMS, assembled from them, and every clock on it is minimised out of its members.
 * So a story had no way to say whether the items under it are things people posted or rows
 * a demonstration script wrote — and every surface derived from a story had to answer that
 * question some other way. The one that mattered answered it with a constant compiled into
 * a service, which is the bug `coinOriginsVisibleTo` below exists to close.
 *
 * ★ TWO VALUES AND NOT THE FIVE OF ASSET_ORIGINS, and the difference is not tidiness.
 * Those five name kinds of TRANSPORT — a push socket, a listing read after the fact, a
 * person typing — because an asset row arrives over one of them. Nothing pushes stories at
 * us and nobody fetches one from a vendor: a story is either assembled from items we
 * observed, or written whole by a tool. Borrowing 'live_stream' here would name a
 * transport this table does not have, and the first query to filter on it would be
 * filtering on a fiction.
 *
 * An array and not a bare union, because this list is also a CHECK constraint in
 * store/migrations/0016_story_origin.sql and store/src/migrations.test.ts asserts the two
 * are the same list. A CHECK that has drifted from its union typechecks perfectly and
 * fails at 3am on the first row of the kind nobody wrote a test for.
 */
export const STORY_ORIGINS = [
  /**
   * Assembled from items that came from the world. It says nothing about WHICH transport
   * each of those items arrived over — that fact belongs to the item, not to the claim
   * built on top of it — only that a person, somewhere, actually posted them.
   */
  'observed',
  /**
   * Written by a seed or a demonstration tool. NEVER a claim about the world, and the
   * value that makes a demonstration row sayable as what it is.
   */
  'fixture',
] as const;

export type StoryOrigin = (typeof STORY_ORIGINS)[number];

/**
 * ★ WHICH COINS THIS STORY MAY EVEN BE COMPARED AGAINST. A DIRECTIONAL allowlist, and the
 * direction is the entire content of this function.
 *
 * THE RULE IS NOT "SAME ORIGIN", AND WRITING IT THAT WAY WOULD BE WRONG IN BOTH
 * DIRECTIONS. The two mistakes are not each other's mirror image:
 *
 *   A FIXTURE STORY SEEING AN OBSERVED COIN IS HARMLESS. The row is already labelled a
 *   demonstration everywhere it is shown; a demonstration that happens to match a real
 *   coin is still a demonstration, and nobody is told anything false about the world.
 *
 *   AN OBSERVED STORY SEEING A FIXTURE COIN IS THE WHOLE BUG. That row says a real moment
 *   produced this coin, with a cap beside it and — once resolve is confident — a Buy
 *   affordance behind it. An invented coin arriving there is a fiction presented as a
 *   finding, which is the failure this vocabulary was introduced to make unsayable.
 *
 * So the observed origins are visible to EVERYONE and 'fixture' is visible ONLY to a
 * fixture story. Asymmetric on purpose.
 *
 * ★ AND `unrecorded` IS VISIBLE TO NOBODY, including a fixture story. It is not a kind of
 * row, it is an admission that we cannot place one; a story of any origin naming such a
 * coin would be presenting a row nobody can vouch for. That it stays out is a property of
 * OBSERVED_ASSET_ORIGINS rather than a clause here, which is the point of building this
 * out of that list instead of subtracting values from ASSET_ORIGINS.
 *
 * ★ THE FALL-THROUGH RUNS THE NARROW WAY. A third story origin added next year is not
 * 'fixture', so it gets the observed list and nothing else — it has to be named on this
 * line to see invented rows. That is the direction an allowlist must fail in, and it is
 * the same argument OBSERVED_ASSET_ORIGINS makes about `<> 'fixture'` one file over.
 */
export function coinOriginsVisibleTo(origin: StoryOrigin): readonly AssetOrigin[] {
  return origin === 'fixture'
    ? [...OBSERVED_ASSET_ORIGINS, 'fixture']
    : [...OBSERVED_ASSET_ORIGINS];
}

/**
 * Why we believe this item belongs to this story. Kept per member rather than per
 * story so the mix is auditable: "what fraction of joins were free?" is the
 * question that decides whether the paid tier is worth its bill.
 */
export type MatchEvidence =
  /** The first member. There was nothing to match against. */
  | { readonly kind: 'seed' }
  /** Tier 1: an exact or near-exact shared carrier. Free, deterministic, language-blind. */
  | {
      readonly kind: 'carrier';
      readonly carrier: FingerprintKind;
      readonly key: string;
      /** Hamming-style distance for hash carriers; null for exact-match carriers. */
      readonly distance: number | null;
      /** The carrier's weight at join time — a carrier everyone uses is not evidence. */
      readonly weight: number;
    }
  /** Tier 1: an explicit pointer from one item to another. Free and unambiguous. */
  | {
      readonly kind: 'lineage';
      readonly via: 'reproduction' | 'rebroadcast';
      readonly toItem: ItemId;
    }
  /** Tier 2: learned representation similarity, for what the free tiers missed. */
  | {
      readonly kind: 'representation';
      /** Cosine in the space named below. Bars are per-space and NEVER shared. */
      readonly similarity: number;
      /** Opaque space id, e.g. 'text.v2'. A bar tuned on one space is meaningless on another. */
      readonly space: string;
    }
  /** A human decided. Rare, and the source of the labels the model is fit on. */
  | { readonly kind: 'adjudicated'; readonly by: string; readonly at: Millis };

export interface StoryMember {
  readonly storyId: StoryId;
  readonly itemId: ItemId;
  /** Denormalised so breadth is countable without loading every item. */
  readonly authorKey: AuthorKey;
  readonly source: SourceId;
  readonly postedAt: Millis | null;
  readonly joinedAt: Millis;
  readonly evidence: MatchEvidence;
}

export interface Story {
  readonly storyId: StoryId;
  readonly state: StoryState;

  /**
   * What kind of contact with the world produced this row. See STORY_ORIGINS, and
   * `coinOriginsVisibleTo` for the one rule that reads it.
   *
   * There is no default here and there is none in the schema either: a writer that has not
   * thought about this fails, rather than silently certifying a demonstration as a finding.
   * It is a fact about how the row came to exist, so nothing ever updates it — the upsert
   * in store/src/repo/stories.ts leaves it alone for the same reason it leaves `createdAt`
   * alone.
   */
  readonly origin: StoryOrigin;

  readonly createdAt: Millis;
  /** When it crossed the promotion bar. null while it is still a candidate. */
  readonly promotedAt: Millis | null;
  /** The earliest post time among members. The clock every pre-mint ordering test uses. */
  readonly earliestPostAt: Millis;
  /** The newest input datum any downstream stage is allowed to see. */
  readonly lastMemberAt: Millis;

  readonly memberCount: number;
  /** Breadth, not volume: one author posting forty times is not forty reproducers. */
  readonly distinctAuthors: number;
  readonly distinctSources: number;

  /** The carriers that define membership. A joining item is tested against these. */
  readonly carriers: readonly Fingerprint[];

  /** Set only in state 'merged'. Follow it once; cycles are a store invariant. */
  readonly mergedInto: StoryId | null;
}
