/**
 * ★ "SEE 3 COINS" LISTS THE THREE. An unsure feed post's count and the list behind it, on the
 * real schema (PGlite): the lookup's kept addresses (0051), the projector's reading of them and
 * the list it writes beside the row, and the read route that serves the list.
 *
 * What this holds: the card's count equals the list's length; a coin we do not hold by name is in
 * neither; a search from before the addresses were kept is neither listed nor given up on; and a
 * post on an unsure narrative lists the narrative's coins, not its own search's.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';
import { loadPostLookups, postCoins } from '@insidor/project/src/rising.ts';
import { writeSameNameCoins } from '@insidor/project/src/same-name.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { handle } from '@insidor/read/src/routes.ts';
import { createSearch } from '@insidor/read/src/search.ts';
import { PgCoinUniverseRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const HOUR = 3_600_000;
const A = 'Aaaa111111111111111111111111111111111pump';
const B = 'Bbbb111111111111111111111111111111111pump';
const C = 'Cccc111111111111111111111111111111111pump';
const UNHELD = 'Gone111111111111111111111111111111111pump';
let db: Db;

const listing: CoinSearch = {
  search: async () => ({
    hits: [
      { address: A, name: 'Jimothy', ticker: 'JIM', venue: 'curve', marketAddress: null, createdAt: NOW - HOUR, marketCapUsd: 4_000, imageUrl: null, source: 'x' },
      { address: B, name: 'Jimothy', ticker: 'JIM', venue: 'pool', marketAddress: 'poolB', createdAt: NOW - 2 * HOUR, marketCapUsd: 90_000, imageUrl: null, source: 'x' },
    ],
    capped: false,
  }),
};

const read = () => {
  const search = createSearch({
    db: { query: (s, p) => db.query(s, p) }, log: SILENT, policy: DEFAULT_POLICY.search, sources: [{ name: 'x', source: listing }],
    curveProgress: null, images: null, market: null, now: () => NOW,
  });
  return { db: { query: (s: string, p: readonly unknown[]) => db.query(s, p) }, log: SILENT, search };
};

async function feedRow(itemId: string, coins: unknown, storyId: string | null): Promise<void> {
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1) on conflict (feed_id) do nothing`);
  await db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', $1, 0, $2::jsonb)`, [
    itemId, JSON.stringify({ id: itemId, storyId, coins }),
  ]);
}

before(async () => {
  db = await migratedDb();
  for (const [address, at] of [[A, NOW - HOUR], [B, NOW - 2 * HOUR], [C, NOW - 3 * HOUR]] as const) {
    await db.query(
      `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
       values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'JIM', 'Jimothy', '{}'::jsonb, $3, 'backfill')`,
      [address, `solana:${address}`, new Date(at)],
    );
  }
  const coins = new PgCoinUniverseRepo(db);
  /* A post searched now: three addresses kept, one of them a coin we do not hold by name. */
  await coins.recordLookup({ kind: 'post', id: 'x:1', term: 'Jimothy', attempts: 0 }, { hits: [A, B, UNHELD], more: true }, 0, NOW);
  /* A post searched before 0051: a count, no list, and a wait long past "Couldn't check". */
  await db.query(`insert into internal.coin_lookup (subject_kind, subject_id, term, looked_at, found, added) values ('post', 'x:2', 'Jimothy', $1, 3, 0)`, [new Date(NOW)]);
  await db.query(`insert into internal.coin_lookup_attempt (subject_kind, subject_id, queued_at) values ('post', 'x:2', $1)`, [new Date(NOW - HOUR)]);
});

test('★ the projector reads the kept addresses we hold by name, and the count is their number', async () => {
  const lookups = await loadPostLookups(db, ['x:1', 'x:2', 'x:3'], NOW);
  assert.deepEqual(lookups.get('x:1'), { coins: [A, B], more: true }, 'newest launch first; a coin we do not hold is not listed');
  const line = postCoins(undefined, lookups.get('x:1') ?? null);
  assert.deepEqual(line.coins, { kind: 'unsure', claimCount: 2, more: true });
  assert.deepEqual(line.sameName, [A, B]);
});

test('★ a search from before the list was kept is not offered as a list, and not given up on', async () => {
  const lookups = await loadPostLookups(db, ['x:2'], NOW);
  assert.equal(lookups.has('x:2'), false, 'a dash until the lookup searches it again, never "Couldn\'t check"');
});

test('★ "See 2 coins" opens the same two, with their market as Search shows it', async () => {
  const line = postCoins(undefined, (await loadPostLookups(db, ['x:1'], NOW)).get('x:1') ?? null);
  await writeSameNameCoins(db, 'post', new Map([['x:1', line.sameName]]));
  await feedRow('x:1', line.coins, null);
  const reply = await handle('GET', '/post/x%3A1/coins', read(), 'c1');
  assert.equal(reply.status, 200);
  const list = JSON.parse(reply.body) as { more: boolean; items: { address: string; venue: string | null; marketCapUsd: { v: number | null }; launchedAt: { at: number | null } }[] };
  assert.equal(list.items.length, line.coins.kind === 'unsure' ? line.coins.claimCount : -1, 'the count on the card is the length of the list');
  assert.deepEqual(list.items.map((c) => c.address).sort(), [A, B].sort());
  assert.equal(list.more, true);
  const b = list.items.find((c) => c.address === B);
  assert.equal(b?.venue, 'pool');
  assert.deepEqual(b?.marketCapUsd, { v: 90_000 });
  assert.equal(b?.launchedAt.at, NOW - 2 * HOUR);
});

test('★ a post on an unsure narrative lists the narrative\'s coins; a settled post lists nothing', async () => {
  await writeSameNameCoins(db, 'story', new Map([['st_jim', [C]]]));
  await feedRow('x:4', { kind: 'unsure', claimCount: 1 }, 'st_jim');
  const list = JSON.parse((await handle('GET', '/post/x%3A4/coins', read(), 'c2')).body) as { items: { address: string }[] };
  assert.deepEqual(list.items.map((c) => c.address), [C]);
  await feedRow('x:5', { kind: 'none' }, null);
  assert.equal((await handle('GET', '/post/x%3A5/coins', read(), 'c3')).status, 404);
});

test('each run rewrites a kind whole: a coin is never left listed under a post that moved on', async () => {
  await writeSameNameCoins(db, 'post', new Map());
  const left = await db.query<{ n: number }>(`select count(*)::int as n from public.same_name_coin where subject_kind = 'post'`);
  assert.equal(left[0]?.n, 0);
});
