/**
 * The vendor edge, with the vendor replaced by a function.
 *
 * `fetch` is injected for exactly this reason: these tests are the only place
 * the HTTP half of the adapter is exercised, because the shared conformance
 * suite hands every venue a client that throws — "if a contract test ever needs
 * a client that does not throw, the thing it is testing has leaked into the
 * network half of the adapter". So the two halves are covered in two places,
 * and neither of them touches a socket.
 *
 * Every payload below is trimmed from a real response recorded on 14 August
 * 2026. The fields this adapter must IGNORE — `url`, `info.imageUrl`, `txns`,
 * `volume`, `priceChange` — are left in on purpose: they are the ones that
 * would hard-fail the projector if they ever found their way onto a reading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { chainId, venueId } from '@insidor/contracts/ids.ts';
import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import { httpClient, MAX_ADDRESSES_PER_CALL } from './client.ts';
import { toMarketState } from './to-market-state.ts';
import type { MarketReadContext } from './to-market-state.ts';

const BASE = 'https://vendor.invalid';
const CHAIN = chainId('solana');
const TOKEN = 'Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump';
const OTHER = 'A5FKymJyuGmnfTPkzHmxSFnHNa8HH1TDMdEDZLcpump';

const ctx: MarketReadContext = {
  asset: { chain: CHAIN, address: TOKEN },
  venue: venueId(CHAIN, 'pool'),
  observedAt: 1_786_723_000_000,
  vendor: 'dexscreener',
  endpoint: 'GET /token-pairs/v1/{chain}/{address}',
};

/** A fake vendor: it records what it was asked and answers with what it is told. */
function stubFetch(respond: (url: string) => Response | Promise<Response>): {
  readonly fetch: typeof globalThis.fetch;
  readonly urls: string[];
} {
  const urls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    urls.push(String(input));
    return respond(String(input));
  };
  return { fetch, urls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clientOver = (respond: (url: string) => Response | Promise<Response>) => {
  const stub = stubFetch(respond);
  return { client: httpClient({ baseUrl: BASE, fetch: stub.fetch }), urls: stub.urls };
};

/** One healthy pooled pair, with the noise the vendor really sends. */
const fullPair = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  chainId: 'solana',
  dexId: 'raydium',
  url: 'https://dexscreener.com/solana/93tjgwff5ac5thymi8c4wejvvqq4tumemuyw1leyz7bu',
  pairAddress: '93tjgwff5Ac5ThyMi8C4WejVVQq4tuMeMuYW1LEYZ7bu',
  baseToken: { address: TOKEN, name: 'Just a chill guy', symbol: 'CHILLGUY' },
  quoteToken: { address: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
  priceNative: '0.0001376',
  priceUsd: '0.01035',
  txns: { h24: { buys: 689, sells: 683 } },
  volume: { h24: 90_362.98 },
  priceChange: { h24: -6.94 },
  liquidity: { usd: 1_080_054.03, base: 52_075_439, quote: 7183.4766 },
  fdv: 10_356_698,
  marketCap: 10_356_698,
  pairCreatedAt: 1_731_701_302_000,
  info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/20ae19e2.png' },
  ...over,
});

test('a full pair comes back as the mapper expects, and its numbers survive the round trip', async () => {
  const { client, urls } = clientOver(() => jsonResponse([fullPair()]));

  const raw = await client.pairsForToken('solana', TOKEN);
  assert.deepEqual(urls, [`${BASE}/token-pairs/v1/solana/${TOKEN}`]);

  const state = toMarketState(raw, ctx);
  assert.equal(state.priceUsd, 0.01035, 'the price arrives as a string and must survive as a number');
  assert.equal(state.marketCapUsd, 10_356_698);
  assert.equal(state.marketCapBasis, 'circulating', 'marketCap was present, so the basis is circulating');
  assert.equal(state.liquidityUsd, 1_080_054.03);
  assert.equal(state.depth?.kind, 'pool');
  assert.equal(state.priceChange24hPct, -6.94, 'a fall is a signed number, not a missing one');
  assert.equal(state.mintedAt.confidence, 'unknown', 'a pair-creation time is never a mint time');
});

test('a pair with no priceChange object has no 24h change — which is not a change of zero', async () => {
  const fresh = fullPair();
  delete fresh.priceChange;

  const { client } = clientOver(() => jsonResponse([fresh]));
  const state = toMarketState(await client.pairsForToken('solana', TOKEN), ctx);

  assert.equal(state.priceChange24hPct, null, 'a coin younger than a day did not hold flat for one');
  assert.equal(state.priceUsd, 0.01035, 'and it still has a price');
});

test('a pair with no liquidity object keeps its price and reports no liquidity — not zero', async () => {
  const curve = fullPair({ dexId: 'pumpfun', marketCap: undefined, fdv: 21_400 });
  delete curve.liquidity;
  delete curve.marketCap;

  const { client } = clientOver(() => jsonResponse([curve]));
  const state = toMarketState(await client.pairsForToken('solana', TOKEN), ctx);

  assert.equal(state.liquidityUsd, null);
  assert.notEqual(state.liquidityUsd, 0);
  assert.equal(state.priceUsd, 0.01035, 'no reserve is not no market');
  assert.equal(state.marketCapUsd, 21_400);
  assert.equal(state.marketCapBasis, 'fully-diluted', 'only fdv was present, and the basis says so');
});

