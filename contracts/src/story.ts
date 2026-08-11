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

import type { AuthorKey, ItemId, SourceId, StoryId } from './ids.ts';
import type { Fingerprint, FingerprintKind, Millis } from './vocabulary.ts';

export const STORY_STATES = [
  'candidate', // has members, has not earned a place anywhere yet
  'promoted', // crossed the promotion bar; downstream stages may look at it
  'merged', // folded into an older story that shares its carriers
  'closed', // no longer accreting members
] as const;

export type StoryState = (typeof STORY_STATES)[number];

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
