/**
 * The coverage claim is monotone, and this file exists to keep it that way.
 *
 * `recordCoverage` is the single write path for BOTH kinds of claim a coverage
 * row can make — "we watched this window" and "we could not see this window" —
 * so the two collide on one primary key, `(chain, window_from)`. That collision
 * is not a corner: a live run against the real relay produced it on the first
 * cycle after a restart, because the "stream was not connected" gap and the "no
 * successful read for Nms" gap both begin at the resume watermark.
 *
 * These tests are about the ON CONFLICT clause and nothing else, so they run
 * against a fake `Db` that records the statement rather than a live Postgres —
 * the same posture as the rest of this package, which never asks a test runner
 * for a database. The behavioural proof that the clause does what the words say
 * was taken separately, against the real schema, both orderings.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { chainId } from '@insidor/contracts';

import type { Db } from '../client.ts';
import { PgAssetRepo } from './assets.ts';

/** Captures the statement rather than running it. */
function recorder(): { db: Db; sql: () => string } {
  let last = '';
  return {
    db: {
      query: async <R>(sql: string): Promise<R[]> => {
        last = sql;
        return [];
      },
    },
    sql: () => last,
  };
}

async function coverageSql(): Promise<string> {
  const { db, sql } = recorder();
  const repo = new PgAssetRepo(db);
  await repo.recordCoverage(chainId('solana'), 0 as Millis, 1000 as Millis, null, {
    reason: 'stream_disconnect: socket error',
  });
  return sql().replace(/\s+/g, ' ');
}

/*
 * The regression itself. `gap` was absent from the SET list, and absent is not
 * neutral: the existing row kept the claim while the incoming row still won
 * `window_to`, so a gap landing on an observed window left `gap = false` and
 * stretched that false row across the dark interval. A row that asserts we
 * watched exactly the seconds we missed is worse than a dropped write, because
 * nothing downstream can discover it is wrong.
 */
test('a window ever declared dark stays dark, whichever write lands second', async () => {
  const sql = await coverageSql();
  assert.match(
    sql,
    /gap\s*=\s*internal\.mint_coverage\.gap\s+or\s+excluded\.gap/,
    'the gap claim must be OR-ed, never assigned: assigning lets a later observation ' +
      'promote a window we know was dark back to watched',
  );
});

test('the reason survives, so a censored label can say why it was censored', async () => {
  const sql = await coverageSql();
  assert.match(sql, /gap_reason\s*=\s*coalesce\(excluded\.gap_reason,/);
});

/*
 * A gap write carries no position, and it used to null out the position on any
 * row it merged into — losing the resume diagnostic from a row that had one.
 */
test('a write with no position to offer does not erase the one already there', async () => {
  const sql = await coverageSql();
  assert.match(sql, /cursor_ref\s*=\s*coalesce\(excluded\.cursor_ref,/);
});

/*
 * Widening is the only safe direction for the interval too. Shrinking `window_to`
 * would silently un-declare time a previous write had already claimed.
 */
test('the window only ever widens', async () => {
  const sql = await coverageSql();
  assert.match(sql, /window_to\s*=\s*greatest\(internal\.mint_coverage\.window_to,/);
});
