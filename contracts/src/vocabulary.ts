/**
 * THE VOCABULARY. Four nouns. Everything else in the system is spelled with them.
 *
 *   Item        — something a person posted, in our words, never a source's.
 *   Author      — the account that posted it, identified by a key that survives a rename.
 *   Observation — one reading of one counter at one instant, carrying an honest
 *                 statement of how much that reading can be trusted.
 *   Rate        — what a pair of readings tells you about change, INCLUDING the
 *                 case where the honest answer is "nothing". See below.
 *
 * (Decision, the fifth noun, lives in decision.ts because every stage returns one
 * and it is the only thing in the system that cannot be reconstructed later.)
 *
 * RULES, enforced by tools/check-vocabulary.mjs:
 *   - Type-only imports from sibling contracts files. Nothing else, ever.
 *   - No word naming a platform, a chain, or a vendor — in code OR in comments.
 *     Not a source's own word for one of its counters. A field name is how a leak
 *     actually arrives: one source's share count landing in a column named after a
 *     different source's feature is not a typo, it is what happens when the
 *     vocabulary belongs to whoever wrote the first adapter.
 *   - Adding a field here is a real decision. Adding one to a FeatureVector is not.
 */

import type { AuthorKey, ItemId, SourceId } from './ids.ts';

/** Epoch milliseconds. Never a Date: a Date is mutable and is not JSON. */
export type Millis = number;

/* ── what a source can count ──────────────────────────────────────────── */

/**
 * The six countable things. A source exposes some subset; declaring which is the
 * adapter's job (see ports/platform.ts, Capabilities.absent).
 *
 * `rebroadcast` and `reproduction` are separate kinds, and that separation IS the
 * product thesis expressed as a type. A rebroadcast is a copy that creates no new
 * authored object; a reproduction is a copy that does. "People are making their
 * own versions of this" is the signal we sell. "A lot of people saw this" is not.
 */
export const COUNTER_KINDS = [
  'reach', // impressions-like. NOT comparable across sources — only against itself.
  'approval', // the one-tap positive
  'conversation', // a written response
  'rebroadcast', // a copy that creates NO new authored object
  'reproduction', // a copy that DOES create one  ← the thesis, as a type
  'retention', // saved for later
] as const;

export type CounterKind = (typeof COUNTER_KINDS)[number];

/**
 * How much you may trust the number. Not decoration: the core BRANCHES on this,
 * and it is the reason a flat counter never emits a zero rate.
 *
 * `quantized` carries significantDigits rather than a step, because that is what a
 * source's rounding actually is — the step depends on the magnitude of the value,
 * and deriving it is core's job (kinetics/fidelity.ts), not the adapter's.
 */
export type Fidelity =
  | { readonly kind: 'exact' }
  | { readonly kind: 'quantized'; readonly significantDigits: number }
  | { readonly kind: 'fuzzed' } // deliberately perturbed at the source
  | { readonly kind: 'absent' }; // the source has no such concept. NOT zero.

export interface Counter {
  /** null means "not read this time". Absence of the CONCEPT is Fidelity.absent. */
  readonly value: number | null;
  readonly fidelity: Fidelity;
  /** When WE read it. Never when the source claims it changed. */
  readonly observedAt: Millis;
  /** Set only when the source admits its own staleness. */
  readonly lagMs?: number;
}

export type CounterSet = Readonly<Partial<Record<CounterKind, Counter>>>;

/* ── rate: the type that makes "we learned nothing" unignorable ────────── */

/** Why a pair of readings produced no usable rate. Closed list; core branches on it. */
export const CENSOR_REASONS = [
  'unusable_fidelity', // absent or fuzzed — the reading cannot support a difference
  'below_step', // quantized, and the change is under the rounding step
  'stale_counter', // unchanged while a sibling counter rose
  'non_monotonic', // went backwards
  'no_prior', // first reading; nothing to difference against
  'no_elapsed', // two readings at the same instant
] as const;

export type CensorReason = (typeof CENSOR_REASONS)[number];

/**
 * ★ THE LOAD-BEARING TYPE IN THIS FILE.
 *
 * A rate is EITHER measured OR censored. There is no third state and no numeric
 * fallback, so `rate.perMin` does not typecheck until the caller has proved the
 * measured branch. That compile error is the whole design: the build this replaces
 * published `0` for a censored reading, `0` reads downstream as "cooling", and
 * cooling demotes exactly the items that are accelerating. Wrong in the most
 * expensive direction, and unfindable, because a zero looks like data.
 *
 * A censored reading also carries the previous LEVEL forward — levels stay usable
 * even when differences do not — which is why `lastLevel` rides along here.
 */
