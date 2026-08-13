/**
 * Properties of the migration set itself, asserted as text.
 *
 * These are greps, and greps stop accidents rather than adversaries — which is the
 * right threat model for two people. Each one corresponds to a guarantee stated
 * somewhere in prose, and prose is what the previous build had instead of checks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CENSOR_REASONS, MINT_TIME_SOURCES } from '@insidor/contracts';
import { STORY_STATES } from '@insidor/contracts/story.ts';

import { loadMigrations } from './migrate.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const read = (filename: string): string =>
  readFileSync(join(MIGRATIONS_DIR, filename), 'utf8').toLowerCase();

/**
 * Comments in these files discuss the very statements the checks below forbid —
 * explaining why retention is a DROP PARTITION rather than a DELETE, for instance.
 * A grep that cannot tell an explanation from an instruction produces failures
 * nobody trusts, and a check nobody trusts gets commented out.
 */
const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

test('migrations are numbered contiguously from 1', async () => {
  const files = await loadMigrations(MIGRATIONS_DIR);
  assert.ok(files.length > 0, 'there are no migrations');
  assert.deepEqual(
    files.map((f) => f.ordinal),
    files.map((_, index) => index + 1),
  );
});

test('no migration destroys data', async () => {
  // Forward-only means additive. A DROP or a DELETE in a numbered file is a
  // rollback wearing a safety word, and on an append-only decision log it is
  // unrecoverable. Adding a column, a table or a constraint is always fine.
  const destructive = /\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/;
  for (const file of await loadMigrations(MIGRATIONS_DIR)) {
    assert.equal(
      destructive.test(stripComments(file.sql.toLowerCase())),
      false,
      `${file.filename} contains a destructive statement`,
    );
  }
});

test('the app role is never granted anything outside public', async () => {
  // The whole point of the schema split: the app cannot obtain a score even by
  // accident, because it has no USAGE on the schema that holds one.
  for (const file of await loadMigrations(MIGRATIONS_DIR)) {
    for (const line of stripComments(file.sql.toLowerCase()).split('\n')) {
      if (!line.trimStart().startsWith('grant') || !line.includes('insidor_app')) continue;
      assert.equal(
        /\binternal\.|schema internal|\braw\.|schema raw/.test(line),
        false,
        `${file.filename} grants the app role something outside public: ${line.trim()}`,
      );
    }
  }
});

test('the decision log and the observation series are append-only', () => {
  const decisions = read('0006_decisions.sql');
  assert.match(decisions, /create trigger decisions_append_only/);
  assert.match(decisions, /before update or delete on internal\.decisions/);

  const observations = read('0003_observations.sql');
  assert.match(observations, /before update or delete on public\.observation/);
});

test('a decision cannot be written with a feature vector newer than itself', () => {
  // The no-lookahead guarantee, enforced by the database rather than by care.
  assert.match(read('0006_decisions.sql'), /check\s*\(feature_asof <= decided_at\)/);
});

test('a label cannot be written without its population', () => {
  const labels = read('0007_labels.sql');
  const populationLine = labels
    .split('\n')
    .find((line) => line.trimStart().startsWith('population'));
  assert.ok(populationLine, 'internal.labels has no population column');
  assert.match(populationLine, /not null/);
  assert.equal(
    /default/.test(populationLine),
    false,
    'population must have no default: omitting it has to be a failed INSERT, not a habit',
  );
});

test('the training view excludes open windows and post-dated origins', () => {
  const labels = read('0007_labels.sql');
  assert.match(labels, /l\.status = 'resolved'/);
  assert.match(labels, /l\.resolves_at < now\(\)/);
  // The anti-circularity clause that voided the last backtest by its absence.
  assert.match(labels, /l\.origin_ts >= d\.decided_at/);
});

test('a vendor-supplied mint time can never claim to be exact', () => {
  assert.match(read('0005_assets.sql'), /exact_requires_real_source/);
});

test('a stage run records an outcome distinct from an error', () => {
  assert.match(read('0008_runs.sql'), /outcome in \('ok', 'empty', 'error'\)/);
});

/**
 * The closed lists in the schema and the closed lists in the vocabulary are the
 * same lists, and this is the check that keeps saying so.
 *
 * A CHECK constraint that has drifted from its union is the worst kind of
 * disagreement: it typechecks perfectly and fails at 3am on the first row of the
 * kind nobody wrote a test for. contracts/ is the authority in both directions —
 * where these disagreed, the migration was the thing that was wrong.
 */
const checkedValues = (sql: string, column: string): readonly string[] => {
  const constraint = new RegExp(`${column} in\\s*\\(([^)]*)\\)`).exec(stripComments(sql));
  assert.ok(constraint, `no 'check (${column} in (…))' constraint found`);
  const list = constraint[1];
  assert.ok(list, `the '${column}' constraint has no value list`);
  return [...list.matchAll(/'([^']+)'/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
};

test('the schema and the vocabulary agree on every closed list', () => {
  assert.deepEqual([...checkedValues(read('0004_stories.sql'), 'state')].sort(), [...STORY_STATES].sort());
  assert.deepEqual([...checkedValues(read('0003_observations.sql'), 'censored')].sort(), [
    ...CENSOR_REASONS,
  ].sort());
  assert.deepEqual([...checkedValues(read('0005_assets.sql'), 'minted_at_source')].sort(), [
    ...MINT_TIME_SOURCES,
  ].sort());
});
