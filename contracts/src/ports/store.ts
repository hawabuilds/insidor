/**
 * THE REPOSITORY PORTS — what store/ implements and what services/ is handed.
 *
 * These are the only shapes through which anything reaches persistence. SQL exists in
 * exactly one package; this file is the seam. Everything here is async because it is
 * I/O — which is also why no stage may ever be handed one of these: a pure decider
 * that could reach a repository could recompute a feature from fresher data than the
 * one it logged, and that is the single most common way leakage gets reintroduced.
 *
 * Two shapes carry the learning substrate and are worth reading closely:
 *
 *   DecisionRepo.append then markApplied — log FIRST, act, THEN mark. The asymmetry
 *   is deliberate: a logged decision whose side effect failed leaves an unapplied row,
 *   which is detectable and recoverable, whereas a side effect with no log is a
 *   permanent invisible hole that is CORRELATED WITH FAILURES, so it biases exactly
 *   where bias hurts most.
 *
 *   Label.status has four values and everyone gets the third wrong. `pending` is never
 *   coerced to negative — with a median six days to peak, the pending population is
 *   large relative to the resolved one for months. `censored` is excluded from
 *   training but COUNTED, because a rising censoring rate is the earliest sign the
 *   label pipeline is rotting.
 */

import type { Asset, MintTime } from '../asset.ts';
import type { Decision, StageName } from '../decision.ts';
import type { AssetKey, AuthorKey, ChainId, ItemId, SourceId, StoryId, VenueId } from '../ids.ts';
import type { Policy } from '../policy.ts';
import type { SpendLedger } from './meter.ts';
import type { SourceConfiguration, SourceHealth } from '../source.ts';
import type { Story, StoryMember, StoryOrigin } from '../story.ts';
import type {
  Author,
  CounterKind,
  Fingerprint,
  Item,
  Millis,
  Observation,
} from '../vocabulary.ts';

/* ── items, authors, readings ─────────────────────────────────────────── */

export interface ItemRepo {
  upsert(items: readonly Item[]): Promise<number>;
  byId(id: ItemId): Promise<Item | null>;
  byIds(ids: readonly ItemId[]): Promise<ReadonlyMap<ItemId, Item>>;
  /** Items admitted since an instant, for the stages that walk forward in time. */
  admittedSince(at: Millis, limit: number): Promise<readonly Item[]>;
  /** Items due a re-read, newest tier first. The tracking loop's only query. */
  dueForObservation(now: Millis, limit: number): Promise<readonly Item[]>;
}

/**
 * Accounts, and OUR standing for them. `setRosterTier` is a write and not a read for a
 * reason: the tier is recomputed offline from our own history, never taken from a
 * source's follower count. A tier sourced from the platform would be a feature the
 * platform can move, and a model fitted on it would be fitted on someone else's product
 * decisions.
 */
export interface AuthorRepo {
  upsert(authors: readonly Author[]): Promise<number>;
  byKey(key: AuthorKey): Promise<Author | null>;
  /** Our own standing, recomputed offline. Never read from a source. */
  setRosterTier(key: AuthorKey, tier: number): Promise<void>;
}

/**
 * The counter readings, as a series rather than a current value.
 *
 * There is no `set` and no update anywhere on this port. A rate is a DIFFERENCE of two
 * readings, so a reading corrected in place would silently change a rate that was
 * already published and already decided on, and no replay would ever be able to
 * reproduce the original decision. Corrections are new rows; `latest` is a query, not a
 * column.
 */
export interface ObservationRepo {
  /** Append-only. A reading is never corrected in place; a correction is a new row. */
  append(observations: readonly Observation[]): Promise<number>;
  latest(itemId: ItemId, kind: CounterKind): Promise<Observation | null>;
  /** The series a rate is differenced from, oldest first. */
  series(itemId: ItemId, kind: CounterKind, sinceMs: Millis): Promise<readonly Observation[]>;
}

/* ── carriers: the index that makes grouping free ─────────────────────── */

export interface CarrierHit {
  readonly itemId: ItemId;
  readonly storyId: StoryId | null;
  readonly fingerprint: Fingerprint;
  /** Distance in the fingerprint's own metric. 0 for exact-match kinds. */
  readonly distance: number;
}

export interface CarrierRepo {
  index(itemId: ItemId, fingerprints: readonly Fingerprint[]): Promise<void>;
  /** Near-duplicate search. The whole free tier of grouping is this one call. */
  nearest(
    fingerprint: Fingerprint,
    maxDistance: number,
    limit: number,
  ): Promise<readonly CarrierHit[]>;
  /**
   * Daily document frequency per carrier key, for persistence weighting. Accrues
   * FORWARD ONLY: a bucket not written today cannot be reconstructed later, which is
   * why this table starts filling before the feature that reads it exists.
   */
  dailyFrequency(key: string, buckets: number): Promise<readonly number[]>;
}

