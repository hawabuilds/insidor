/**
 * The market-data billing classification against the vendor's recorded error shape, and the
 * proof that a refused coin read still reaches the owner's listener even though the read itself
 * degrades to a missing part.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OutOfCredit, onOutOfCredit } from '@insidor/vendor-kit';

import { billingReason } from './billing.ts';
import { GRADUATED_MINT } from './__fixtures__/replies.ts';
import { geckoterminal } from './index.ts';

/* The vendor's error shape: `{ status: { error_code, error_message } }`. */
const err = (code: number, message: string): string => JSON.stringify({ status: { error_code: code, error_message: message } });

test('monthly credits used up and 402 are billing; pacing and a wrong key are not', () => {
  assert.equal(billingReason(429, err(1020, "You've exceeded your monthly API credits. Please upgrade.")), 'monthly credits used up');
  assert.equal(billingReason(402, 'refused'), 'payment required');
  assert.equal(
    billingReason(429, err(429, "You've exceeded the Rate Limit. Please visit the pricing page to subscribe to our API plans for higher rate limits.")),
    null,
    'a busy minute is not an empty account',
  );
  assert.equal(billingReason(401, err(10002, 'API Key Missing')), null);
  assert.equal(billingReason(500, err(1020, 'monthly credits')), null);
});

test('★ a refused read is heard by the listener even though the coin read degrades', async () => {
  const heard: string[] = [];
  const off = onOutOfCredit({ refused: (e) => heard.push(`${e.vendor}: ${e.reason}`) });
  try {
    const fetch = (async () => new Response(err(1020, "You've exceeded your monthly API credits (key demo-xyz)."), { status: 429 })) as unknown as typeof globalThis.fetch;
    const market = geckoterminal({ baseUrl: 'https://gecko.invalid', fetch, timeoutMs: 1_000, now: () => 1 });
    await assert.rejects(market.search('frog'), (e: unknown) => {
      assert.ok(e instanceof OutOfCredit);
      assert.doesNotMatch(e.message, /demo-xyz/);
      return true;
    });
    await market.coin(GRADUATED_MINT, '5m').catch(() => undefined);
    assert.ok(heard.length >= 2);
    assert.ok(heard.every((h) => h === 'geckoterminal: monthly credits used up'));
  } finally {
    off();
  }
});
