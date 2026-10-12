import test from 'node:test';
import assert from 'node:assert/strict';

import { ASKED, TOKENS_REPLY } from './__fixtures__/tokens.ts';
import { dexscreenerStandings, readQuotes, readStandings, TOKENS_BATCH } from './tokens.ts';

test('★ bonded, on the curve, or not listed at all — read from a recorded reply', () => {
  const s = readStandings(TOKENS_REPLY);
  assert.deepEqual(s.get(ASKED[0]), { bonded: true, marketCapUsd: 4648, name: 'Aura Bird', ticker: 'Stork' });
  assert.deepEqual(s.get(ASKED[1]), { bonded: false, marketCapUsd: 4387.53, name: 'Nap Protocol', ticker: '$NAPS' });
  assert.equal(s.has(ASKED[2]), false, 'asked about and not listed');
});

test('a coin with a curve pair and a pool pair is bonded, at its larger market cap', () => {
  const s = readStandings([
    { chainId: 'solana', dexId: 'pumpfun', baseToken: { address: 'A' }, marketCap: 10 },
    { chainId: 'solana', dexId: 'pumpswap', baseToken: { address: 'A' }, marketCap: 90 },
    { chainId: 'base', dexId: 'uniswap', baseToken: { address: 'B' }, marketCap: 1 },
  ]);
  assert.deepEqual(s.get('A'), { bonded: true, marketCapUsd: 90, name: null, ticker: null });
  assert.equal(s.has('B'), false);
});

test('★ an outage throws; it is never a reply that listed nothing', async () => {
  const down = dexscreenerStandings({ baseUrl: 'https://x.example', timeoutMs: 1_000, fetch: (async () => new Response('', { status: 429 })) as typeof fetch });
  await assert.rejects(down.standings(['A']), /429/);
  await assert.rejects(down.standings(Array.from({ length: TOKENS_BATCH + 1 }, (_, i) => `A${i}`)), RangeError);
});

test('a coin\'s price in dollars and in SOL, and its moves; a move the source did not report is missing, not zero', async () => {
  const { QUOTES_REPLY } = await import('./__fixtures__/quotes.ts');
  const q = readQuotes(QUOTES_REPLY);
  const stork = q.get(ASKED[0]);
  assert.equal(stork?.priceSol, 0.00000004447);
  assert.equal(stork?.change.h1, -0.11);
  assert.equal(q.get(ASKED[1])?.change.h1, null, 'NAPS has no 1-hour change in this reply');
  assert.equal(q.has(ASKED[2]), false);
});