/* ── stories ──────────────────────────────────────────────────────────── */

export interface StoryRepo {
  upsert(story: Story): Promise<void>;
  byId(id: StoryId): Promise<Story | null>;
  addMembers(members: readonly StoryMember[]): Promise<number>;
  members(id: StoryId): Promise<readonly StoryMember[]>;
  /** Candidate stories an arriving item could join, restricted to a recent window. */
  openSince(at: Millis, limit: number): Promise<readonly Story[]>;
  merge(from: StoryId, into: StoryId, at: Millis): Promise<void>;
}

/* ── assets ───────────────────────────────────────────────────────────── */

export interface AssetRepo {
  upsert(assets: readonly Asset[]): Promise<number>;
  byKey(key: AssetKey): Promise<Asset | null>;
  /**
   * ★ Candidate retrieval is TIME-FIRST. Symbol is a scoring channel over this set
   * and never the retrieval key — searching a vendor by symbol and then filtering by
   * time is the inversion that produces a plausible, wrong, expensive answer.
   *
   * ★ AND IT TAKES THE STORY'S ORIGIN, WHICH IS THE SECOND SUBJECT OF THIS QUESTION.
   * This retrieval is not "which coins are real" — that has one answer and would be a
   * constant. It is "which coins may be compared against THIS story", and a story has a
   * provenance of its own. The implementation turns the origin into an allowlist through
   * `coinOriginsVisibleTo`, which is directional: an observed story may see observed coins
   * and nothing else, ever, while a fixture story may also see the fixtures it exists to
   * demonstrate.
   *
   * It is a REQUIRED parameter and not an optional one with an observed-only default, for
   * 0016's reason. A default here is a caller that never thought about provenance getting
   * an answer anyway — and the answer it would get is the one that silently deletes a
   * story's own coins, which is the branch that reports "no candidates" for a story that
   * has three. A caller must say whose retrieval this is.
   */
  mintedBetween(
    chain: ChainId,
    fromMs: Millis,
    toMs: Millis,
    limit: number,
    storyOrigin: StoryOrigin,
  ): Promise<readonly Asset[]>;
  setMintTime(key: AssetKey, mintedAt: MintTime): Promise<void>;
}

/** Proof that the mint stream was actually watched over an interval. */
export interface CoverageRepo {
  record(venue: VenueId, fromMs: Millis, toMs: Millis): Promise<void>;
  /** Gaps in the window. A label whose window contains a gap is censored, not negative. */
  gaps(venue: VenueId, fromMs: Millis, toMs: Millis): Promise<readonly [Millis, Millis][]>;
}

/* ── the learning substrate ───────────────────────────────────────────── */

/**
 * FOUR statuses, and the header above explains why collapsing any of them into a
 * negative destroys the training set. Restated here because this is the line somebody
 * edits: `pending` is not "no", `censored` is not "no", and `unresolvable` is not
 * "pending forever" — `LabelRepo.due` selects on `pending` alone, so `unresolvable` is
 * the only thing that takes a subject that can never be settled out of the queue
 * without pretending it was settled.
 */
export const LABEL_STATUSES = ['pending', 'resolved', 'censored', 'unresolvable'] as const;

export type LabelStatus = (typeof LABEL_STATUSES)[number];

/**
 * The outcome side of the ledger: what actually happened to a subject a decision was
 * made about, measured over a declared window.
 *
 * ★ ITS KEY IS FIVE COLUMNS, NOT ONE — subject kind and id, label name, label VERSION
 * and window days, exactly as in the primary key of `internal.labels`. Carrying the
 * version and the window in the key is what lets the definition of "did well" be revised
 * without destroying the rows fitted under the old one, and what stops a seven-day
 * measurement and a thirty-day measurement of the same subject from overwriting each
 * other. Drop any component from the key and the table starts averaging measurements
 * that were never of the same quantity.
 *
 * `subjectKind`/`subjectId` are typed from Decision on purpose: they are the join back
 * to the decision that is being scored, and a divergence in spelling would produce a
 * join that quietly matches nothing.
 */
export interface Label {
  readonly subjectKind: Decision['subjectKind'];
  readonly subjectId: string;
  readonly labelName: string;
  readonly labelVersion: string;
  readonly windowDays: number;

  /** The clock the window is measured from. Not the decision's clock. */
  readonly originMs: Millis;
  readonly resolvesAtMs: Millis;
  readonly status: LabelStatus;
  readonly value: number | null;
  /** The thresholded answer. null unless status is 'resolved'. */
  readonly y: boolean | null;
  readonly censorReason: string | null;

