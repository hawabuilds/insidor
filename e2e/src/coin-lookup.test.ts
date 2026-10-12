/**
 * ★ LOOKING UP COINS WE NEVER SAW MINTED: a promoted narrative with no coin has its name
 * searched; recent launchpad coins go into the universe as candidates (`backfill`), old ones and
 * ones we hold do not; the name is not searched again inside the keep time; and an outage on
 * every source is never recorded as "searched, nothing found".
 *
 * Real schema (PGlite), the real step. The two sources and the chain are stand-ins.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { storyId } from '@insidor/contracts/ids.ts';
import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Logger } from '@insidor/runner/src/log.ts';
import { lookUpCoins, type LookupDeps } from '@insidor/runner/src/work/coin-lookup.ts';
import { PgAssetRepo, PgCoinUniverseRepo, PgJudgementRepo, PgStoryRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const DAY = 86_400_000;
const P = DEFAULT_POLICY;
const STORY = storyId('raccoon');
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

let db: Db;
const asked: string[] = [];

const hit = (address: string, ageMs: number, source: string): CoinSearchHit => ({
  address, name: 'Jimothy', ticker: 'JIM', venue: 'curve', createdAt: NOW - ageMs, marketCapUsd: 5_000, imageUrl: null, source,
});
const RECENT = 'Rec1111111111111111111111111111111111111pump';
const OLD = 'Old1111111111111111111111111111111111111pump';
const HELD = 'Hel1111111111111111111111111111111111111pump';

function sources(fail = false): CoinSearch[] {
  const one = (name: string, hits: CoinSearchHit[]): CoinSearch => ({
    search: async (term) => {
      asked.push(`${name}:${term}`);
      if (fail) throw new Error('down');
      return { hits, capped: false };
    },
  });
  return [one('dex', [hit(RECENT, DAY, 'dex'), hit(OLD, 30 * DAY, 'dex')]), one('gecko', [hit(RECENT, DAY, 'gecko'), hit(HELD, DAY, 'gecko')])];
}

function deps(fail = false): LookupDeps {
  return {
    coins: new PgCoinUniverseRepo(db),
    assets: new PgAssetRepo(db),
    sources: sources(fail),
    chain: { metadataUri: async () => 'https://ipfs.io/ipfs/bafkreiexampleexampleexampleexampleexampleexampleexample', oldestSignatureBlockTime: async () => Math.floor((NOW - DAY) / 1000) },
    policy: P,
    log: quiet,
    now: () => NOW,
  };
}

before(async () => {
  db = await migratedDb();
  await new PgStoryRepo(db).upsert({
    storyId: STORY, state: 'promoted', origin: 'observed', createdAt: (NOW - DAY) as Millis, promotedAt: (NOW - DAY) as Millis,
    earliestPostAt: (NOW - DAY) as Millis, lastMemberAt: (NOW - DAY) as Millis, memberCount: 3, distinctAuthors: 3, distinctSources: 1, carriers: [], mergedInto: null,
  });
  await db.query(`insert into public.story_view (story_id, payload) values ($1, $2::jsonb)`, [STORY, JSON.stringify({ id: STORY, coins: { kind: 'none' } })]);
  await new PgJudgementRepo(db).record(STORY, 3, {
    judgeId: 'judge:test', promptId: 'p', judgedAt: NOW, coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'Jimothy', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0,
  });
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', now(), 'vendor_field', 'bounded', 5, 'JIM', 'Jimothy', '{}'::jsonb, now(), 'live_stream')`,
    [HELD, `solana:${HELD}`],
  );
});

test('★ an outage on every source is not recorded as "searched, nothing found"', async () => {
  const result = await lookUpCoins(deps(true));
  assert.deepEqual(result, { searched: 0, added: 0 });
  assert.equal((await db.query(`select 1 from internal.coin_lookup`)).length, 0);
});

test('★ a narrative with no coin: its name searched, recent launchpad coins added as candidates, old and held ones not', async () => {
  asked.length = 0;
  const result = await lookUpCoins(deps());
  assert.deepEqual(result, { searched: 1, added: 1 });
  assert.deepEqual(asked.sort(), ['dex:Jimothy', 'gecko:Jimothy']);
  const rows = await db.query<{ address: string; origin: string; minted_at_source: string; declared_social: { metadata?: string } }>(
    `select address, origin, minted_at_source, declared_social from public.asset where origin = 'backfill'`,
  );
  assert.deepEqual(rows.map((r) => r.address), [RECENT], 'the 30-day-old coin is out of the window; the held one is not added again');
  assert.equal(rows[0]?.minted_at_source, 'chain_rpc');
  assert.ok(rows[0]?.declared_social.metadata?.includes('/ipfs/'), 'the metadata link from the chain, so the universe reads it by content id');
  const lookup = await db.query<{ found: number; added: number }>(`select found, added from internal.coin_lookup where subject_id = $1`, [STORY]);
  assert.deepEqual(lookup.map((l) => [Number(l.found), Number(l.added)]), [[2, 1]]);
});

test('the same name is not searched again inside the keep time', async () => {
  asked.length = 0;
  assert.deepEqual(await lookUpCoins(deps()), { searched: 0, added: 0 });
  assert.deepEqual(asked, []);
});
