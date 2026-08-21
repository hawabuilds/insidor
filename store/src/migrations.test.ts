/**
 * Properties of the migration set itself, asserted as text.
 *
 * These are greps, and greps stop accidents rather than adversaries — which is the
 * right threat model for two people. Each one corresponds to a guarantee stated
 * somewhere in prose, and prose is what the previous build had instead of checks.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSET_ORIGINS,
  CENSOR_REASONS,
  MARKET_ABSENCE_REASONS,
  MARKET_CAP_BASES,
  MINT_TIME_SOURCES,
} from '@insidor/contracts';
import { STORY_ORIGINS, STORY_STATES } from '@insidor/contracts/story.ts';

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

test('the decision log and the two reading series are append-only', () => {
  const decisions = read('0006_decisions.sql');
  assert.match(decisions, /create trigger decisions_append_only/);
  assert.match(decisions, /before update or delete on internal\.decisions/);

  const observations = read('0003_observations.sql');
  assert.match(observations, /before update or delete on public\.observation/);

  // A market reading is a reading, so a correction is a new row here too. Without
  // this the price five minutes ago — the only evidence of what a coin did in the
  // hour that matters — would be overwritten by the price now.
  const market = read('0010_market.sql');
  assert.match(market, /before update or delete on public\.market_reading/);
});

test('a market number cannot be null without a reason, for any of the four', () => {
  /* The whole content of the reason columns: "the venue said there is none" and
     "nobody filled this in" look identical in a query result, and only one of them
     is a fact about the world. The xor is what makes the second one unwritable. */
  const market = read('0010_market.sql');
  for (const quantity of ['price', 'market_cap', 'liquidity', 'price_change_24h']) {
    assert.match(
      market,
      new RegExp(`constraint ${quantity}_xor_reason check\\s*\\n?\\s*\\(\\(${quantity}[a-z_0-9]* is null\\) = \\(${quantity}_absent is not null\\)\\)`),
      `${quantity} may be null with no reason`,
    );
  }
});

test('a market reading cannot claim a coin is tradable without naming who quoted it', () => {
  /* Tradability is decided by asking a venue for a quote, never by comparing
     liquidity to a number — the one market rule that costs a user money when it is
     got wrong, because it is what puts a Buy button in front of an order. A data
     vendor is not a venue that fills, so a reading written from one cannot say true. */
  assert.match(read('0010_market.sql'), /constraint tradable_requires_a_quoting_venue/);
});

