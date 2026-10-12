/**
 * ★ THE COIN UNIVERSE'S KEEP RULE: every coin for fourteen days; after that, only the coins that
 * matter. Bonded, seen above the bar, named by a narrative or a post, with a found origin, in the
 * gold set, or priced by us — kept. Never traded, or small and on the curve — deleted, with its
 * metadata. An outage deletes nothing. A deleted coin is still found by name: the name index
 * (0037) keeps every coin the mint stream or a search saw, forever, and nothing else.
 *
 * Real schema (PGlite), the real step. The market source is a stand-in.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinStanding, CoinStandings } from '@insidor/contracts/ports/coin-search.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { keepCoins } from '@insidor/runner/src/work/coin-keep.ts';
import { ASSET_SQL } from '@insidor/read/src/market.ts';
import { ASSET_FACTS_SQL, ASSET_SEARCH_SQL } from '@insidor/read/src/search.ts';
import { PgCoinUniverseRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const DAY = 86_400_000;
const P = DEFAULT_POLICY;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

let db: Db;

/* Each coin is named for what should happen to it. */
const COINS = {
  young: { ageDays: 3 },
  unlisted: { ageDays: 20 },
  small: { ageDays: 20 },
  unknownCap: { ageDays: 20 },
  bonded: { ageDays: 20 },
  big: { ageDays: 20 },
  onStory: { ageDays: 20 },
  onPost: { ageDays: 20 },
  gold: { ageDays: 20 },
  originPost: { ageDays: 20 },
  priced: { ageDays: 20 },
  seeded: { ageDays: 20, origin: 'operator' },
} as const;
type Name = keyof typeof COINS;
const address = (n: Name) => `${n}${'1'.repeat(40 - n.length)}pump`;
const key = (n: Name) => `solana:${address(n)}`;

const ANSWER: Partial<Record<Name, CoinStanding>> = {
  young: { bonded: false, marketCapUsd: 1 },
  small: { bonded: false, marketCapUsd: P.universe.keep.marketCapUsd - 1 },
  unknownCap: { bonded: false, marketCapUsd: null },
  bonded: { bonded: true, marketCapUsd: 4_000 },
  big: { bonded: false, marketCapUsd: P.universe.keep.marketCapUsd },
};

function market(fail = false): CoinStandings & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    batch: 4,
    async standings(addresses) {
      asked.push(...addresses);
      if (fail) throw new Error('down');
      const out = new Map<string, CoinStanding>();
      for (const [n, s] of Object.entries(ANSWER)) if (addresses.includes(address(n as Name))) out.set(address(n as Name), s);
      return out;
    },
  };
}

const run = (standings: CoinStandings) =>
  keepCoins({ coins: new PgCoinUniverseRepo(db), standings, policy: P, log: quiet, now: () => NOW });

async function held(): Promise<ReadonlySet<string>> {
  return new Set((await db.query<{ asset_key: string }>(`select asset_key from public.asset`, [])).map((r) => r.asset_key));
}

before(async () => {
  db = await migratedDb();
  for (const [n, c] of Object.entries(COINS) as [Name, (typeof COINS)[Name]][]) {
    await db.query(
      `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
       values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 5, 'X', $4, '{}'::jsonb, $3, $5)`,
      [address(n), key(n), new Date(NOW - c.ageDays * DAY), n, 'origin' in c ? c.origin : 'live_stream'],
    );
    await db.query(`insert into internal.coin_metadata (asset_key, outcome, read_at) values ($1, 'not_content_addressed', now())`, [key(n)]);
  }
  await db.query(`insert into public.story_view (story_id, payload) values ('st_1', $1::jsonb)`, [JSON.stringify({ id: 'st_1', coins: { kind: 'one', coin: { coinId: key('onStory') } } })]);
  await db.query(`insert into public.rising_view (feed_id, tick) values ('fyp', 1)`, []);
  await db.query(`insert into public.rising_row (feed_id, item_id, position, payload) values ('fyp', 'x:1', 0, $1::jsonb)`, [JSON.stringify({ id: 'x:1', coins: { kind: 'one', coin: { coinId: key('onPost') } } })]);
  const origin = `insert into internal.coin_origin (asset_key, status, post_item_id, why, checked_at, policy_version) values ($1, $2, $3, 'test', now(), 'test')`;
  await db.query(origin, [key('gold'), 'found_by_team', null]);
  await db.query(origin, [key('originPost'), 'viral_after_launch', 'x:9']);
  await db.query(
    `insert into public.market_reading (chain, address, asset_key, venue_id, taken_at, price_absent, market_cap_absent, liquidity_absent, price_change_24h_absent, tradable, source_vendor, source_endpoint)
     values ('solana', $1, $2, 'solana:pool', now(), 'no_market', 'no_market', 'no_market', 'no_market', false, 'test', 'test')`,
    [address('priced'), key('priced')],
  );
});

