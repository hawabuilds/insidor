/**
 * ★ READINGS WRITTEN IN ONE STATEMENT A BATCH (store observations.ts `append`, 2026-11-03): a discovery
 * pass's ~4,000 readings used to be one INSERT each. Real schema (PGlite): a batch writes every reading
 * once with every field, a repeat of the same readings writes none (on conflict do nothing, counted),
 * and a batch past the statement size is split and still counted whole.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { observationsFrom } from '@insidor/core';
import { PgObservationRepo } from '@insidor/store';

import { migratedDb } from './db.ts';

const T0 = Date.UTC(2026, 10, 3, 22);

test('★ a batch of readings is written once, field for field; the same batch again writes nothing', async () => {
  const db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:1', 'x', '1', 'poster')`);
  const ids = Array.from({ length: 300 }, (_, i) => `x:b${i}`);
  for (const id of ids) {
    await db.query(`insert into public.item (item_id, source, source_item_id, author_key, posted_at, first_seen_at, raw_ref, origin) values ($1, 'x', $2, 'x:1', $3, $3, 'r', 'observed')`, [id, id.slice(2), new Date(T0 - 3_600_000)]);
  }
  const readings = ids.flatMap((id, i) =>
    observationsFrom(id as never, {
      reach: { value: 1000 + i, fidelity: { kind: 'quantized', significantDigits: 3 }, observedAt: T0 as Millis },
      approval: { value: 10 + i, fidelity: { kind: 'exact' }, observedAt: T0 as Millis },
    }, {}, T0 as Millis, DEFAULT_POLICY.kinetics),
  );
  assert.ok(readings.length >= 600, 'two readings a post');
  const repo = new PgObservationRepo(db);
  assert.equal(await repo.append(readings), readings.length);
  assert.equal(await repo.append(readings), 0, 'already written');
  const rows = await db.query<{ n: string }>(`select count(*)::text as n from public.observation`);
  assert.equal(Number(rows[0]?.n), readings.length);
  const one = await db.query<{ value: number; fidelity_kind: string; fidelity_digits: number | null }>(`select value, fidelity_kind, fidelity_digits from public.observation where item_id = 'x:b7' and kind = 'reach'`);
  assert.deepEqual(one[0], { value: 1007, fidelity_kind: 'quantized', fidelity_digits: 3 });
});
