/** ★ The runner may deploy before 0056 is applied: no table reads as no applied block; any other error still throws. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { PgLearningRepo } from './learning.ts';

const failing = (error: unknown): Db => ({ query: () => Promise.reject(error) });

test('an unmigrated table is "nothing applied", never a failed boot', async () => {
  assert.equal(await new PgLearningRepo(failing(Object.assign(new Error('relation does not exist'), { code: '42P01' }))).latestApplied(), null);
});

test('any other database error still throws', async () => {
  await assert.rejects(new PgLearningRepo(failing(Object.assign(new Error('connection reset'), { code: '08006' }))).latestApplied());
});
