/**
 * ★ WHICH COINS THIS PASS IS ALLOWED TO ASK A VENDOR ABOUT.
 *
 * Every other provenance rule in this repository stops an invented row reaching a SCREEN.
 * This one stops it reaching the OUTSIDE WORLD: whatever `assetsToRead` returns is chunked
 * and sent to a real market vendor as a list of addresses to price. A row the database
 * records as written by a seed is not a coin, and asking a venue what it is worth is a
 * category error before it is a waste of a rate-limited budget.
 *
 * The rule was added after a measurement, not before one. On the store this was written
 * against, `public.market_reading` held thirteen rows against `origin = 'fixture'` assets —
 * one of them PRICED, because the seed had used a real mainnet address for its CHILLGUY
 * fixture and the vendor duly answered with a $12.1M market cap. Real data wearing a
 * fiction's provenance, arriving from the direction nobody was watching.
 *
 * Against a fake `Db` that records the statement, which is this repository's posture for a
 * query whose whole content is its WHERE clause.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OBSERVED_ASSET_ORIGINS } from '@insidor/contracts/asset.ts';
import type { Db } from '@insidor/store';

import { assetsToRead } from './db.ts';

/** Captures the statement and its parameters rather than running them. */
function recorder(): { db: Db; last: () => { sql: string; params: readonly unknown[] } } {
  let sql = '';
  let params: readonly unknown[] = [];
  return {
    db: {
      query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
        sql = s;
        params = p ?? [];
        return [];
      },
    } as Db,
    last: () => ({ sql: sql.replace(/\s+/g, ' ').trim(), params }),
  };
}

const boundOrigins = (params: readonly unknown[]): readonly string[] =>
  (params.find((p) => Array.isArray(p)) as string[] | undefined) ?? [];

test('★ the market pass never asks a vendor about a row the seed wrote', async () => {
  const { db, last } = recorder();
  await assetsToRead(db, 'solana', 300);
  const { sql, params } = last();

  assert.match(sql, /and origin = any\(\$\d+::text\[\]\)/);

  /* The vocabulary's list exactly, and bound rather than interpolated. Exactness is the
     assertion: a containment check would pass a statement that had quietly acquired
     'fixture' alongside the three real ones. */
  assert.deepEqual([...boundOrigins(params)].sort(), [...OBSERVED_ASSET_ORIGINS].sort());
  assert.equal(
    boundOrigins(params).includes('fixture'),
    false,
    '★ a seeded address would be sent to a real market vendor',
  );
});

test('★ the filter is applied BEFORE the cap, not after it', async () => {
  /* THE MECHANISM, AND IT IS THE LAUNCHES RAIL'S MECHANISM EXACTLY. The seed stamps
     `first_seen_at` at load time, so its fixtures are always the NEWEST rows in the table —
     and this statement orders `first_seen_at desc`. Measured on this store: the thirteen
     fixtures occupied ranks 1 through 56 of 248, so they were not merely inside the cap,
     they were the first thing it bought, and `MAX_ADDRESSES_PER_CALL` chunks in order.

     A `limit` applied ahead of the origin predicate would therefore spend the whole budget
     on fictions and return a SHORT list of real coins rather than a full one — the bug
     wearing the appearance of a fix. This asserts the textual order the planner is given:
     the predicate is in the WHERE clause of the same statement the limit closes. */
  const { db, last } = recorder();
  await assetsToRead(db, 'solana', 300);
  const { sql } = last();

  const wherePos = sql.indexOf('origin = any');
  const limitPos = sql.indexOf('limit');
  assert.ok(wherePos > 0 && limitPos > 0, 'the statement lost its filter or its bound');
  assert.ok(wherePos < limitPos, '★ the cap is taken before the fictions are removed');
  /* And the ordering that makes the fixtures first is still the ordering, because the fix
     is the predicate and never a re-sort — a pass that read old coins first to dodge the
     seed would have abandoned the reason the ordering was chosen. */
  assert.match(sql, /order by first_seen_at desc, asset_key asc/);
});

test('the chain and the cap are still bound parameters', async () => {
  /* Unchanged behaviour, kept under test because a third parameter was added to this call
     and renumbering placeholders is how an off-by-one lands in a column somebody else's
     row depends on. */
  const { db, last } = recorder();
  await assetsToRead(db, 'solana', 300);
  const { params } = last();

  assert.equal(params[0], 'solana');
  assert.equal(params[1], 300);
});
