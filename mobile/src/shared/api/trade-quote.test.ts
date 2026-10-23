/**
 * The quote decode's `via`: what a pool quote's router trades against, read from beside the quote.
 * Its own file because it stubs `fetch` — the one transport client.ts uses — and must not leak
 * that stub into the pure decode tests. If `via` were read from inside the quote, or invented when
 * absent, a stock pair still on its curve would be called a bonded pool, or an older trade
 * service's reply would stop decoding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchTradeQuote } from './client.ts';

const POOL = { venue: 'pool', inputMint: 'So11111111111111111111111111111111111111112', outputMint: 'x', inAmount: '30000000', outAmount: '5', bound: '4', slippageBps: 300, priceImpactPct: 0.01, raw: {} };
const CURVE = { venue: 'curve', side: 'buy', mint: 'x', inAmount: '30000000', outAmount: '5', bound: '30900000', slippageBps: 300 };

async function quoted(reply: Record<string, unknown>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(reply), { status: 200 })) as typeof fetch;
  try {
    const r = await fetchTradeQuote({ mint: 'x', side: 'buy', amount: '30000000', wallet: 'w', slippageBps: 300 });
    assert.equal(r.kind, 'quote');
    return r.kind === 'quote' ? r.quote : null;
  } finally {
    globalThis.fetch = real;
  }
}

test('a stock pair still on its curve decodes as via the curve, and a bonded coin as via its pool', async () => {
  assert.equal((await quoted({ quote: POOL, via: 'curve' }))?.via, 'curve');
  assert.equal((await quoted({ quote: POOL, via: 'pool' }))?.via, 'pool');
});

test('an older trade service that does not say still decodes, with no via', async () => {
  const q = await quoted({ quote: POOL });
  assert.equal(q?.venue, 'pool');
  assert.equal(q !== null && 'via' in q, false);
  assert.equal((await quoted({ quote: POOL, via: 'elsewhere' })) !== null, true, 'a garbled via is dropped, not a refusal');
});

test('a curve quote carries no via, and the quote sent back to the build is the server\'s, untouched', async () => {
  const c = await quoted({ quote: CURVE, via: 'curve' });
  assert.equal(c !== null && 'via' in c, false);
  const p = await quoted({ quote: POOL, via: 'curve' });
  assert.deepEqual(p?.sent, POOL);
});