test('a pair the vendor sends with no priceUsd is unpriced, and is not dropped or zeroed', async () => {
  const unpriced = fullPair({ dexId: 'meteora' });
  delete unpriced.priceUsd;
  delete unpriced.liquidity;
  delete unpriced.fdv;
  delete unpriced.marketCap;

  const { client } = clientOver(() => jsonResponse([unpriced]));
  const raw = await client.pairsForToken('solana', TOKEN);
  assert.equal((raw as { pairs: readonly unknown[] }).pairs.length, 1, 'the pair is still returned');

  const state = toMarketState(raw, ctx);
  assert.equal(state.priceUsd, null);
  assert.equal(state.marketCapUsd, null);
  assert.equal(state.marketCapBasis, null, 'no cap means no basis — the two move together');
});

test('a negative price is unreadable, not a price', async () => {
  const broken = fullPair({ priceUsd: '-0.01', fdv: -1, marketCap: -1 });
  const { client } = clientOver(() => jsonResponse([broken]));
  const state = toMarketState(await client.pairsForToken('solana', TOKEN), ctx);

  assert.equal(state.priceUsd, null);
  assert.equal(state.marketCapUsd, null);
  assert.equal(state.marketCapBasis, null);
});

test('an empty array is a normal answer: no pair exists, and that is not an error', async () => {
  const { client } = clientOver(() => jsonResponse([]));

  const raw = await client.pairsForToken('solana', TOKEN);
  assert.deepEqual(raw, { pairs: [] });

  const state = toMarketState(raw, ctx);
  assert.equal(state.priceUsd, null);
  assert.equal(state.marketCapUsd, null);
  assert.equal(state.liquidityUsd, null);
  assert.equal(state.depth, null);
});

test('the deepest pool decides the price, and a thin pool with a wild price does not', async () => {
  const deep = fullPair({ pairAddress: 'deep', priceUsd: '0.01040', liquidity: { usd: 1_082_766.71 } });
  const thin = fullPair({ pairAddress: 'thin', priceUsd: '0.06238', liquidity: { usd: 19.36 } });
  const noReserve = fullPair({ pairAddress: 'none', dexId: 'meteora', priceUsd: '0.99' });
  delete noReserve.liquidity;

  // Deliberately unsorted, and with the thin pool first: nothing may depend on
  // the order the vendor happened to send.
  const { client } = clientOver(() => jsonResponse([thin, noReserve, deep]));
  const state = toMarketState(await client.pairsForToken('solana', TOKEN), ctx);

  assert.equal(state.priceUsd, 0.0104);
  assert.equal(state.liquidityUsd, 1_082_766.71);
  assert.ok(state.depth?.kind === 'pool');
  assert.equal(state.depth.poolCount, 2, 'the pair with no reserve is counted in no pool');
});

test('★ a pair where our token is the QUOTE side is another coin’s price, and is dropped', async () => {
  // Measured on the live endpoint: 7 of 30 pairs returned for one token were
  // pairs it quotes. Their priceUsd and marketCap belong to the base token, and
  // one of them was deep enough to win a depth-first ranking.
  const ours = fullPair({ pairAddress: 'ours', priceUsd: '0.01035', liquidity: { usd: 1_000 } });
  const theirs = fullPair({
    pairAddress: 'theirs',
    baseToken: { address: OTHER, symbol: 'MOOSK' },
    quoteToken: { address: TOKEN, symbol: 'CHILLGUY' },
    priceUsd: '0.00002627',
    marketCap: 26_276,
    liquidity: { usd: 4_928.12 },
  });

  const { client } = clientOver(() => jsonResponse([theirs, ours]));
  const raw = await client.pairsForToken('solana', TOKEN);
  assert.equal((raw as { pairs: readonly unknown[] }).pairs.length, 1);

  const state = toMarketState(raw, ctx);
  assert.equal(state.priceUsd, 0.01035, 'the deeper pool was somebody else’s market');
  assert.equal(state.marketCapUsd, 10_356_698);
});

test('a pair with no attributable base token is dropped rather than guessed at', async () => {
  const orphan = fullPair({ pairAddress: 'orphan', liquidity: { usd: 9_999_999 } });
  delete orphan.baseToken;

  const { client } = clientOver(() => jsonResponse([orphan, fullPair()]));
  const state = toMarketState(await client.pairsForToken('solana', TOKEN), ctx);
  assert.equal(state.liquidityUsd, 1_080_054.03);
});

test('HTTP 429 is unavailability carrying its status, never an empty market', async () => {
  const { client } = clientOver(() => new Response('rate limited', { status: 429 }));

  await assert.rejects(
    client.pairsForToken('solana', TOKEN),
    (error: unknown) => {
      assert.ok(error instanceof VendorUnavailable, 'a throttled vendor is an outage, not a coin with no pair');
      assert.equal(error.status, 429);
      return true;
    },
  );
});

