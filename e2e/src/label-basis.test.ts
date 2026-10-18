/**
 * The label job's copy of archived decision-log days (0103, store label-basis.ts) on the real
 * schema: the three label reads (services/label db.ts) give exactly the answers the full log gave
 * after old days are copied into internal.decision_label_basis and their partitions dropped, by
 * both routes that write it — the archive tool's partition read and the backfill's NDJSON lines.
 * Also: a day copied but not yet dropped is read once, a half-written day is not read at all, and
 * writing a day twice changes nothing. PGlite, real migrations.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { attributions, dueSubjects, examinedStories } from '@insidor/label/src/db.ts';
import type { Db } from '@insidor/store';
import { LABEL_BASIS_COLUMNS, LabelBasisDay, writeLabelBasisDay } from '@insidor/store/repo/label-basis.ts';
import type { LabelBasisSource } from '@insidor/store/repo/label-basis.ts';

import { migratedDb } from './db.ts';

const KINDS = ['item', 'story', 'candidate'] as const;
const DAYS = ['2026-10-12', '2026-10-13', '2026-10-14'] as const;
const part = (day: string): string => `decisions_${day.replaceAll('-', '')}`;

type Row = [day: string, hour: number, stage: string, kind: string, id: string, verdict: string, origin: string | null];

/* Subjects that span days, origins that move (the earliest must win, to the microsecond), a
   subject with no origin on one day and one on another, pair rows (never graded), resolve rows of
   every verdict on both kinds, and a candidate id that does not split. */
const ROWS: Row[] = [
  ['2026-10-12', 1, 'admit', 'item', 'x:1', 'pass', '2026-10-11T23:00:00.123456Z'],
  ['2026-10-12', 2, 'detect', 'item', 'x:1', 'abstain', '2026-10-11T22:59:59.999999Z'],
  ['2026-10-13', 3, 'track', 'item', 'x:1', 'hold', '2026-10-11T23:30:00Z'],
  ['2026-10-12', 4, 'admit', 'item', 'x:2', 'drop', null],
  ['2026-10-14', 5, 'admit', 'item', 'x:2', 'pass', '2026-10-14T01:00:00.000001Z'],
  ['2026-10-12', 6, 'group', 'pair', 'x:1|x:2', 'pass', '2026-10-11T00:00:00Z'],
  ['2026-10-12', 7, 'qualify', 'story', 'story_a', 'abstain', '2026-10-12T05:00:00Z'],
  ['2026-10-13', 8, 'resolve', 'story', 'story_a', 'drop', '2026-10-12T04:00:00Z'],
  ['2026-10-13', 9, 'resolve', 'candidate', 'story_a|solana:Coin1', 'pass', '2026-10-13T00:00:00Z'],
  ['2026-10-14', 10, 'resolve', 'candidate', 'story_a|solana:Coin1', 'abstain', '2026-10-13T00:00:00Z'],
  ['2026-10-13', 11, 'resolve', 'candidate', 'story_b|solana:Coin2', 'drop', '2026-10-13T02:00:00Z'],
  ['2026-10-12', 12, 'resolve', 'candidate', 'story_c|solana:Coin3', 'abstain', '2026-10-12T02:00:00Z'],
  ['2026-10-14', 13, 'resolve', 'candidate', 'story_c|solana:Coin3', 'pass', '2026-10-12T02:00:00Z'],
  ['2026-10-14', 14, 'resolve', 'story', 'story_d', 'drop', '2026-10-14T00:00:00Z'],
  ['2026-10-12', 15, 'resolve', 'candidate', 'unsplittable', 'pass', '2026-10-12T00:00:00Z'],
  ['2026-10-14', 16, 'detect', 'item', 'x:3', 'drop', '2026-10-14T03:00:00Z'],
  ['2026-10-13', 17, 'qualify', 'story', 'story_b', 'drop', null],
];

async function seeded(): Promise<Db> {
  const db = await migratedDb();
  for (const day of DAYS) await db.query(`select internal.ensure_decision_partition($1::date)`, [day]);
  for (const [day, hour, stage, kind, id, verdict, origin] of ROWS) {
    const at = `${day}T${String(hour).padStart(2, '0')}:00:00Z`;
    await db.query(
      `insert into internal.decisions (decided_at, stage, subject_kind, subject_id, feature_asof, subject_origin, verdict, reason, features, feature_set, feature_hash, policy_hash, decider, propensity)
       values ($1, $2, $3, $4, $1, $5, $6, 'test', '{}', 'test.v1', 'h', 'p', 'rule:test@1', 1)`,
      [at, stage, kind, id, origin, verdict],
    );
  }
  return db;
}

interface Answers {
  due: unknown;
  attributions: unknown;
  examined: unknown;
}

