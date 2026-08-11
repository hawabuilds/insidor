/**
 * The migration planner's three refusals, tested without a database.
 *
 * These are the failures that produced 23 loose schema files and two environments
 * nobody could compare in the build this replaces, so they are the first tests in
 * this package.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planMigrations } from './migrate.ts';
import type { AppliedMigration, MigrationFile } from './migrate.ts';

const file = (ordinal: number, name: string, checksum: string): MigrationFile => ({
  filename: `${String(ordinal).padStart(4, '0')}_${name}.sql`,
  ordinal,
  sql: `-- ${name}`,
  checksum,
});

const applied = (filename: string, checksum: string): AppliedMigration => ({ filename, checksum });

test('pending migrations are the ones with no ledger row', () => {
  const onDisk = [file(1, 'schemas', 'aaa'), file(2, 'items', 'bbb')];
  const pending = planMigrations(onDisk, [applied('0001_schemas.sql', 'aaa')]);
  assert.deepEqual(
    pending.map((m) => m.filename),
    ['0002_items.sql'],
  );
});

test('editing an applied migration is an error, not a silent divergence', () => {
  const onDisk = [file(1, 'schemas', 'edited')];
  assert.throws(
    () => planMigrations(onDisk, [applied('0001_schemas.sql', 'original')]),
    /changed after it was applied/,
  );
});

test('a new migration numbered before an applied one is refused', () => {
  // The dangerous case: two people branch, both add a migration, one merges first.
  // Inserting history leaves two databases with identical ledgers and different schemas.
  const onDisk = [file(1, 'schemas', 'aaa'), file(2, 'sneaked_in', 'ccc'), file(3, 'items', 'bbb')];
  assert.throws(
    () =>
      planMigrations(onDisk, [applied('0001_schemas.sql', 'aaa'), applied('0003_items.sql', 'bbb')]),
    /sorts before applied migration 3/,
  );
});

test('an applied migration missing from disk is an error', () => {
  assert.throws(
    () => planMigrations([file(1, 'schemas', 'aaa')], [applied('0002_gone.sql', 'bbb')]),
    /missing from disk/,
  );
});

test('a clean database plans every file, in order', () => {
  const onDisk = [file(1, 'schemas', 'a'), file(2, 'items', 'b'), file(3, 'observations', 'c')];
  assert.deepEqual(
    planMigrations(onDisk, []).map((m) => m.ordinal),
    [1, 2, 3],
  );
});
