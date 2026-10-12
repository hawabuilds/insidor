import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import { SILENT } from './log.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';
import { ASSET_SEARCH_SQL, createSearch, normaliseTerm, POST_SEARCH_SQL, STORY_SEARCH_SQL, type NamedSearch } from './search.ts';

const POLICY = DEFAULT_POLICY.search;

const hit = (over: Partial<CoinSearchHit>): CoinSearchHit => ({
  address: 'A', name: 'Jimothy', ticker: 'JIM', venue: 'curve', marketAddress: 'curveA', createdAt: 1_000, marketCapUsd: 5_000, imageUrl: null, source: 's', ...over,
});

function source(answer: () => Promise<{ hits: readonly CoinSearchHit[]; capped: boolean }>): CoinSearch & { calls: number } {
  const s = { calls: 0, search: async () => { s.calls += 1; return answer(); } };
  return s;
}

const STORY_ROW: Row = {
  story_id: 'st_jim',
  live: false,
  payload: {
    title: 'Jimothy the cat',
    thumbUrl: null,
    provenance: { kind: 'observed' },
    earliestPost: { at: 500 },
    coins: { kind: 'one', coin: { coinId: 'solana:B', address: 'B', mintedAt: { at: 900 }, priceUsd: { v: 0.001 }, marketCapUsd: { v: 1_000_000 } } },
    evidence: [{ evidenceId: 'e1', permalink: 'https://x.com/a/status/1', authorLabel: '@a', excerpt: 'jim is back', postedAt: { at: 500 }, sourceLabel: 'X', thumbUrl: null }],
  },
};

function harness(opts: { sources?: readonly NamedSearch[]; rows?: Partial<Record<string, readonly Row[]>>; curve?: (a: string) => Promise<number | null> } = {}) {
  let now = 10_000;
  const queries: string[] = [];
  const db = {
    query: async (sql: string) => {
      queries.push(sql);
      return opts.rows?.[sql] ?? [];
    },
  };
  const search = createSearch({
    db,
    log: SILENT,
    policy: POLICY,
    sources: opts.sources ?? [],
    curveProgress: opts.curve ?? null,
    images: async (mints) => new Map(mints.filter((m) => m === 'A').map((m) => [m, 'https://ipfs.io/ipfs/a'])),
    market: { coin: async () => ({ pool: null, candles: [{ t: 1, o: 1, h: 0.004, l: 1, c: 1 }], trades: [] }) } as never,
    now: () => now,
  });
  return { search, queries, tick: (ms: number) => { now += ms; } };
}

const body = (r: { body: string }) => JSON.parse(r.body) as Record<string, any>;

test('a ticker is searched with or without its dollar sign, and a term too short or too long is refused', () => {
  assert.equal(normaliseTerm('  $jim ', POLICY), 'jim');
  assert.equal(normaliseTerm('j', POLICY), null);
  assert.equal(normaliseTerm('x'.repeat(POLICY.maxTermLength + 1), POLICY), null);
  assert.equal(normaliseTerm(null, POLICY), null);
});

test('★ one coin per address across the sources, biggest first, and only the pipeline\'s own coin says "matched"', async () => {
  const dex = source(async () => ({ hits: [hit({ address: 'A', marketCapUsd: 5_000 }), hit({ address: 'B', venue: 'pool', marketAddress: 'poolB', marketCapUsd: 900_000, imageUrl: 'https://cdn.vendor.example/b.png' })], capped: false }));
  const gecko = source(async () => ({ hits: [hit({ address: 'A', name: null, imageUrl: 'img' })], capped: false }));
  const { search } = harness({ sources: [{ name: 'dex', source: dex }, { name: 'gecko', source: gecko }], rows: { [STORY_SEARCH_SQL]: [STORY_ROW] }, curve: async () => 0.25 });
  const r = body(await search.search('jim', 'c1'));
  assert.equal(r.coins.kind, 'read');
  assert.deepEqual(r.coins.items.map((c: any) => c.address), ['B', 'A']);
  const [b, a] = r.coins.items;
  assert.deepEqual(b.matched, { storyId: 'st_jim', title: 'Jimothy the cat', coinId: 'solana:B' });
  assert.equal(b.venue, 'pool');
  assert.equal(b.curveProgress, null, 'a bonded coin has no curve to be along');
  assert.equal(a.matched, null, 'a same-named coin is a coin with that name, nothing more');
  assert.equal(a.imageUrl, 'https://ipfs.io/ipfs/a', 'the coin\'s own picture, from its metadata');
  assert.equal(b.imageUrl, null, 'a source\'s hosted copy is never shown');
  assert.deepEqual(a.curveProgress, { v: 0.25 });
  assert.equal(r.coins.capped, false);
});

