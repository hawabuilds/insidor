/**
 * The migration runner. Forward-only, numbered, with one ledger table.
 *
 * The build this replaces had 23 loose `schema-*.sql` files, eleven different
 * things that applied them, no ordering, no ledger, and two migrations that were
 * written and never applied to production — so nobody could say what shape the
 * database was actually in. Every rule below exists to make one of those states
 * impossible rather than unlikely:
 *
 *   - a file's checksum is recorded, so editing an applied migration is an error
 *     instead of a silent divergence between environments;
 *   - a file that sorts before the highest applied migration is an error, because
 *     inserting history is how two databases end up with the same ledger and
 *     different schemas;
 *   - an applied migration missing from disk is an error, not a shrug;
 *   - each file runs in its own transaction, so a failure leaves the database at a
 *     numbered, nameable point rather than half way through one.
 *
 * There is no `down`. Rolling a schema backwards on a live system with an
 * append-only decision log is a data-loss operation wearing a safety word; the
 * forward fix is another numbered file.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Db } from './client.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const FILENAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  readonly filename: string;
  readonly ordinal: number;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly filename: string;
  readonly checksum: string;
}

/**
 * The ledger lives in `internal` and is created before anything else runs,
 * including 0001. That is why both this bootstrap and 0001 say `if not exists` for
 * the schema: the ledger has to exist before the migration that would have created
 * its home, and the two must not fight over who did it.
 */
const BOOTSTRAP = `
  create schema if not exists internal;
  create table if not exists internal.schema_migration (
    filename    text primary key,
    ordinal     integer not null,
    checksum    text not null,
    applied_at  timestamptz not null default now(),
    duration_ms integer not null
  );
`;

export async function loadMigrations(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const files: MigrationFile[] = [];

  for (const filename of entries.sort()) {
    if (!filename.endsWith('.sql')) continue;
    const match = FILENAME_PATTERN.exec(filename);
    if (!match?.[1]) {
      throw new Error(
        `migration '${filename}' is misnamed: expected NNNN_lower_snake_case.sql`,
      );
    }
    const sql = await readFile(join(dir, filename), 'utf8');
    files.push({
      filename,
      ordinal: Number(match[1]),
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  // Duplicate ordinals mean two branches numbered a migration the same, which
  // resolves into two different databases sharing one ledger. Catch it here.
  const seen = new Map<number, string>();
  for (const file of files) {
    const clash = seen.get(file.ordinal);
    if (clash) {
      throw new Error(`migrations ${clash} and ${file.filename} share ordinal ${file.ordinal}`);
    }
    seen.set(file.ordinal, file.filename);
  }

  return files;
}

/**
 * Compare the files on disk against the ledger and return what still has to run.
 * Pure, so the rules above are testable without a database.
 */
export function planMigrations(
  onDisk: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationFile[] {
  const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));

  for (const [filename] of appliedByName) {
    if (!onDisk.some((file) => file.filename === filename)) {
      throw new Error(
        `migration '${filename}' is recorded as applied but is missing from disk; ` +
          'the schema history is not reconstructable',
      );
    }
  }

  const pending: MigrationFile[] = [];
  let highestApplied = 0;

  for (const file of onDisk) {
    const recorded = appliedByName.get(file.filename);
    if (recorded === undefined) {
      pending.push(file);
      continue;
    }
    if (recorded !== file.checksum) {
      throw new Error(
        `migration '${file.filename}' changed after it was applied. Applied migrations are ` +
          'immutable; write a new numbered file instead.',
      );
    }
    highestApplied = Math.max(highestApplied, file.ordinal);
  }

  for (const file of pending) {
    if (file.ordinal < highestApplied) {
      throw new Error(
        `migration '${file.filename}' sorts before applied migration ${highestApplied}. ` +
          'History is forward-only; renumber the file to the end.',
      );
    }
  }

  return pending;
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: number;
}

/**
 * Apply everything pending. `runInTransaction` is injected rather than imported so
 * this function is testable against a fake, and so the caller owns the pool.
 */
export async function migrate(
  db: Db,
  runInTransaction: <T>(fn: (tx: Db) => Promise<T>) => Promise<T>,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrateResult> {
  await db.query(BOOTSTRAP);

  const onDisk = await loadMigrations(dir);
  const applied = await db.query<{ filename: string; checksum: string }>(
    'select filename, checksum from internal.schema_migration',
  );
  const pending = planMigrations(onDisk, applied);

  const done: string[] = [];
  for (const file of pending) {
    const startedAt = Date.now();
    await runInTransaction(async (tx) => {
      await tx.query(file.sql);
      await tx.query(
        `insert into internal.schema_migration (filename, ordinal, checksum, duration_ms)
         values ($1, $2, $3, $4)`,
        [file.filename, file.ordinal, file.checksum, Date.now() - startedAt],
      );
    });
    done.push(file.filename);
  }

  return { applied: done, alreadyApplied: applied.length };
}

/**
 * Run it. `pnpm --filter @insidor/store migrate`.
 *
 * The pool is imported dynamically so that everything above stays importable — and
 * therefore testable — without `pg` being loaded at all. The planner's rules are
 * pure functions over filenames and checksums; making them require a database to
 * exercise would be the fastest way to stop exercising them.
 */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { createPool, asDb, withTransaction } = await import('./client.ts');
  const pool = createPool('internal', { applicationName: 'insidor-migrate' });
  try {
    const result = await migrate(asDb(pool), (fn) => withTransaction(pool, fn));
    for (const filename of result.applied) console.log(`applied ${filename}`);
    console.log(
      result.applied.length === 0
        ? `up to date (${result.alreadyApplied} migrations)`
        : `${result.applied.length} applied, ${result.alreadyApplied} already present`,
    );
  } finally {
    await pool.end();
  }
}