test('404 is unavailability too — the vendor says “no such token” with 200 and an empty array', async () => {
  const { client } = clientOver(() => new Response('<!DOCTYPE html>', { status: 404 }));
  await assert.rejects(client.pairsForToken('solana', TOKEN), VendorUnavailable);
});

test('200 with a body that is not JSON is an outage in a success code', async () => {
  const { client } = clientOver(
    () => new Response('<!DOCTYPE html><title>Just a moment…</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
  );

  await assert.rejects(client.pairsForToken('solana', TOKEN), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.match(error.message, /not JSON/);
    return true;
  });
});

test('JSON that is not a list of pairs is a shape error, so a schema change is loud', async () => {
  const { client } = clientOver(() => jsonResponse({ pairs: [fullPair()] }));

  await assert.rejects(client.pairsForToken('solana', TOKEN), (error: unknown) => {
    assert.ok(error instanceof VendorShapeError, 'the vendor answered in JSON; the JSON was the wrong shape');
    assert.equal(error.field, 'body');
    return true;
  });
});

test('a request that never reaches the vendor is unavailability with no status', async () => {
  const { client } = clientOver(() => {
    throw new Error('ECONNRESET');
  });

  await assert.rejects(client.pairsForToken('solana', TOKEN), (error: unknown) => {
    assert.ok(error instanceof VendorUnavailable);
    assert.equal(error.status, undefined, 'a socket error has no HTTP status to report');
    return true;
  });
});

test('many addresses go out as one comma-joined call, and come back split by address', async () => {
  const addresses = [TOKEN, OTHER];
  const { client, urls } = clientOver(() =>
    jsonResponse([
      fullPair({ pairAddress: 'ours' }),
      fullPair({
        pairAddress: 'theirs',
        baseToken: { address: OTHER, symbol: 'OTHER' },
        priceUsd: '0.5',
        liquidity: { usd: 10 },
      }),
    ]),
  );

  const raw = await client.pairsForTokens('solana', addresses);
  assert.deepEqual(urls, [`${BASE}/tokens/v1/solana/${TOKEN},${OTHER}`]);
  assert.equal((raw as { pairs: readonly unknown[] }).pairs.length, 2, 'both tokens’ pairs are kept');
});

test('a pair for a token nobody asked about never enters the batch', async () => {
  const stranger = 'StrangerAddre55111111111111111111111111111';
  const { client } = clientOver(() =>
    jsonResponse([fullPair({ baseToken: { address: stranger }, liquidity: { usd: 99 } })]),
  );

  const raw = await client.pairsForTokens('solana', [TOKEN]);
  assert.deepEqual(raw, { pairs: [] });
});

test('the batch bounds throw rather than truncate, because a dropped token reads as no market', async () => {
  const many = Array.from({ length: MAX_ADDRESSES_PER_CALL }, (_, i) => `Addre55${i}`);
  const { client, urls } = clientOver(() => jsonResponse([]));

  await client.pairsForTokens('solana', many);
  assert.equal(urls.length, 1, `${MAX_ADDRESSES_PER_CALL} is the documented ceiling and must be accepted`);

  await assert.rejects(client.pairsForTokens('solana', [...many, 'OneTooMany']), RangeError);
  await assert.rejects(client.pairsForTokens('solana', []), RangeError);
  assert.equal(urls.length, 1, 'neither refusal reached the vendor');
});

test('a chain this adapter does not read is refused before any request is made', async () => {
  const { client, urls } = clientOver(() => jsonResponse([]));

  // The vendor answers 200 with [] for a chain it has never heard of, so an
  // unchecked slug would read as "no coin here has a market", quietly, forever.
  await assert.rejects(client.pairsForToken('ethereum', TOKEN), RangeError);
  await assert.rejects(client.pairsForTokens('notachain', [TOKEN]), RangeError);
  assert.deepEqual(urls, [], 'nothing was asked');
});

test('an address that would change the request is refused', async () => {
  const { client, urls } = clientOver(() => jsonResponse([]));

  // A comma is the batch separator: smuggled into one address it would silently
  // become two, and every result after it would belong to the wrong coin.
  await assert.rejects(client.pairsForTokens('solana', [`${TOKEN},${OTHER}`]), RangeError);
  await assert.rejects(client.pairsForToken('solana', '../../token-pairs/v1/solana/x'), RangeError);
  await assert.rejects(client.pairsForToken('solana', ''), RangeError);
  assert.deepEqual(urls, []);
});

test('a base url with a trailing slash builds the same request as one without', async () => {
  const stub = stubFetch(() => jsonResponse([]));
  const client = httpClient({ baseUrl: `${BASE}/`, fetch: stub.fetch });

  await client.pairsForToken('solana', TOKEN);
  assert.deepEqual(stub.urls, [`${BASE}/token-pairs/v1/solana/${TOKEN}`]);
});