async function answers(db: Db): Promise<Answers> {
  /* A clock far past every window and no labels: the queue filters nothing, so this is the whole log. */
  const due = await dueSubjects(db, KINDS, 1000, { labelName: 'peak_multiple', definition: 'v1', windowDays: 30, nowMs: Date.parse('2100-01-01T00:00:00Z') });
  const att = [...(await attributions(db))].sort((a, b) => `${a.storyId}${a.assetKey}${a.verdict}`.localeCompare(`${b.storyId}${b.assetKey}${b.verdict}`));
  return { due, attributions: att, examined: [...(await examinedStories(db))].sort() };
}

/* The archive tool's route: the partition read with the columns it selects. */
async function fromPartition(db: Db, day: string): Promise<LabelBasisDay> {
  const basis = new LabelBasisDay(day);
  for (const r of await db.query<LabelBasisSource>(`select ${LABEL_BASIS_COLUMNS} from internal.${part(day)} order by id`)) basis.addRow(r);
  return basis;
}

/* The backfill's route: the partition as the archive writes it, one row_to_json line per decision. */
async function fromNdjson(db: Db, day: string): Promise<LabelBasisDay> {
  const basis = new LabelBasisDay(day);
  for (const r of await db.query<{ j: string }>(`select row_to_json(d)::text as j from internal.${part(day)} d order by id`)) basis.addJson(r.j);
  return basis;
}

const drop = (db: Db, day: string): Promise<unknown> => db.query(`drop table internal.${part(day)}`);

test('the label reads give the full log\'s answers after old days are archived, by either route', async () => {
  for (const route of [fromPartition, fromNdjson]) {
    const db = await seeded();
    const before = await answers(db);
    assert.ok((before.due as unknown[]).length >= 8, 'the seed has subjects');

    for (const day of ['2026-10-12', '2026-10-13']) {
      const basis = await route(db, day);
      await writeLabelBasisDay(db, basis, route === fromPartition ? 'archive' : 'backfill');
      /* Copied and switched on, not yet dropped: read once, from the basis. */
      assert.deepEqual(await answers(db), before, `${route.name}: ${day} copied, partition still there`);
      await drop(db, day);
      assert.deepEqual(await answers(db), before, `${route.name}: ${day} dropped`);
    }

    /* Writing a day again writes the same values. */
    await writeLabelBasisDay(db, await route(db, '2026-10-14'), 'archive');
    const once = await db.query(`select * from internal.decision_label_basis order by day, subject_kind, subject_id`);
    await writeLabelBasisDay(db, await route(db, '2026-10-14'), 'archive');
    assert.deepEqual(await db.query(`select * from internal.decision_label_basis order by day, subject_kind, subject_id`), once);
    await drop(db, '2026-10-14');
    assert.deepEqual(await answers(db), before, `${route.name}: every day archived`);
  }
});

test('the earliest origin is kept to the microsecond, and pair subjects are not kept', async () => {
  const db = await seeded();
  const basis = await fromNdjson(db, '2026-10-12');
  await writeLabelBasisDay(db, basis, 'backfill');
  const [x1] = await db.query<{ o: string }>(`select to_char(origin_min at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as o from internal.decision_label_basis where subject_id = 'x:1'`);
  assert.equal(x1?.o, '2026-10-11 22:59:59.999999');
  const [day] = await db.query<{ log_rows: string; decisions: string; subjects: number }>(`select log_rows::text, decisions::text, subjects from internal.decision_label_basis_day where day = '2026-10-12'`);
  assert.deepEqual({ ...day }, { log_rows: '7', decisions: '6', subjects: 5 });
  const pairs = await db.query(`select 1 from internal.decision_label_basis where subject_kind = 'pair'`);
  assert.equal(pairs.length, 0);
});

test('a half-written day is not read: the partition stays the source until the day row exists', async () => {
  const db = await seeded();
  const before = await answers(db);
  /* Rows written by hand for one subject only, with no day row, as if the writer died midway. */
  await db.query(
    `insert into internal.decision_label_basis (day, subject_kind, subject_id, origin_min, decisions, resolve_verdicts)
     values ('2026-10-12', 'item', 'x:1', '2026-10-01T00:00:00Z', 99, null)`,
  );
  assert.deepEqual(await answers(db), before);
});

test('a day whose basis does not count back is not switched on', async () => {
  const db = await seeded();
  /* A stale extra row for that day: the count check refuses, and no day row is written. */
  await db.query(
    `insert into internal.decision_label_basis (day, subject_kind, subject_id, origin_min, decisions, resolve_verdicts)
     values ('2026-10-12', 'item', 'x:stale', null, 1, null)`,
  );
  await assert.rejects(writeLabelBasisDay(db, await fromPartition(db, '2026-10-12'), 'archive'), /not switched on/);
  assert.equal((await db.query(`select 1 from internal.decision_label_basis_day`)).length, 0);
});
