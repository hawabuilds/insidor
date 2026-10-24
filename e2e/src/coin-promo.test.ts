/**
 * ★ A COIN'S PROMOTION FOLLOWED TO THE VIRAL POST on the real schema (PGlite, every migration; 0118,
 * 0132): a launch whose metadata names its launcher's post, which links an account's viral post by
 * URL. The runner's coin-link step records the link coin → viral post with the promotion as its
 * `via`, writes no row for the promotion, credits the viral post to the coin_link lane, and the
 * one-coin matcher then sees the coin linking the viral post itself. Nothing is fetched, paid for or
 * sent anywhere: both posts are already held.
 */

import { strict as assert } from 'node:assert';
import { before, test } from 'node:test';

import type { Item, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import { inMemoryMeter } from '@insidor/meter';
import type { Logger } from '@insidor/runner/src/log.ts';
import { coinLinksPass } from '@insidor/runner/src/work/coin-links.ts';
import { PgFinderRepo, PgItemRepo, PgOneCoinRepo, type Db } from '@insidor/store';

import { migratedDb } from './db.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet } as unknown as Logger;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Math.floor(Date.now() / MIN) * MIN;
const PROMO = 'x:5001';
const VIRAL = 'x:5002';
const COIN = 'Prom1111111111111111111111111111pump';
const iso = (ms: number) => new Date(ms).toISOString();
const ON: Policy = { ...DEFAULT_POLICY, finders: { ...DEFAULT_POLICY.finders, coinLinks: { ...DEFAULT_POLICY.finders.coinLinks, on: true } } };

/* The text source as the coin-link step needs it: its links parsed, its posts addressed. Nothing is read. */
const x = {
  id: 'x',
  capabilities: { discovery: ['catchall'] },
  parseLink: (url: string) => {
    const m = /^https:\/\/x\.com\/(\w+)\/status\/(\d+)/.exec(url);
    return m?.[2] === undefined ? null : { kind: 'post' as const, sourceItemId: m[2], handle: m[1] };
  },
  postLink: (id: string, handle: string | null) => `https://x.com/${handle ?? 'i'}/status/${id}`,
  estimate: () => ({ vendor: 'x', endpoint: 'lookup', usd: 0 }),
  lookup: async () => {
    throw new Error('nothing is read here');
  },
} as unknown as PlatformAdapter;

let db: Db;

before(async () => {
  db = await migratedDb();
  await db.query(`insert into public.author (author_key, source, source_author_id, handle) values ('x:viral', 'x', 'viral', 'viral'), ('x:launcher', 'x', 'launcher', 'launcher')`);
  const reach = (value: number) => ({ reach: { value, fidelity: { kind: 'exact' }, observedAt: NOW } });
  await new PgItemRepo(db).upsert([
    {
      itemId: VIRAL, source: 'x', sourceItemId: '5002', origin: 'observed', authorKey: 'x:viral', postedAt: NOW - 3 * HOUR, firstSeenAt: NOW - 3 * HOUR, lang: 'en', text: 'the cat',
      media: [], counters: reach(2_000_000), fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: 'r', refersTo: [],
    },
    {
      itemId: PROMO, source: 'x', sourceItemId: '5001', origin: 'observed', authorKey: 'x:launcher', postedAt: NOW - 5 * MIN, firstSeenAt: NOW - 5 * MIN, lang: 'en',
      text: '$CAT is live https://t.co/abc', media: [], counters: reach(12), fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: 'r', refersTo: [VIRAL],
    },
  ] as unknown as Item[]);
  await db.query(
    `insert into public.asset (chain, address, asset_key, venue_id, minted_at, minted_at_source, minted_at_conf, minted_at_bound_s, symbol, name, declared_social, first_seen_at, origin)
     values ('solana', $1, $2, 'solana:pumpfun', $3, 'vendor_field', 'bounded', 300, 'CAT', 'Cat', '{"metadata": "ipfs://doc"}'::jsonb, $3, 'live_stream')`,
    [COIN, `solana:${COIN}`, iso(NOW - 10_000)],
  );
});

test('★ the promotion is the viral post\'s `via`, never a row of its own; the viral post is credited and tied to the coin', async () => {
  const items = new PgItemRepo(db);
  const r = await coinLinksPass({
    finders: new PgFinderRepo(db),
    coins: { recordMetadata: async () => undefined },
    metadata: { read: async () => ({ kind: 'read', cid: 'c', metadata: { name: 'Cat', ticker: 'CAT', description: null, imageUri: null, links: { social: 'https://x.com/launcher/status/5001', website: null, chat: null } } }) },
    sources: () => [x],
    follow: async (url) => url,
    items,
    store: async () => 0,
    meter: inMemoryMeter({ dailyCapUsd: 1, perVendorCapUsd: { x: 1 }, softStop: 1, now: () => NOW as Millis }),
    mode: 'live',
    policy: ON,
    log: quiet,
    now: () => NOW as Millis,
  });
  assert.equal(r.followed, 1);
  const rows = await db.query<{ item: string; via: string | null; link: string }>(`select source || ':' || source_item_id as item, via, link from internal.coin_post_link where address = $1`, [COIN]);
  assert.deepEqual(rows.map((l) => [l.item, l.via, l.link]), [[VIRAL, PROMO, 'https://x.com/viral/status/5002']]);
  const found = await db.query<{ item_id: string; lane: string }>(`select item_id, lane from internal.item_found_by where item_id = any($1::text[])`, [[PROMO, VIRAL]]);
  assert.deepEqual(found.map((f) => [f.item_id, f.lane]), [[VIRAL, 'coin_link']]);
  const launches = await new PgOneCoinRepo(db).recentLaunches(NOW - HOUR, 100, 'v1');
  assert.deepEqual(launches.find((l) => l.address === COIN)?.linksPosts, [VIRAL]);
});