export type Rate =
  | {
      readonly kind: 'measured';
      readonly perMin: number;
      /** The interval the difference was taken over. A rate without it is unweightable. */
      readonly overMs: number;
      /** The level at the later reading, carried for convenience. */
      readonly level: number;
    }
  | {
      readonly kind: 'censored';
      readonly reason: CensorReason;
      /** The most recent trustworthy level, or null if there has never been one. */
      readonly lastLevel: number | null;
    };

export function measuredRate(perMin: number, overMs: number, level: number): Rate {
  return { kind: 'measured', perMin, overMs, level };
}

export function censoredRate(reason: CensorReason, lastLevel: number | null): Rate {
  return { kind: 'censored', reason, lastLevel };
}

/**
 * The flattened spelling of a Rate, for the one place a union cannot go: a database
 * row. store/ owns the mapping; nothing in core/ may take this shape as an input,
 * because a `number | null` is precisely the shape that lets a caller skip the
 * censored case and get a plausible zero.
 */
export interface StoredRate {
  readonly ratePerMin: number | null;
  readonly censored: CensorReason | null;
}

export function toStoredRate(rate: Rate): StoredRate {
  return rate.kind === 'measured'
    ? { ratePerMin: rate.perMin, censored: null }
    : { ratePerMin: null, censored: rate.reason };
}

/* ── carriers: what makes two items the same thing ────────────────────── */

export const FINGERPRINT_KINDS = [
  'imageHash', // perceptual hash of a still frame — has no language and no source
  'textShingle', // near-duplicate text, as a rolling n-gram key
  'formatId', // a reusable template: a sound, an effect, a layout
  'entitySpan', // a named thing occurring in the text
] as const;

export type FingerprintKind = (typeof FINGERPRINT_KINDS)[number];

export interface Fingerprint {
  readonly kind: FingerprintKind;
  /** Opaque. Comparable ONLY against the same kind. */
  readonly key: string;
  /** Present for hashes supporting a distance; absent for exact-match kinds. */
  readonly bits?: number;
}

export interface MediaRef {
  readonly kind: 'image' | 'video' | 'audio';
  readonly uri: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
}

/* ── AUTHOR ───────────────────────────────────────────────────────────── */

/**
 * What we know about the account, not who they are. There is deliberately no
 * handle and no display name here: both are mutable, both are re-issued to other
 * people, and neither may ever be a join key.
 *
 * `audience` is a Counter rather than a number for the same reason every other
 * count is — some sources round it, some hide it, and one of them fuzzes it.
 */
export interface Author {
  readonly authorKey: AuthorKey;
  readonly source: SourceId;
  readonly firstSeenAt: Millis;
  /** Follower-like size, with its fidelity. null when the source exposes none. */
  readonly audience: Counter | null;
  /**
   * Our own standing for this account, in [0,1], computed by core from history.
   * Never read from a source: a source's own prominence metric is theirs to game.
   */
  readonly rosterTier: number | null;
}

/* ── ITEM ─────────────────────────────────────────────────────────────── */

export interface Item {
  readonly itemId: ItemId; // ours
  readonly source: SourceId;
  readonly sourceItemId: string; // theirs
  /** A stable id, never a display handle. Handles change; ours must not. */
  readonly authorKey: AuthorKey;

  /** null when the source omits it or is known to lie. Never defaulted to now. */
  readonly postedAt: Millis | null;
  readonly firstSeenAt: Millis;

  readonly lang: string | null;
  readonly text: string;
  readonly media: readonly MediaRef[];
  readonly counters: CounterSet;
  readonly fingerprints: readonly Fingerprint[];

  /** Added ZERO new authorship. */
  readonly rebroadcastOf: ItemId | null;
  /** Added ONE new authorship. The signal we sell. */
  readonly reproductionOf: ItemId | null;

  /** Reusable templates — a sound, an effect, a layout. Free carrier joins. */
  readonly formatIds: readonly string[];

  /** Key into blob storage. The raw payload is NEVER inlined here. */
  readonly rawRef: string;
}

/* ── OBSERVATION ──────────────────────────────────────────────────────── */

/**
 * One reading of one counter, plus what it told us about change.
 *
 * The rate is a Rate, not a number, so every consumer meets the censored case at
 * the type level. Persisting it flattens through toStoredRate(); nothing else may.
 */
export interface Observation {
  readonly itemId: ItemId;
  readonly capturedAt: Millis;
  readonly kind: CounterKind;
  readonly counter: Counter;
  readonly rate: Rate;
}