test('★ a post found by search carries no narrative and no coin, so nothing can put a Buy button on it', async () => {
  const live = { id: 'x:9', permalink: 'https://x.com/b/status/9', authorLabel: '@b', excerpt: 'JIM to the moon', postedAt: { at: 1 }, storyId: 'st_jim', coins: { kind: 'one' }, sourceLabel: 'X', thumbUrl: null };
  const { search } = harness({ rows: { [POST_SEARCH_SQL]: [{ payload: live }], [STORY_SEARCH_SQL]: [STORY_ROW] } });
  const r = body(await search.search('jim', 'c1'));
  assert.equal(r.posts.items.length, 2, 'one live from the feed, one historical from the narrative');
  for (const p of r.posts.items) {
    assert.equal('storyId' in p, false);
    assert.equal('coins' in p, false);
    assert.equal('coin' in p, false);
  }
  assert.deepEqual(r.posts.items.map((p: any) => p.live), [true, false]);
});

test('★ a historical narrative\'s line: first post, first coin, and its peak from the price history', async () => {
  const { search } = harness({ rows: { [STORY_SEARCH_SQL]: [STORY_ROW] } });
  const [n] = body(await search.search('jim', 'c1')).narratives.items;
  assert.deepEqual(n.firstPostAt, { at: 500 });
  assert.deepEqual(n.firstCoinAt, { at: 900 });
  /* high 0.004 × (1,000,000 / 0.001) supply = 4,000,000 */
  assert.deepEqual(n.peakMarketCapUsd, { v: 4_000_000 });
  assert.equal(n.live, false);
});

test('only observed narratives and only chainwatch\'s own coins are searched — never a seed or a fixture', () => {
  assert.match(STORY_SEARCH_SQL, /provenance,kind\}' = 'observed'/);
  assert.match(ASSET_SEARCH_SQL, /origin in \('live_stream', 'backfill'\)/);
});

test('★ an outage is not an empty list: every source down is "unavailable", one down is counted', async () => {
  const down = source(async () => { throw new Error('429'); });
  const up = source(async () => ({ hits: [hit({})], capped: true }));
  const both = harness({ sources: [{ name: 'dex', source: down }, { name: 'gecko', source: down }] });
  assert.deepEqual(body(await both.search.search('jim', 'c1')).coins, { kind: 'unavailable' });
  const one = harness({ sources: [{ name: 'dex', source: down }, { name: 'gecko', source: up }] });
  const coins = body(await one.search.search('jim', 'c1')).coins;
  assert.equal(coins.sourcesMissing, 1, 'counted, never named: a vendor name is not for the screen');
  assert.equal(coins.capped, true, 'a source that cut its list says "Showing top results"');
});

test('★ chainwatch\'s own zero-trade coin is listed, with where it trades unknown rather than guessed', async () => {
  const { search } = harness({ sources: [{ name: 'dex', source: source(async () => ({ hits: [], capped: false })) }], rows: { [ASSET_SEARCH_SQL]: [{ address: 'Z', symbol: 'JIM', name: 'Jim', image_uri: null, minted_at: new Date(2_000) }] } });
  const [z] = body(await search.search('jim', 'c1')).coins.items;
  assert.equal(z.venue, null);
  assert.deepEqual(z.marketCapUsd, { v: null, why: 'no_market' });
  assert.deepEqual(z.launchedAt, { at: 2_000 });
});

test('★ a term reaches the sources at most once a minute, and one client is told to slow down', async () => {
  const s = source(async () => ({ hits: [], capped: false }));
  const h = harness({ sources: [{ name: 's', source: s }] });
  await h.search.search('jim', 'c1');
  await h.search.search('JIM', 'c2');
  assert.equal(s.calls, 1, 'the same term within the minute is the kept answer');
  h.tick(POLICY.keepMs);
  await h.search.search('jim', 'c3');
  assert.equal(s.calls, 2);
  for (let i = 0; i < POLICY.perClient; i += 1) await h.search.search('jim', 'busy');
  assert.equal((await h.search.search('jim', 'busy')).status, 429);
  assert.equal((await h.search.search('jim', 'calm')).status, 200, 'one client\'s limit is not everyone\'s');
});

test('★ a coin a search returned opens as a token page for a while; an address nobody searched is a 404', async () => {
  const s = source(async () => ({ hits: [hit({ address: 'A' })], capped: false }));
  const h = harness({ sources: [{ name: 's', source: s }] });
  const db = { query: async () => [] as Row[] };
  const deps = { db, log: SILENT, search: h.search, market: { market: { coin: async () => ({ pool: null, candles: [], trades: [] }) } as never, curveProgress: null } };
  assert.equal((await handle('GET', '/coin/solana%3AA/market?tf=1h', deps)).status, 404);
  assert.equal((await handle('GET', '/coin/solana%3AA', deps)).status, 404);
  await handle('GET', '/search?q=jim', deps, 'c1');
  assert.equal((await handle('GET', '/coin/solana%3AA/market?tf=1h', deps)).status, 200);
  const facts = JSON.parse((await handle('GET', '/coin/solana%3AA', deps)).body);
  assert.equal(facts.ticker, 'JIM');
  assert.equal((await handle('GET', '/coin/solana%3AQ/market?tf=1h', deps)).status, 404);
  h.tick(POLICY.openableMs);
  assert.equal((await handle('GET', '/coin/solana%3AA/market?tf=1h', deps)).status, 404);
});
