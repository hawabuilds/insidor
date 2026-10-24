/**
 * Search, read from a recorded reply: only Solana launchpad pairs survive, so a same-named coin
 * on another chain or venue never reaches a list; a full answer says the list was cut. And the
 * second, launchpad question (`launchpadToo`) only ever adds coins named like the term.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH } from './__fixtures__/search.ts';
import { dexscreenerSearch, readSearch, withLaunchpad } from './search.ts';

test('★ only Solana launchpad coins come back, curve or graduated, with name and picture where given', () => {
  const { hits, capped } = readSearch(SEARCH);
  assert.ok(hits.length > 0);
  for (const h of hits) assert.ok(h.venue === 'curve' || h.venue === 'pool');
  assert.ok(hits.some((h) => h.ticker === '$NAPS' && h.venue === 'curve'));
  assert.equal(hits.some((h) => h.ticker === 'ORCA'), false, 'another venue on the same chain is dropped');
  assert.equal(capped, true, 'the vendor returned its maximum, so the list may be cut');
});

const pair = (dexId: string, mint: string, symbol: string, name: string, pairAddress: string) => ({
  chainId: 'solana', dexId, pairAddress, baseToken: { address: mint, name, symbol }, pairCreatedAt: 1, marketCap: 10,
});
const hit = (address: string, ticker: string, name: string, marketAddress: string) => ({
  address, name, ticker, venue: 'curve' as const, marketAddress, createdAt: 1, marketCapUsd: 10, imageUrl: null, source: 'dexscreener',
});

test('★ the launchpad answer adds coins named like the term, never one already listed or named otherwise', () => {
  const plain = { hits: [hit('A', 'PEPE', 'Pepe', 'pa')], capped: true };
  const launchpad = { hits: [hit('A', 'PEPE', 'Pepe', 'pa'), hit('B', 'DOPE', 'Dope Pepe', 'pb'), hit('C', 'McRib', 'McRib', 'pc')], capped: false };
  const out = withLaunchpad('pepe', plain, launchpad);
  assert.deepEqual(out.hits.map((h) => h.address), ['A', 'B'], 'the plain answer first; a coin not named like the term is dropped');
  assert.equal(out.capped, true);
  assert.equal(withLaunchpad('pepe', plain, null), plain, 'no second answer: the plain one, as it was');
});

function fakeFetch(answers: Record<string, unknown>, asked: string[]): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    const q = new URL(String(input)).searchParams.get('q') ?? '';
    asked.push(q);
    const body = answers[q];
    return body === undefined ? new Response('no', { status: 503 }) : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
}

test('★ launchpadToo asks twice and merges; the second failing is not an outage; an address is asked once', async () => {
  const asked: string[] = [];
  const s = dexscreenerSearch({
    baseUrl: 'https://x.test', timeoutMs: 1000, launchpadToo: true,
    fetch: fakeFetch({
      cat: { pairs: [pair('pumpfun', 'M1', 'CAT', 'Cat', 'P1')] },
      'cat pump': { pairs: [pair('pumpfun', 'M2', 'WEIRDCAT', 'weird cat', 'P2'), pair('pumpswap', 'M3', 'GATO', 'gato', 'P3')] },
    }, asked),
  });
  const out = await s.search('cat');
  assert.deepEqual(out.hits.map((h) => h.address), ['M1', 'M2']);
  assert.deepEqual(asked.sort(), ['cat', 'cat pump']);

  const down: string[] = [];
  const half = dexscreenerSearch({ baseUrl: 'https://x.test', timeoutMs: 1000, launchpadToo: true, fetch: fakeFetch({ cat: { pairs: [pair('pumpfun', 'M1', 'CAT', 'Cat', 'P1')] } }, down) });
  assert.deepEqual((await half.search('cat')).hits.map((h) => h.address), ['M1'], 'the launchpad question failing leaves the plain answer');

  const plainDown = dexscreenerSearch({ baseUrl: 'https://x.test', timeoutMs: 1000, launchpadToo: true, fetch: fakeFetch({ 'cat pump': { pairs: [] } }, []) });
  await assert.rejects(plainDown.search('cat'), 'the plain question failing is the source being down');

  const once: string[] = [];
  const mint = '58YoqjCKAdp9W7bPq16P2YvfTsxM8h7eqos3hUuMpump';
  const byAddress = dexscreenerSearch({ baseUrl: 'https://x.test', timeoutMs: 1000, launchpadToo: true, fetch: fakeFetch({ [mint]: { pairs: [] } }, once) });
  await byAddress.search(mint);
  assert.deepEqual(once, [mint]);

  const off: string[] = [];
  await dexscreenerSearch({ baseUrl: 'https://x.test', timeoutMs: 1000, fetch: fakeFetch({ cat: { pairs: [] } }, off) }).search('cat');
  assert.deepEqual(off, ['cat'], 'off by default: one question');
});
