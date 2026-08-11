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
export { PgObservationRepo } from './repo/observations.ts';
export { PgStoryRepo } from './repo/stories.ts';
export { PgAssetRepo } from './repo/assets.ts';
export { PgDecisionRepo, featureHash } from './repo/decisions.ts';
export { PgLabelRepo } from './repo/labels.ts';
export { PgStageRunRepo } from './repo/runs.ts';
export type { StageRunClose } from './repo/runs.ts';
