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
export { PgAuthorRepo } from './repo/authors.ts';
export { PgObservationRepo } from './repo/observations.ts';
export { PgStoryRepo } from './repo/stories.ts';
/* Presentation is a column set, not a field set. The type is exported so the one
   stage that writes a title says so in the vocabulary of this package rather than
   inventing its own — and so nobody is tempted to hang it off Story. */
export type { StoryPresentation } from './repo/stories.ts';
export { PgAssetRepo } from './repo/assets.ts';
export { PgDecisionRepo, featureHash } from './repo/decisions.ts';
export { PgLabelRepo } from './repo/labels.ts';
export type { LabelKey } from './repo/labels.ts';
export { PgStageRunRepo } from './repo/runs.ts';
/* Per-source health. Written by whoever calls a source, read by the projector — the
   two halves of the one fact the app cannot fetch for itself, because both of its
   ingredients live where the app's role has no USAGE. */
export { PgSourceHealthRepo } from './repo/sources.ts';
export type { StageRunClose } from './repo/runs.ts';
