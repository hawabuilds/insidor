/**
 * Post slimming, archived first: nothing is deleted unless the archive took the batch, and what is
 * deleted is exactly what was archived, by key. Against a fake `Db` that answers each statement by
 * its shape and records every one sent.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Db } from '../client.ts';
import { runSlim, type ArchiveSlim, type InTransaction, type SlimArchive } from './post-slim.ts';

const POLICY = { on: true, afterMs: 0, postsPerBatch: 10, rowsPerStatement: 2, batchesPerRun: 1, lockTimeoutMs: 1_000, statementTimeoutMs: 1_000 };
const READINGS = [
  { k1: 'x:1', k2: 'views', k3: '2026-10-01 00:00:01.123456+00', row: { item_id: 'x:1', kind: 'views', value: 10 } },
  { k1: 'x:1', k2: 'views', k3: '2026-10-01 01:00:00+00', row: { item_id: 'x:1', kind: 'views', value: 20 } },
  { k1: 'x:2', k2: 'likes', k3: '2026-10-01 02:00:00+00', row: { item_id: 'x:2', kind: 'likes', value: 3 } },
];

function fake(deletedReadings: (asked: number) => number = (n) => n): { db: Db; tx: InTransaction; sent: string[]; deleteParams: unknown[][] } {
  const sent: string[] = [];
  const deleteParams: unknown[][] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      sent.push(sql);
      if (sql.includes('to_regclass(name)')) return [] as R[];
      if (sql.includes('from internal.post_slim_cursor')) return [] as R[];
      if (sql.includes('from public.item i') && sql.includes('order by i.first_seen_at')) return [{ item_id: 'x:1', seen: '2026-10-01' }, { item_id: 'x:2', seen: '2026-10-02' }] as R[];
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ ok: true }] as R[];
      if (sql.includes('with b as')) return [] as R[];
      if (sql.includes('to_jsonb(o) as row')) return READINGS as R[];
      if (sql.includes('to_jsonb(x) as row')) return [{ k1: 'x:1', k2: null, k3: null, row: { item_id: 'x:1', lane: 'all' } }] as R[];
      if (sql.includes('to_jsonb(c) as row')) return [] as R[];
      if (sql.includes("jsonb_build_object('item_id'")) return [{ k1: 'x:2', k2: null, k3: null, row: { item_id: 'x:2', media: [{ uri: 'https://p' }] } }] as R[];
      if (sql.includes('delete from public.observation')) {
        deleteParams.push([...(params ?? [])]);
        return [{ n: String(deletedReadings((params?.[0] as unknown[]).length)) }] as R[];
      }
      if (sql.includes('delete from internal.item_found_by')) return [{ n: String((params?.[0] as unknown[]).length) }] as R[];
      if (sql.includes('delete from raw.capture')) return [{ n: '0' }] as R[];
      if (sql.startsWith('select (select count(*)')) return [{ readings: 3, reading_bytes: 0, search_records: 1, raw_captures: 0, item_bytes: 0 }] as R[];
      return [] as R[];
    },
  } as Db;
  return { db, tx: async (fn) => fn(db), sent, deleteParams };
}

test('★ an archive that fails removes nothing', async () => {
  const f = fake();
  const failing: ArchiveSlim = async () => { throw new Error('upload refused'); };
  await assert.rejects(runSlim(f.db, f.tx, POLICY, Date.parse('2026-11-07'), true, { archive: failing }), /upload refused/);
  assert.equal(f.sent.filter((s) => /\bdelete from\b|update public\.item set media/.test(s)).length, 0);
});

test('★ what is deleted is exactly what was archived, by key, and each count is checked', async () => {
  const f = fake();
  let got: SlimArchive | null = null;
  const out = await runSlim(f.db, f.tx, POLICY, Date.parse('2026-11-07'), true, { archive: async (b) => { got = b; } });
  assert.equal(out.kind, 'ran');
  assert.deepEqual((got as SlimArchive | null)?.readings, READINGS.map((r) => r.row));
  assert.equal((got as SlimArchive | null)?.itemFields.length, 1, 'the emptied picture link is archived too');
  assert.deepEqual(f.deleteParams.map((p) => p[2]), [[READINGS[0]!.k3, READINGS[1]!.k3], [READINGS[2]!.k3]], 'by key, rowsPerStatement at a time, microseconds kept');
  const g = fake((n) => n - 1);
  await assert.rejects(runSlim(g.db, g.tx, POLICY, Date.parse('2026-11-07'), true, { archive: async () => undefined }), /removed 1 readings but archived 3/);
});

test('a live run with no archive is refused before it reads a post', async () => {
  const f = fake();
  await assert.rejects(runSlim(f.db, f.tx, POLICY, Date.parse('2026-11-07'), true), /no archive was given/);
  assert.equal(f.sent.length, 0);
});
