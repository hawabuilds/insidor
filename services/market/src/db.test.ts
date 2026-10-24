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

import { assetsToRead, firstHourOnly } from './db.ts';

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

test('★ the coins on screen are read before the newest, under the same origin rule', async () => {
  /* A coin on a For You card is usually hours older than the newest-first bound reaches, so
     without this it was read once when new and never again: a stale absence and no Buy on
     every card. Every coinId a projected feed or board names comes first. */
  const { db, last } = recorder();
  await assetsToRead(db, 'solana', 300);
  const { sql } = last();
  assert.match(sql, /from public\.rising_row/);
  assert.match(sql, /from public\.board_row/);
  /* Every live narrative's page too: the Narratives card's coin and top coin are only there. */
  assert.match(sql, /from public\.story_view where dead is not true and payload #>> '\{provenance,kind\}' = 'observed'/);
  assert.match(sql, /and a\.origin = any\(\$3::text\[\]\)/);
  assert.match(sql, /order by tier, first_seen_at desc, asset_key asc limit \$2$/);
});

test('a pictured coin past its first hour is read after the coins on screen, before the newest, inside the bound', async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
      statements.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p ?? [] });
      if (s.includes('internal.image_embedding')) return [{ chain: 'solana', address: 'hour1', tier: 2 }, { chain: 'solana', address: 'new1', tier: 2 }] as R[];
      return [{ chain: 'solana', address: 'screen1', tier: 0 }, { chain: 'solana', address: 'new1', tier: 1 }, { chain: 'solana', address: 'new2', tier: 1 }] as R[];
    },
  } as Db;
  const rows = await assetsToRead(db, 'solana', 3, { nowMs: Date.UTC(2026, 9, 18), afterLaunchMs: 3_600_000, withinMs: 21_600_000, limit: 100 });
  assert.deepEqual(rows.map((r) => r.address), ['screen1', 'hour1', 'new1']);
  const hour = statements.find((s) => s.sql.includes('internal.image_embedding'));
  assert.ok(hour !== undefined);
  assert.match(hour.sql, /and a\.origin = any\(\$\d+::text\[\]\)/);
  assert.equal(hour.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('fixture')), false, '★ a seeded address would be sent to a real market vendor');
});

test('★ the older coins a one-coin pick is weighing are read after the coins on screen, before the hour and the newest', async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
      statements.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p ?? [] });
      if (s.includes('internal.one_coin_candidate')) return [{ chain: 'solana', address: 'older1', tier: 3 }, { chain: 'solana', address: 'screen1', tier: 3 }] as R[];
      if (s.includes('internal.image_embedding')) return [{ chain: 'solana', address: 'hour1', tier: 2 }] as R[];
      return [{ chain: 'solana', address: 'screen1', tier: 0 }, { chain: 'solana', address: 'new1', tier: 1 }] as R[];
    },
  } as Db;
  const rows = await assetsToRead(db, 'solana', 4, { nowMs: Date.UTC(2026, 9, 18), afterLaunchMs: 3_600_000, withinMs: 21_600_000, limit: 100 }, { nowMs: Date.UTC(2026, 9, 18), withinMs: 3_600_000, limit: 50 });
  assert.deepEqual(rows.map((r) => r.address), ['screen1', 'older1', 'hour1', 'new1']);
  const older = statements.find((s) => s.sql.includes('internal.one_coin_candidate'));
  assert.ok(older !== undefined);
  assert.match(older.sql, /where path = 'existing'/);
  assert.match(older.sql, /a\.origin = any\(\$\d+::text\[\]\)/);
  assert.equal(older.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('fixture')), false, '★ a seeded address would be sent to a real market vendor');
});

test('★ the coins tied to saved posts are read every pass, right after the coins on screen, through 0129\'s function and the origin allowlist', async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
      statements.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p ?? [] });
      if (s.includes('internal.saved_post_coins')) return [{ chain: 'solana', address: 'saved1', tier: 4 }, { chain: 'solana', address: 'screen1', tier: 4 }] as R[];
      if (s.includes('internal.one_coin_candidate')) return [{ chain: 'solana', address: 'older1', tier: 3 }] as R[];
      return [{ chain: 'solana', address: 'screen1', tier: 0 }, { chain: 'solana', address: 'new1', tier: 1 }] as R[];
    },
  } as Db;
  const rows = await assetsToRead(db, 'solana', 3, null, { nowMs: Date.UTC(2026, 9, 24), withinMs: 3_600_000, limit: 50 }, { nowMs: Date.UTC(2026, 9, 24), withinMs: 10_800_000, limit: 60 });
  assert.deepEqual(rows.map((r) => r.address), ['screen1', 'saved1', 'older1'], 'within the bound, a saved post\'s coin before the pick\'s older coins and the newest');
  const saved = statements.find((s) => s.sql.includes('internal.saved_post_coins'));
  assert.ok(saved !== undefined);
  assert.match(saved.sql, /a\.origin = any\(\$\d+::text\[\]\)/);
  assert.equal(saved.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('fixture')), false, '★ a seeded address would be sent to a real market vendor');
});