test('★ an outage on the market source deletes nothing and records nothing', async () => {
  const down = market(true);
  const r = await run(down);
  assert.deepEqual(r, { asked: 0, deleted: 0 });
  assert.equal((await held()).size, Object.keys(COINS).length);
  const standings = await db.query<{ n: number }>(`select count(*)::int as n from internal.coin_standing`, []);
  assert.equal(standings[0]?.n, 0);
});

test('★ only the old coins that do not matter go: never traded, or small on the curve', async () => {
  const m = market();
  const r = await run(m);
  const asked = new Set(m.asked);
  for (const n of ['onStory', 'onPost', 'gold', 'originPost', 'priced', 'seeded', 'young'] as const) {
    assert.equal(asked.has(address(n)), false, `${n} is never asked about: nothing an answer says could change it`);
  }
  assert.equal(r.asked, 5);
  assert.equal(r.deleted, 2);
  const left = await held();
  assert.equal(left.has(key('unlisted')), false, 'not listed anywhere: nobody traded it');
  assert.equal(left.has(key('small')), false, 'on the curve and below the bar');
  for (const n of ['young', 'unknownCap', 'bonded', 'big', 'onStory', 'onPost', 'gold', 'originPost', 'priced', 'seeded'] as const) {
    assert.equal(left.has(key(n)), true, `${n} is kept`);
  }
  const orphans = await db.query<{ n: number }>(`select count(*)::int as n from internal.coin_metadata m where not exists (select 1 from public.asset a where a.asset_key = m.asset_key)`, []);
  assert.equal(orphans[0]?.n, 0, 'a deleted coin\'s metadata goes with it');
});

test('a coin is asked about once; the next pass asks nothing and deletes nothing more', async () => {
  const m = market();
  assert.deepEqual(await run(m), { asked: 0, deleted: 0 });
  assert.equal(m.asked.length, 0);
});

test('★ a deleted coin is still found by its ticker or name, and still opens, from the name index', async () => {
  assert.equal((await held()).has(key('small')), false);
  const byTicker = await db.query<{ address: string }>(ASSET_SEARCH_SQL, ['X', 50, 'nothing']);
  assert.ok(byTicker.some((r) => r.address === address('small')));
  const byName = await db.query<{ address: string; image_uri: string | null }>(ASSET_SEARCH_SQL, ['NOTHING', 50, 'Small']);
  assert.deepEqual(byName.map((r) => r.address), [address('small')]);
  const facts = await db.query<{ name: string }>(ASSET_FACTS_SQL, [address('small')]);
  assert.equal(facts[0]?.name, 'small');
  const market = await db.query<{ address: string }>(ASSET_SQL, [key('small')]);
  assert.equal(market[0]?.address, address('small'), 'its market still loads live');
});

test('a seed is never in the name index: a fiction is not a coin anyone can find', async () => {
  const seeded = await db.query(`select 1 from public.coin_name where address = $1`, [address('seeded')]);
  assert.equal(seeded.length, 0);
});