  /**
   * ★ REQUIRED, NO DEFAULT. Every measurement declares its population. The study this
   * rebuild followed made a claim about everything from a population of survivors,
   * and a column with no default is that discipline turned into a constraint.
   */
  readonly population: string;
  /** Where the value came from, pinned to a revision. */
  readonly source: string;
  /** When the FIRST evidence arrived, recorded even while pending. One column today,
   *  unrecoverable tomorrow, and it is what makes a delayed-feedback correction possible. */
  readonly firstSignalMs: Millis | null;
  readonly computedAtMs: Millis | null;
}

export interface DecisionRepo {
  /** Log first. Returns the row id the side effect will be marked against. */
  append(decision: Decision): Promise<string>;
  /** Called only after the side effect actually succeeded. */
  markApplied(decisionId: string, at: Millis): Promise<void>;
  byStage(stage: StageName, sinceMs: Millis, limit: number): Promise<readonly Decision[]>;
  bySubject(subjectId: string): Promise<readonly Decision[]>;
}

export interface LabelRepo {
  upsert(labels: readonly Label[]): Promise<number>;
  /** Rows whose window has closed and which still need computing. */
  due(now: Millis, limit: number): Promise<readonly Label[]>;
  bySubject(subjectId: string, labelName: string): Promise<readonly Label[]>;
}

/** The thresholds a past decision was judged against, recoverable by hash. */
export interface PolicyRepo {
  record(hash: string, policy: Policy, at: Millis): Promise<void>;
  byHash(hash: string): Promise<Policy | null>;
}

/* ── liveness ─────────────────────────────────────────────────────────── */

export const STAGE_RUN_OUTCOMES = ['ok', 'empty', 'error'] as const;

/** ★ 'empty' is not 'error'. A stage that found nothing and a stage that died must
 *  be different rows, or a dead pipeline looks exactly like a quiet night. */
export type StageRunOutcome = (typeof STAGE_RUN_OUTCOMES)[number];

export interface StageRunRepo {
  /** Written BEFORE the work. A run never closed leaves an open row forever. */
  open(stage: StageName, host: string, at: Millis): Promise<string>;
  /** Written in a finally, always. */
  close(
    runId: string,
    result: {
      readonly outcome: StageRunOutcome;
      readonly err: string | null;
      readonly itemsIn: number;
      readonly itemsOut: number;
      readonly durationMs: number;
    },
  ): Promise<void>;
  /** Runs open longer than a limit — the query the watchdog lives on. */
  openLongerThan(ms: number, now: Millis): Promise<readonly { stage: StageName; startedAt: Millis }[]>;
}

/**
 * Per-source operational health: what configuration says, and what the calls did.
 *
 * ★ THREE WRITES AND NOT ONE `upsert(SourceHealth)`, because the three facts have
 * three different owners and merging them loses the one that matters. `declare` is
 * written by the process holding the environment and is the ONLY way `dormant` can
 * ever be recorded — nothing observable about a source that is never called tells
 * you whether anybody meant to call it. `recordSuccess` and `recordFailure` are
 * written by whoever made the call, and neither may touch `configuration`: a
 * source answering does not prove somebody configured it deliberately, and a source
 * erroring must never be allowed to rewrite itself as unconfigured, which would
 * turn every outage into "nobody turned this on".
 *
 * A whole-record upsert would let any one of the three clobber the other two, and
 * the direction it would clobber in is always the same: toward the state that looks
 * like nothing is wrong.
 */
export interface SourceHealthRepo {
  /**
   * Record what the environment says about this source. Idempotent; `configuredAt`
   * moves only when the configuration itself changed, so it answers "since when has
   * this been off" rather than "when did we last boot".
   */
  declare(
    source: SourceId,
    configuration: SourceConfiguration,
    detail: string | null,
    at: Millis,
  ): Promise<void>;
  /** A call that worked. Resets the consecutive-failure count to zero. */
  recordSuccess(source: SourceId, at: Millis): Promise<void>;
  /** A call that did not. `reason` is the vendor's message, kept whole. */
  recordFailure(source: SourceId, at: Millis, reason: string): Promise<void>;
  /** Every source we have ever declared. The projector's one read. */
  all(): Promise<readonly SourceHealth[]>;
}

/* ── everything a service is handed ───────────────────────────────────── */

export interface Store {
  readonly items: ItemRepo;
  readonly authors: AuthorRepo;
  readonly observations: ObservationRepo;
  readonly carriers: CarrierRepo;
  readonly stories: StoryRepo;
  readonly assets: AssetRepo;
  readonly coverage: CoverageRepo;
  readonly decisions: DecisionRepo;
  readonly labels: LabelRepo;
  readonly policies: PolicyRepo;
  readonly stageRuns: StageRunRepo;
  readonly sourceHealth: SourceHealthRepo;
  /**
   * The durable half of the money path. Declared in `ports/meter.ts` beside the
   * synchronous `Meter` it outlives, and listed here because it is a table like every
   * other member of this bag — a service that holds a Store holds the ledger that
   * makes its daily cap survive a restart.
   */
  readonly spend: SpendLedger;
}
