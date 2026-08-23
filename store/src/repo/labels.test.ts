/**
 * `record()` is the append-only write path, and this file is about the two properties
 * that make it one.
 *
 * The failure it guards against is not a crash. It is a labeller that runs a second time
 * and quietly replaces a settled row — which looks like nothing at all, because the row
 * is still there and still plausible, and the fact that we once could not measure this
 * window is gone. A rising censoring rate is the earliest sign the pipeline is rotting,
 * and it can only be read off rows that were not overwritten.
 *
 * Like the rest of this package, these run against a fake `Db` that records the statement
 * rather than a live Postgres. The clause is the claim; the behavioural proof that
 * Postgres honours `on conflict do nothing` is not ours to re-establish.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Label } from '@insidor/contracts/ports/store.ts';

import type { Db } from '../client.ts';
import { PgLabelRepo } from './labels.ts';

function recorder(rows: unknown[] = []): { db: Db; sql: () => string; params: () => readonly unknown[] } {
  let lastSql = '';
  let lastParams: readonly unknown[] = [];
  return {
    db: {
      async query<R>(sql: string, params?: readonly unknown[]): Promise<R[]> {
        lastSql = sql;
        lastParams = params ?? [];
        return rows as R[];
      },
    },
    sql: () => lastSql,
    params: () => lastParams,
  };
}

const SETTLED: Label = {
  subjectKind: 'story',
  subjectId: 'story_abc',
  labelName: 'peak_multiple',
  labelVersion: 'v1',
  windowDays: 30,
  originMs: Date.UTC(2026, 0, 1),
  resolvesAtMs: Date.UTC(2026, 0, 31),
  status: 'censored',
  value: 1.4,
  y: null,
  censorReason: 'coverage_gap_declared',
  population: 'every subject with a recorded origin',
  source: 'services/label:peak_multiple@v1',
  firstSignalMs: null,
  computedAtMs: Date.UTC(2026, 1, 1),
};

test('record() inserts and never updates', () => {
  const r = recorder([{ written: 1 }]);
  return new PgLabelRepo(r.db).record(SETTLED).then((written) => {
    assert.equal(written, true);
    assert.match(r.sql(), /insert into internal\.labels/);
    assert.match(r.sql(), /on conflict[\s\S]*do nothing/);
    /* ★ The absence is the assertion. A `do update set` here would make a second run
       overwrite a settled fact, and every censored row would disappear behind the
       resolved one that replaced it. */
    assert.doesNotMatch(r.sql(), /do update/);
  });
});

test('a row somebody else wrote first is reported, not overwritten', () => {
  const r = recorder([]);
  return new PgLabelRepo(r.db).record(SETTLED).then((written) => {
    assert.equal(written, false);
  });
});

test('record() refuses a pending row: the two writes have opposite invariants', () => {
  const r = recorder();
  return assert.rejects(
    () => new PgLabelRepo(r.db).record({ ...SETTLED, status: 'pending', value: null, censorReason: null }),
    TypeError,
  );
});

test('open() still refuses anything but pending, so neither method can do the other one job', () => {
  const r = recorder();
  return assert.rejects(() => new PgLabelRepo(r.db).open(SETTLED), TypeError);
});

test('bySubjectKeys filters by neither status nor version — the superseded rows are the point', () => {
  const r = recorder([]);
  return new PgLabelRepo(r.db).bySubjectKeys('story', ['story_abc'], 'peak_multiple').then(() => {
    /* Both columns are SELECTed — the caller needs them. What must not appear is either
       one as a PREDICATE: a status filter would hide the censored rows a later run has to
       supersede, and a version filter would hide the revision it has to count from. */
    assert.doesNotMatch(r.sql(), /status\s*=/);
    assert.doesNotMatch(r.sql(), /label_version\s*=/);
    assert.deepEqual(r.params(), ['story', ['story_abc'], 'peak_multiple']);
  });
});

test('bySubjectKeys asks for nothing when there is nothing to ask about', () => {
  const r = recorder([]);
  return new PgLabelRepo(r.db).bySubjectKeys('item', [], 'peak_multiple').then((rows) => {
    assert.deepEqual(rows, []);
    assert.equal(r.sql(), '');
  });
});
