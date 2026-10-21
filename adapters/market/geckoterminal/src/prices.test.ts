import test from 'node:test';
import assert from 'node:assert/strict';

import { geckoterminalTokenPrices, PRICE_KEEP_MS, readTokenPrices } from './prices.ts';

const LAURA = 'Cg9zDsrNUzkm7cUgrXyv5TaKpbH5dpnr4E7pFAZYpump';
const MSTRX = 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ';
/* Recorded 2026-10-21 (shortened digits); DEAD is a coin the reply prices at nothing. */
const REPLY = { data: { id: 'x', type: 'simple_token_price', attributes: { token_prices: { [LAURA]: '0.0000395621574790296', [MSTRX]: '146.371427967573547', DEAD: null } } } };

test('★ a coin paired only with another coin is priced in dollars; one priced at nothing is absent, never zero', () => {
  const p = readTokenPrices(REPLY);
  assert.equal(p.get(LAURA), 0.0000395621574790296);
  assert.equal(p.get(MSTRX), 146.371427967573547);
  assert.equal(p.has('DEAD'), false);
  assert.equal(readTokenPrices({}).size, 0);
});

test('answers are kept briefly, batches follow the plan, an outage throws', async () => {
  let now = 1_000;
  const asked: string[] = [];
  const prices = geckoterminalTokenPrices({
    plan: 'pro',
    baseUrl: 'https://x.example/onchain/',
    headers: { 'x-cg-pro-api-key': 'k' },
    now: () => now,
    timeoutMs: 1_000,
    fetch: (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(REPLY), { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(prices.batch, 100);
  const first = await prices.prices([LAURA, MSTRX, 'DEAD']);
  assert.equal(first.get(LAURA), 0.0000395621574790296);
  assert.equal(first.has('DEAD'), false);
  assert.equal(asked.length, 1);
  assert.match(asked[0] ?? '', /\/simple\/networks\/solana\/token_price\/Cg9z/);
  await prices.prices([LAURA, 'DEAD']);
  assert.equal(asked.length, 1, 'kept, including the coin with no price');
  now += PRICE_KEEP_MS;
  await prices.prices([LAURA]);
  assert.equal(asked.length, 2, 'asked again once the kept answer is old');

  const down = geckoterminalTokenPrices({ plan: 'free', baseUrl: 'https://x.example', now: () => 0, timeoutMs: 1_000, fetch: (async () => new Response('', { status: 503 })) as typeof fetch });
  assert.equal(down.batch, 30);
  await assert.rejects(down.prices([LAURA]), /503/);
});
