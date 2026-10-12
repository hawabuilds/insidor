/**
 * Search, read from a recorded reply: only launchpad coins (curve or graduated pool) on Solana,
 * the ticker read from the pool's name, the coin from its base token.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH } from './__fixtures__/search.ts';
import { readSearch } from './search.ts';

test('★ only the launchpad\'s coins come back, each with its venue', () => {
  const hits = readSearch(SEARCH);
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.ok(h.venue === 'curve' || h.venue === 'pool');
    assert.ok(h.address.length >= 32 && !h.address.startsWith('solana_'));
  }
  assert.ok(hits.some((h) => h.ticker === 'NAPS' && h.venue === 'curve'));
  assert.equal(hits.some((h) => h.ticker === 'Napster'), false, 'a coin on another venue is not a launchpad coin');
});
