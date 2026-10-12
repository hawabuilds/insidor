/**
 * ★ A COIN STILL ALIVE TODAY SHOWS ITS MARKET CAP AND ITS NARRATIVE IN SEARCH: the narrative's
 * name, its origin post (or the typed reason there is none), its first coin and its peak. A past
 * narrative opens no story page — it was never on the board — and its coins are kept forever.
 *
 * Real schema (PGlite), the real search. The market source is a stand-in.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { CoinSearch } from '@insidor/contracts/ports/coin-search.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { SILENT } from '@insidor/read/src/log.ts';
import { createSearch } from '@insidor/read/src/search.ts';
import { PgHistoryRepo } from '@insidor/store';
import type { Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const NOW = Date.now() as Millis;
const ALIVE = 'Aliv111111111111111111111111111111111pump';
const OTHER = 'Othr111111111111111111111111111111111pump';
const FIRST = 'Frst111111111111111111111111111111111pump';
let db: Db;

const listing: CoinSearch = {
  search: async () => ({
    hits: [
      { address: ALIVE, name: 'Moo Deng', ticker: 'MOODENG', venue: 'pool', marketAddress: 'pool1', createdAt: NOW - 400 * 86_400_000, marketCapUsd: 180_000_000, imageUrl: null, source: 'x' },
      { address: OTHER, name: 'Moo Deng', ticker: 'MOODENG', venue: 'curve', marketAddress: 'curve1', createdAt: NOW - 86_400_000, marketCapUsd: 4_000, imageUrl: null, source: 'x' },
    ],
    capped: false,
  }),
};

before(async () => {
  db = await migratedDb();
  await new PgHistoryRepo(db).save({
    narrativeId: 'h_moodeng',
    title: 'Moo Deng',
    originPost: { authorLabel: '@khaokheowzoo', permalink: 'https://x.com/khaokheowzoo/status/1', postedAt: (NOW - 401 * 86_400_000) as Millis, afterLaunch: false },
    originGap: null,
    firstCoin: FIRST,
    firstCoinAt: (NOW - 400.5 * 86_400_000) as Millis,
    biggestCoin: ALIVE,
    peakMarketCapUsd: 600_000_000,
    coins: [FIRST, ALIVE],
  }, NOW);
});

const search = () => createSearch({
  db, log: SILENT, policy: DEFAULT_POLICY.search, sources: [{ name: 'x', source: listing }],
  curveProgress: null, images: null, market: null, now: () => NOW,
});

test('★ an alive coin carries today\'s market cap and the narrative it belongs to; a namesake does not', async () => {
  const r = JSON.parse((await search().search('moodeng', 'c1')).body);
  const alive = r.coins.items.find((c: any) => c.address === ALIVE);
  const other = r.coins.items.find((c: any) => c.address === OTHER);
  assert.deepEqual(alive.marketCapUsd, { v: 180_000_000 });
  assert.deepEqual(alive.matched, { storyId: null, title: 'Moo Deng' });
  assert.equal(other.matched, null, 'a same-named coin made yesterday is not that narrative');
});

test('★ the narrative shows its origin post, first coin and peak, and opens no story page', async () => {
  const r = JSON.parse((await search().search('moo deng', 'c2')).body);
  const n = r.narratives.items.find((x: any) => x.title === 'Moo Deng');
  assert.equal(n.storyId, null);
  assert.equal(n.live, false);
  assert.equal(n.originPost.authorLabel, '@khaokheowzoo');
  assert.equal(n.originPost.afterLaunch, false);
  assert.deepEqual(n.peakMarketCapUsd, { v: 600_000_000 });
  assert.equal(n.firstCoinAt.at, NOW - 400.5 * 86_400_000);
  assert.equal(n.originGap, null);
});

test('a gap is a reason, never a blank: a narrative cannot be stored with neither', async () => {
  await assert.rejects(db.query(
    `insert into public.history_narrative (narrative_id, title, first_coin, biggest_coin, built_at) values ('h_x', 'X', 'a', 'a', now())`, [],
  ));
});
