/** The subject lookups pass their time bound and kind to the database, and ask unbounded when given none. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgDecisionRepo } from './decisions.ts';

function recording() {
  const seen: { sql: string; params: readonly unknown[] }[] = [];
  const db: Db = {
    query: async (sql, params = []) => {
      seen.push({ sql, params });
      return [];
    },
  };
  return { repo: new PgDecisionRepo(db), seen };
}

test('latestForSubjects bounds the read by time and kind when given them', async () => {
  const { repo, seen } = recording();
  await repo.latestForSubjects('track', ['a', 'b'], 1_000 as Millis, 'item');
  const [call] = seen;
  assert.ok(call);
  assert.match(call.sql, /decided_at >= \$3/);
  assert.match(call.sql, /subject_kind = \$4/);
  assert.deepEqual(call.params.slice(0, 2), ['track', ['a', 'b']]);
  assert.notEqual(call.params[2], null);
  assert.equal(call.params[3], 'item');
});

test('latestForSubjects without a bound asks every partition, as before', async () => {
  const { repo, seen } = recording();
  await repo.latestForSubjects('admit', ['a']);
  assert.equal(seen[0]?.params[2], null);
  assert.equal(seen[0]?.params[3], null);
});

test('no subjects, no query', async () => {
  const { repo, seen } = recording();
  await repo.latestForSubjects('track', [], 1_000 as Millis, 'item');
  await repo.decidedSubjects('admit', [], 1_000 as Millis);
  assert.equal(seen.length, 0);
});
