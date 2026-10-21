import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '@insidor/contracts';
import type { CoinSearch, CoinSearchHit } from '@insidor/contracts/ports/coin-search.ts';

import { SILENT } from './log.ts';
import type { Row } from './queries.ts';
import { handle } from './routes.ts';
import { SAME_NAME_SQL } from './same-name.ts';
import { ASSET_SEARCH_SQL, coinHitFromQuote, createSearch, normaliseTerm, POST_SEARCH_SQL, STORY_SEARCH_SQL, TICKER_COUNT_SQL, type NamedSearch } from './search.ts';

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

function harness(opts: { sources?: readonly NamedSearch[]; rows?: Partial<Record<string, readonly Row[]>>; curve?: (a: string) => Promise<number | null>; lookup?: (a: string) => Promise<CoinSearchHit | null> } = {}) {
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
    ...(opts.lookup === undefined ? {} : { lookup: opts.lookup }),
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
  assert.deepEqual(b.matched, { storyId: 'st_jim', title: 'Jimothy the cat' });
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
  /* The name index admits only the mint stream's and a search's coins (0037's trigger); the
     e2e coin-keep test proves a seed never reaches it. */
  assert.match(ASSET_SEARCH_SQL, /from public\.coin_name/);
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

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';

test('★ a held coin we never indexed opens by its address once a market source lists it; one nobody lists is still a 404', async () => {
  const asked: string[] = [];
  let down = false;
  const lookup = async (a: string) => {
    asked.push(a);
    if (down) throw new Error('responded 429');
    return a === LAURA ? hit({ address: LAURA, name: 'Forever Laura', ticker: 'Laura', venue: 'pool', marketAddress: 'Fv44ZP4nZa45cT7Vv2UaQ8o5jNdrZzjuE3jvT1jPYVDK', createdAt: null, source: 'lookup' }) : null;
  };
  const h = harness({ lookup });
  const pools: string[] = [];
  const deps = {
    db: { query: async () => [] as Row[] },
    log: SILENT,
    search: h.search,
    market: { market: { coin: async (m: string) => { pools.push(m); return { pool: { address: 'Fv44', dex: 'pumpswap', reserveUsd: 18_000 }, candles: [{ t: 1, o: 1, h: 1, l: 1, c: 1 }], trades: [] }; } } as never, curveProgress: null },
  };
  /* The page asks for its facts and its chart at once: both answer, from one lookup. */
  const [facts, market] = await Promise.all([handle('GET', `/coin/solana%3A${LAURA}`, deps), handle('GET', `/coin/solana%3A${LAURA}/market?tf=1h`, deps)]);
  assert.equal(facts.status, 200);
  assert.equal(body(facts).ticker, 'Laura');
  assert.equal(body(facts).venue, 'pool');
  assert.equal(market.status, 200);
  assert.equal(body(market).venue, 'pool', 'the chart is the pool it actually trades in');
  assert.deepEqual(pools, [LAURA]);
  assert.deepEqual(asked, [LAURA]);

  /* Unlisted anywhere: a 404, and the answer is kept, so asking again costs no call. */
  const NOBODY = 'So11111111111111111111111111111111111111113';
  assert.equal((await handle('GET', `/coin/solana%3A${NOBODY}`, deps)).status, 404);
  assert.equal((await handle('GET', `/coin/solana%3A${NOBODY}/market?tf=1h`, deps)).status, 404);
  assert.deepEqual(asked, [LAURA, NOBODY]);
  /* Not an address at all: never looked up. */
  assert.equal((await handle('GET', '/coin/solana%3Anot-an-address', deps)).status, 404);
  assert.equal(asked.length, 2);

  /* An outage is not remembered as "not listed": the next ask tries again. */
  h.tick(POLICY.openableMs);
  down = true;
  assert.equal((await handle('GET', `/coin/solana%3A${LAURA}`, deps)).status, 404);
  down = false;
  assert.equal((await handle('GET', `/coin/solana%3A${LAURA}`, deps)).status, 200);
});

test('a looked-up coin: its deepest pair\'s venue, and a launch time only where the pair\'s creation is the launch', () => {
  const q = { name: 'Forever Laura', ticker: 'Laura', priceUsd: null, priceSol: null, marketCapUsd: null, liquidityUsd: null, change: { h1: null, h6: null, h24: null }, bonded: true };
  const pool = coinHitFromQuote(LAURA, { ...q, pair: { address: 'Fv44', dex: 'pumpswap', createdAt: 1_792_498_067_000 } }, 'https://ipfs.io/ipfs/l');
  assert.deepEqual(pool, { address: LAURA, name: 'Forever Laura', ticker: 'Laura', venue: 'pool', marketAddress: 'Fv44', createdAt: null, marketCapUsd: null, imageUrl: 'https://ipfs.io/ipfs/l', source: 'lookup' });
  const curve = coinHitFromQuote(LAURA, { ...q, pair: { address: 'curve', dex: 'pumpfun', createdAt: 5 } }, null);
  assert.equal(curve?.venue, 'curve');
  assert.equal(curve?.createdAt, 5);
  assert.equal(coinHitFromQuote(LAURA, undefined, null), null, 'not listed');
});

test('the ticker check counts the coins we have seen with it, and nothing more', async () => {
  const { search } = harness({ rows: { [TICKER_COUNT_SQL]: [{ n: 3 }] } });
  assert.deepEqual(body(await search.ticker('$jim', 'c1')), { ticker: 'jim', seen: 3 });
  assert.equal((await search.ticker('', 'c1')).status, 400);
});

/* ── GET /post/:id/coins ─────────────────────────────────────────────── */

const held = (address: string, over: Partial<Row> = {}): Row => ({
  address, symbol: 'JIM', name: 'Jimothy', image_uri: null, minted_at: new Date(2_000), more: false, ...over,
});

test('★ an unsure post lists exactly the coins committed beside it, each as Search shows it', async () => {
  const dex = source(async () => ({
    hits: [
      hit({ address: 'A', marketCapUsd: 5_000, marketAddress: 'curveA' }),
      hit({ address: 'B', venue: 'pool', marketAddress: 'poolB', marketCapUsd: 900_000, imageUrl: 'https://cdn.vendor.example/b.png' }),
      hit({ address: 'Z', marketCapUsd: 1 }),
    ],
    capped: false,
  }));
  const { search } = harness({
    sources: [{ name: 'dex', source: dex }],
    rows: { [SAME_NAME_SQL]: [held('A'), held('B', { image_uri: 'https://ipfs.io/ipfs/b' }), held('C', { minted_at: null })] },
    curve: async () => 0.42,
  });
  const reply = await search.postCoins('x:1', 'c1');
  assert.equal(reply.status, 200);
  const r = body(reply);
  assert.deepEqual(r.items.map((c: any) => c.address), ['A', 'B', 'C'], 'the committed list, and a same-named coin not on it (Z) is not added');
  const [a, b, c] = r.items;
  assert.deepEqual(a.curveProgress, { v: 0.42 });
  assert.equal(a.coinId, 'solana:A');
  assert.equal(a.imageUrl, 'https://ipfs.io/ipfs/a', 'a picture from the coin\'s metadata when we hold none');
  assert.equal(b.venue, 'pool');
  assert.equal(b.curveProgress, null);
  assert.equal(b.imageUrl, 'https://ipfs.io/ipfs/b', 'our copy, never the source\'s');
  assert.deepEqual(b.marketCapUsd, { v: 900_000 });
  assert.equal(c.venue, null, 'a coin no source listed has no venue');
  assert.deepEqual(c.marketCapUsd, { v: null, why: 'no_market' }, 'and a dash with why, never zero');
  assert.deepEqual(c.launchedAt, { at: null, why: 'not_reported' }, 'an unknown launch is a dash, never "brand new"');
  assert.deepEqual(a.launchedAt, { at: 2_000 }, 'the launch we hold, not the source\'s market time');
  assert.equal(r.more, false);
  assert.equal(r.sourcesMissing, 0);
  assert.equal(dex.calls, 1, 'the coins share a name: one search finds them all');
});

test('★ a post that is not unsure on a feed has nothing to list: a 404, through the route too', async () => {
  const { search } = harness();
  assert.equal((await search.postCoins('x:gone', 'c1')).status, 404);
  const routed = await handle('GET', '/post/x%3Agone/coins', { db: { query: async () => [] }, log: SILENT, search }, 'c1');
  assert.equal(routed.status, 404);
});

test('an unsure post with nothing we can list is an empty list, told apart from "not here"', async () => {
  const { search } = harness({ rows: { [SAME_NAME_SQL]: [{ address: null, symbol: null, name: null, image_uri: null, minted_at: null, more: false }] } });
  const r = await search.postCoins('x:1', 'c1');
  assert.equal(r.status, 200);
  assert.deepEqual(body(r).items, []);
});

test('★ a list the search cut short says so, so the screen can say "10+" and not a smaller count', async () => {
  const { search } = harness({ rows: { [SAME_NAME_SQL]: [held('A', { more: true }), held('B', { more: true })] } });
  assert.equal(body(await search.postCoins('x:1', 'c1')).more, true);
});

test('★ an outage is said, and a coin it left unlisted is "not read", never "no market"', async () => {
  const down = source(async () => { throw new Error('down'); });
  const { search } = harness({ sources: [{ name: 'dex', source: down }], rows: { [SAME_NAME_SQL]: [held('A')] } });
  const r = body(await search.postCoins('x:1', 'c1'));
  assert.equal(r.sourcesMissing, 1);
  assert.deepEqual(r.items[0].marketCapUsd, { v: null, why: 'not_read_yet' });
  assert.equal(r.items.length, 1, 'the coins are still listed with what we hold of them');
});

test('a listed coin is remembered as a search hit, so its page shows the same facts', async () => {
  const dex = source(async () => ({ hits: [hit({ address: 'A', marketCapUsd: 7_000 })], capped: false }));
  const { search } = harness({ sources: [{ name: 'dex', source: dex }], rows: { [SAME_NAME_SQL]: [held('A')] } });
  await search.postCoins('x:1', 'c1');
  const facts = body((await search.facts('solana:A'))!);
  assert.deepEqual(facts.marketCapUsd, { v: 7_000 });
  assert.deepEqual(facts.launchedAt, { at: 2_000 });
});

test('the list is kept a minute and counted against the per-client limit like a search', async () => {
  const dex = source(async () => ({ hits: [], capped: false }));
  const { search, tick } = harness({ sources: [{ name: 'dex', source: dex }], rows: { [SAME_NAME_SQL]: [held('A')] } });
  await search.postCoins('x:1', 'c1');
  await search.postCoins('x:1', 'c1');
  assert.equal(dex.calls, 1, 'opened twice, read once');
  tick(POLICY.keepMs);
  for (let i = 0; i < POLICY.perClient; i += 1) await search.postCoins(`x:${i + 2}`, 'c2');
  assert.equal((await search.postCoins('x:99', 'c2')).status, 429);
});
