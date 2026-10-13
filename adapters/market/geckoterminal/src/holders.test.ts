/**
 * The holder count: read when the vendor gives one, null — never zero — when it does not, and
 * asked at most a few times a minute.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { geckoterminalHolders, HOLDER_CALLS_PER_MINUTE, readHolders } from './holders.ts';

test('★ a count when given; null, never zero, when not', () => {
  assert.equal(readHolders({ data: { attributes: { holders: { count: 1234 } } } }), 1234);
  assert.equal(readHolders({ data: { attributes: {} } }), null);
  assert.equal(readHolders({ data: { attributes: { holders: { count: -1 } } } }), null);
});

test('kept between calls, and held back past the minute\'s budget', async () => {
  let calls = 0;
  const h = geckoterminalHolders({
    baseUrl: 'https://gt.test',
    timeoutMs: 1_000,
    now: () => 0,
    fetch: (async () => {
      calls += 1;
      return new Response(JSON.stringify({ data: { attributes: { holders: { count: 7 } } } }));
    }) as typeof globalThis.fetch,
  });
  assert.equal(await h.holders('a'), 7);
  assert.equal(await h.holders('a'), 7);
  assert.equal(calls, 1);
  for (let i = 1; i < HOLDER_CALLS_PER_MINUTE; i += 1) await h.holders(`m${i}`);
  await assert.rejects(h.holders('one-too-many'));
});
