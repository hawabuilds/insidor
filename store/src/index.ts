/**
 * The package's one barrel, because the exports map needs one.
 *
 * It lists what a service wires up and nothing else. If this file ever grows a
 * `export *`, the boundary this package exists to hold becomes a suggestion: a
 * barrel that re-exports everything is how a caller ends up importing a row type
 * and writing SQL somewhere that is not here.
 */

export { createPool, asDb, withTransaction, withAdvisoryLock, DB_ROLE } from './client.ts';
export type { Db, DbRole, PoolOptions } from './client.ts';

export { migrate, loadMigrations, planMigrations } from './migrate.ts';
export type { MigrationFile, MigrateResult } from './migrate.ts';

export { NotImplemented } from './not-implemented.ts';

export { PgItemRepo } from './repo/items.ts';
export type { TrackingFacts, TrackingJudgement } from './repo/items.ts';
export { PgAuthorRepo } from './repo/authors.ts';
export { PgObservationRepo } from './repo/observations.ts';
export { PgStoryRepo } from './repo/stories.ts';
/* Presentation is a column set, not a field set. The type is exported so the one
   stage that writes a title says so in the vocabulary of this package rather than
   inventing its own — and so nobody is tempted to hang it off Story. */
export type { StoryPresentation } from './repo/stories.ts';
export { PgAssetRepo } from './repo/assets.ts';
export { PgDecisionRepo, featureHash } from './repo/decisions.ts';
export { PgBackfillRepo } from './repo/backfill.ts';
export { PgCoinUniverseRepo } from './repo/coin-universe.ts';
export type { AgedCoin, CoinMetadataRow, CoinToCheck, LookupTerm, NamingPost, PostCoinPicture, StandingRow, UnreadCoin } from './repo/coin-universe.ts';
export { PgOlderCoinRepo } from './repo/older-coin.ts';
export { fromBits, missingTable, PgImageHashRepo, toBits } from './repo/image-hash.ts';
export type { DuePicture, PictureNeighbour } from './repo/image-hash.ts';
export type { DueOlderCoin, FoundOlderCoin, OlderCoinReading } from './repo/older-coin.ts';
export { PgCryptoAttentionRepo } from './repo/crypto-attention.ts';
export type { AttentionRow, DueAttention } from './repo/crypto-attention.ts';
export { PgPostRefillRepo } from './repo/post-refill.ts';
export type { RefillDue } from './repo/post-refill.ts';
export type { BackfilledPost, BackfillRun, BackfillVia } from './repo/backfill.ts';
export { PgFeedFloorRepo } from './repo/feed-floor.ts';
export { PgOwnerAlertRepo } from './repo/owner-alerts.ts';
export type { OwnerAlert } from './repo/owner-alerts.ts';
export { PgRecallRepo } from './repo/recall.ts';
export { PgMissedPostRepo } from './repo/missed-posts.ts';
export type { HeldPost, MissedJudgement, MissedOutcome, MissedPostFacts, MissedRow, NamedCoin, QueuedMissedPost } from './repo/missed-posts.ts';
export { PgLearningRepo } from './repo/learning.ts';
export type { AppliedExamples, ExamplesVersion, GoldAddition, MissedPost, OwnerNameCall, OwnerPostCall, RecallOrigin, RetuneOutcome } from './repo/learning.ts';
export type { GrowthPair, LaneMeasured, RecallDay, RecallRow, RecallRun } from './repo/recall.ts';
export { PgImageEmbeddingRepo } from './repo/image-embeddings.ts';
export { PgImagePairRepo } from './repo/image-pairs.ts';
export type { ImageMatch, UnembeddedImage } from './repo/image-embeddings.ts';
export { PgJudgementRepo, PgPostJudgementRepo } from './repo/judgements.ts';
export type { ReusableAnswer } from './repo/judgements.ts';
export { PgLabelRepo } from './repo/labels.ts';
export type { LabelKey } from './repo/labels.ts';
export { PgStageRunRepo } from './repo/runs.ts';
/* Per-source health. Written by whoever calls a source, read by the projector — the
   two halves of the one fact the app cannot fetch for itself, because both of its
   ingredients live where the app's role has no USAGE. */
export { PgSourceHealthRepo } from './repo/sources.ts';
/* The spend ledger. Read once at boot to seed the meter's tally and written behind
   every recorded call — which is the whole of "a restart is not a fresh day's budget".
   Without this export the cap in policy means "per process lifetime". */
export { PgSpendRepo } from './repo/spend.ts';
export type { StageRunClose } from './repo/runs.ts';
export { PgHistoryRepo } from './repo/history.ts';
export { PgJobFileRepo } from './repo/job-files.ts';
export { PgCoinedPictureRepo } from './repo/coined-pictures.ts';
export { LABEL_RANK, PgLabelEmbeddingRepo, mergeLabels } from './repo/label-embeddings.ts';
export { CURRENT_COIN_CALLS, PgOwnerCoinCallRepo } from './repo/owner-coin-calls.ts';
export type { StoredCoinCall } from './repo/owner-coin-calls.ts';
export type { LabelKind, LabelledPost, StoredLabel } from './repo/label-embeddings.ts';
export { FEED_REJECTION_REASONS, PgFeedRejectionRepo } from './repo/feed-rejections.ts';
export type { FeedRejection, FeedRejectionReason } from './repo/feed-rejections.ts';
export { FEED_HISTORY_RETENTION_MS, recordFeedHistory } from './repo/feed-history.ts';
export type { FeedHistoryOutcome } from './repo/feed-history.ts';
export type { JobFile } from './repo/job-files.ts';
export type { HistoryGap, HistoryOriginPost, PastNarrative, PendingNarrative, SpendRow, SpendStep } from './repo/history.ts';