test('a database without 0129: the saved posts\' list is empty and the pass reads its usual coins', async () => {
  const db = {
    query: async <R>(s: string): Promise<R[]> => {
      if (s.includes('internal.saved_post_coins')) throw Object.assign(new Error('function does not exist'), { code: '42883' });
      return [{ chain: 'solana', address: 'new1', tier: 1 }] as R[];
    },
  } as Db;
  assert.deepEqual((await assetsToRead(db, 'solana', 3, null, null, { nowMs: 0, withinMs: 1, limit: 1 })).map((r) => r.address), ['new1']);
});

test('★ the coins picked for posts and the stated-name coins are read every pass, after the screen and the saved posts\' coins, longest unread first', async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
      statements.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p ?? [] });
      if (s.includes('internal.saved_post_coins')) return [{ chain: 'solana', address: 'saved1', tier: 4 }] as R[];
      if (s.includes('internal.post_coin_pick')) return [{ chain: 'solana', address: 'bitches', tier: 5 }] as R[];
      if (s.includes('internal.one_coin_candidate')) return [{ chain: 'solana', address: 'older1', tier: 3 }] as R[];
      return [{ chain: 'solana', address: 'screen1', tier: 0 }, { chain: 'solana', address: 'new1', tier: 1 }] as R[];
    },
  } as Db;
  const now = Date.UTC(2026, 9, 23, 20, 30);
  const rows = await assetsToRead(db, 'solana', 5, null, { nowMs: now, withinMs: 3_600_000, limit: 50 }, { nowMs: now, withinMs: 10_800_000, limit: 60 }, { nowMs: now, withinMs: 172_800_000, limit: 60 });
  assert.deepEqual(rows.map((r) => r.address), ['screen1', 'saved1', 'bitches', 'older1', 'new1']);
  const picked = statements.find((s) => s.sql.includes('internal.post_coin_pick'));
  assert.ok(picked !== undefined);
  assert.match(picked.sql, /internal\.narrative_coin_pick/);
  assert.match(picked.sql, /evidence->'ties' \? 'name_stated'/);
  assert.match(picked.sql, /order by r\.taken_at asc nulls first/);
  assert.equal(picked.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('fixture')), false, '★ a seeded address would be sent to a real market vendor');
});

test('without the hour, the pass reads exactly what it read before', async () => {
  let calls = 0;
  const db = { query: async <R>(): Promise<R[]> => { calls++; return [] as R[]; } } as Db;
  await assetsToRead(db, 'solana', 300);
  assert.equal(calls, 1);
});

test('★ a tied candidate in its first hour is read every pass, right after the coins on screen, For You posts first (policy.v163)', async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async <R>(s: string, p?: readonly unknown[]): Promise<R[]> => {
      statements.push({ sql: s.replace(/\s+/g, ' ').trim(), params: p ?? [] });
      if (s.includes("?| array['link','name_stated','picture']")) return [{ chain: 'solana', address: 'baldcat', tier: 6 }, { chain: 'solana', address: 'screen1', tier: 6 }] as R[];
      if (s.includes('internal.saved_post_coins')) return [{ chain: 'solana', address: 'saved1', tier: 4 }] as R[];
      return [{ chain: 'solana', address: 'screen1', tier: 0 }, { chain: 'solana', address: 'new1', tier: 1 }] as R[];
    },
  } as Db;
  const now = Date.UTC(2026, 9, 24, 0, 52);
  const rows = await assetsToRead(db, 'solana', 3, null, null, { nowMs: now, withinMs: 10_800_000, limit: 60 }, null, { nowMs: now, withinMs: 3_600_000, limit: 80 });
  assert.deepEqual(rows.map((r) => r.address), ['screen1', 'baldcat', 'saved1'], 'on a full pass the newest end gives way, never the first hour');
  const young = statements.find((s) => s.sql.includes("?| array['link','name_stated','picture']"));
  assert.ok(young !== undefined);
  assert.match(young.sql, /order by c\.shown desc, c\.made desc, c\.launched desc/);
  assert.match(young.sql, /feed_id = 'fyp'/);
  assert.match(young.sql, /a\.origin = any\(\$\d+::text\[\]\)/);
  assert.deepEqual(young.params.slice(2, 4), [3_600_000, 80], "the hour and the bound are the policy's");
  assert.equal(young.params.some((p) => Array.isArray(p) && (p as unknown[]).includes('fixture')), false, '★ a seeded address would be sent to a real market vendor');
});

test('the light pass reads the first-hour coins alone, and a failed read there is no coins, not a failed pass', async () => {
  const ok = { query: async <R>(): Promise<R[]> => [{ chain: 'solana', address: 'baldcat', tier: 6 }] as R[] } as Db;
  assert.deepEqual(await firstHourOnly(ok, 'solana', { nowMs: 0, withinMs: 1, limit: 1 }), [{ chain: 'solana', address: 'baldcat' }]);
  const down = { query: async <R>(): Promise<R[]> => { throw new Error('relation does not exist'); } } as Db;
  assert.deepEqual(await firstHourOnly(down, 'solana', { nowMs: 0, withinMs: 1, limit: 1 }), []);
});
