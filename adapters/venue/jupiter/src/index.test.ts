import test from 'node:test';
import assert from 'node:assert/strict';

import { BONDED_QUOTE } from './__fixtures__/quote.ts';
import { jupiter, NATIVE, readQuote } from './index.ts';

test('a recorded quote reads as amounts, the least out at the slippage, and its route', () => {
  const q = readQuote(BONDED_QUOTE);
  assert.equal(q.inAmount, '10000000');
  assert.equal(q.outAmount, '219226227870');
  assert.equal(q.bound, '212649441034');
  assert.equal(q.slippageBps, 300);
  assert.deepEqual(q.route, ['Pump.fun Amm']);
  assert.equal(q.inputMint, NATIVE);
});

test('★ the build sends the quote back exactly as it came, never re-priced', async () => {
  const sent: unknown[] = [];
  const j = jupiter({
    baseUrl: 'https://jup.example', apiKey: null, timeoutMs: 1_000,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ swapTransaction: 'AQID', lastValidBlockHeight: 7 }));
    }) as unknown as typeof fetch,
  });
  const built = await j.build(readQuote(BONDED_QUOTE), 'User1111111111111111111111111111111111111');
  assert.deepEqual((sent[0] as { quoteResponse: unknown }).quoteResponse, BONDED_QUOTE);
  assert.equal(built.transactionBase64, 'AQID');
});

test('★ a build with no transaction throws; half an answer is never returned', async () => {
  const j = jupiter({ baseUrl: 'https://jup.example', apiKey: null, timeoutMs: 1_000, fetch: (async () => new Response('{}')) as unknown as typeof fetch });
  await assert.rejects(j.build(readQuote(BONDED_QUOTE), 'U'), /no transaction/);
});

test('no route is said as no route, and a key travels only when one is set', async () => {
  const seen: Record<string, string>[] = [];
  const j = jupiter({
    baseUrl: 'https://jup.example', apiKey: 'k', timeoutMs: 1_000,
    fetch: (async (_u: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ error: 'Could not find any route' }), { status: 400 });
    }) as unknown as typeof fetch,
  });
  await assert.rejects(j.quote({ inputMint: NATIVE, outputMint: 'X', amount: 1n, slippageBps: 100 }), /no route/);
  assert.equal(seen[0]?.['x-api-key'], 'k');
});