test('the market reading table is not readable by the app role', () => {
  /* Stated as its own test rather than left to the general grant check above,
     because the failure mode is specific: public.asset IS granted to the app, so the
     tempting shape — price columns on the asset row — would hand the browser's own
     connection a number that skipped the projection, the censor and the staleness
     rule. The absence of a grant line here is the whole defence. */
  const market = read('0010_market.sql');
  for (const line of stripComments(market).split('\n')) {
    assert.equal(
      line.trimStart().startsWith('grant'),
      false,
      `0010_market.sql grants something: ${line.trim()}`,
    );
  }
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

/* ── provenance ───────────────────────────────────────────────────────── */

test('★ an asset cannot be written without saying where it came from', () => {
  /* The single most important line in 0013, asserted rather than trusted. A
     `default 'live_stream'` would mean every existing writer keeps compiling, the seed
     keeps inserting, and the new column silently certifies fictions as observations —
     the bug reintroduced by the mechanism meant to fix it. With no default, the next
     seed run fails loudly until someone types 'fixture'.

     Same shape as the `population` test above, and for the same reason: omitting the
     value has to be a failed INSERT, not a habit. */
  const sql = stripComments(read('0013_asset_origin.sql'));

  const notNull = /alter\s+column\s+origin\s+set\s+not\s+null/;
  assert.match(sql, notNull, 'origin must end up not null');

  /* Aimed at the DDL that could grant one, and at nothing else. A looser grep for
     "origin … default" matches the column COMMENT, which says in words that there is no
     default — a check that fails on the sentence documenting the rule is a check somebody
     deletes. Both spellings are covered: the clause on ADD COLUMN, and a later
     ALTER COLUMN … SET DEFAULT. */
  assert.equal(
    /(add|alter)\s+column\s+origin\b[^;]*\bdefault\b/.test(sql),
    false,
    'origin must have no default: a writer that has not decided has to fail, not inherit',
  );
});

test('★ a story cannot be written without saying where it came from either', () => {
  /* 0016, held to 0013's discipline by the same two assertions, because the failure it
     prevents is the more dangerous of the two. An asset with a default certifies a fiction
     as an observation on a rail; a STORY with `default 'observed'` would certify one as an
     observation in the rule that decides which coins a row may name — and the value that
     asks no questions would be the one that makes an invented coin reachable from a real
     moment. With no default, a writer that has not decided fails its INSERT. */
  const sql = stripComments(read('0016_story_origin.sql'));

  assert.match(sql, /alter\s+column\s+origin\s+set\s+not\s+null/, 'origin must end up not null');
  assert.equal(
    /(add|alter)\s+column\s+origin\b[^;]*\bdefault\b/.test(sql),
    false,
    'origin must have no default: a writer that has not decided has to fail, not inherit',
  );

  /* The backfill names the seeded stories one id at a time, from the seed's own list, and
     what it does not reach is called 'observed' — which is the NARROW value here, the one
     that lets a row see the least. That direction is the whole argument; a "simplification"
     to `set origin = 'fixture'` would hand every unplaceable story the permissive list. */
  const flat = sql.replace(/\s+/g, ' ');
  assert.match(flat, /set origin = 'fixture' where story_id in \(/);
  assert.match(flat, /set origin = 'observed' where origin is null/);
});

test('★ the backfill labels rows by evidence, and never by a convenient default', () => {
  /* 0013's three claims, each asserted by the predicate that carries it. The failure
     being guarded against is somebody later "simplifying" the backfill into a single
     `set origin = 'live_stream'`, which would relabel thirteen fictions as observations
     in one statement and leave nothing behind saying it had happened. */
  const sql = stripComments(read('0013_asset_origin.sql')).replace(/\s+/g, ' ');

  assert.match(
    sql,
    /set origin = 'fixture' where asset_key in \(/,
    "the fixtures are named, one key at a time, from the seed's own list",
  );
  assert.match(
    sql,
    /set origin = 'live_stream' where origin is null and venue_id =/,
    'the observed rows are claimed by a predicate, not by being whatever was left',
  );
  assert.match(
    sql,
    /set origin = 'unrecorded' where origin is null/,
    'what no evidence reaches is said to be unreached, never folded into an observation',
  );
});

test("★ 'unrecorded' is written by the backfill and by nothing else in the repository", () => {
  /* THE GUARD THAT KEEPS A FIFTH VALUE FROM BECOMING AN ESCAPE HATCH.
     The standing objection to any "we do not know" member of a closed list is that it
     stops the column being answerable: a writer under time pressure types the value that
     asks no questions. Three things prevent that here — the column has no default, every
     surface asserting observation is an allowlist so the value costs a row its
     visibility, and this test, which says out loud that the string appears in exactly one
     migration and in the vocabulary that defines it.

     A grep, and honest about being one. It stops an accident, which is the right threat
     model; an adversary with commit access has better options. */
  const roots = ['adapters', 'app', 'contracts', 'core', 'services', 'store', 'tools'];
  const exts = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.sql']);
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

  /* The three files allowed to name it: the migration that writes it, the vocabulary that
     declares it, and this test, which has to be able to spell the string in order to
     forbid it. Named individually rather than by directory, so a second file in any of
     those directories is still caught. */
  const allowed = new Set([
    join(repo, 'store', 'migrations', '0013_asset_origin.sql'),
    join(repo, 'contracts', 'src', 'asset.ts'),
    join(repo, 'store', 'src', 'migrations.test.ts'),
  ]);

  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!exts.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue;
      if (allowed.has(full)) continue;
      if (readFileSync(full, 'utf8').includes("'unrecorded'")) offenders.push(full);
    }
  };
  for (const root of roots) walk(join(repo, root));

  assert.deepEqual(
    offenders,
    [],
    "'unrecorded' is a fact about rows that predate the origin column. Nothing new may claim it.",
  );
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
  assert.deepEqual([...checkedValues(read('0010_market.sql'), 'market_cap_basis')].sort(), [
    ...MARKET_CAP_BASES,
  ].sort());
  assert.deepEqual([...checkedValues(read('0013_asset_origin.sql'), 'origin')].sort(), [
    ...ASSET_ORIGINS,
  ].sort());
  /* The story's own origin, which is a SHORTER list than the asset's and must stay one: the
     five asset origins name kinds of transport, and nothing pushes a story at us. A drift
     that quietly widened this to ASSET_ORIGINS would give `coinOriginsVisibleTo` values its
     fall-through has never been reasoned about. */
  assert.deepEqual([...checkedValues(read('0016_story_origin.sql'), 'origin')].sort(), [
    ...STORY_ORIGINS,
  ].sort());
  /* All four reason columns, not just the first: they are four separate CHECKs and
     four separate opportunities for one of them to be edited alone. */
  for (const column of [
    'price_absent',
    'market_cap_absent',
    'liquidity_absent',
    'price_change_24h_absent',
  ]) {
    assert.deepEqual(
      [...checkedValues(read('0010_market.sql'), column)].sort(),
      [...MARKET_ABSENCE_REASONS].sort(),
      `${column} has drifted from MARKET_ABSENCE_REASONS`,
    );
  }
});
