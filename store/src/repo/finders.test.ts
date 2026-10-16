/**
 * The finders' read of new coins, against a fake connection.
 *
 * Why this file exists: `freshUnread` once took the stream's coins alone. The stream service went
 * down at 2026-10-15 07:14 UTC, every coin after came in by the list poll as 'backfill', and the
 * coin-links step recorded nothing for 18 hours while its loop ran clean. Asserting the statement's
 * text is the only check that runs without Postgres.
 * What breaks if changed carelessly: narrowing the origins again stops the links silently whenever
 * one way of hearing about coins is down.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgFinderRepo } from './finders.ts';

test('★ new coins are read whether the stream or the list poll brought them', async () => {
  const sent: string[] = [];
  const db = { query: async (sql: string) => (sent.push(sql), []) } as unknown as Db;
  await new PgFinderRepo(db).freshUnread(0 as Millis, 40);
  const sql = sent[0] ?? '';
  assert.ok(sql.includes(`a.origin in ('live_stream', 'backfill')`), 'both observed arrivals');
  assert.ok(!sql.includes(`a.origin = 'live_stream'`), 'the stream alone is gone');
});
