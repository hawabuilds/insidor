/**
 * Search, read from a recorded reply: only Solana launchpad pairs survive, so a same-named coin
 * on another chain or venue never reaches a list; a full answer says the list was cut.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH } from './__fixtures__/search.ts';
import { readSearch } from './search.ts';

test('★ only Solana launchpad coins come back, curve or graduated, with name and picture where given', () => {
  const { hits, capped } = readSearch(SEARCH);
  assert.ok(hits.length > 0);
  for (const h of hits) assert.ok(h.venue === 'curve' || h.venue === 'pool');
  assert.ok(hits.some((h) => h.ticker === '$NAPS' && h.venue === 'curve'));
  assert.equal(hits.some((h) => h.ticker === 'ORCA'), false, 'another venue on the same chain is dropped');
  assert.equal(capped, true, 'the vendor returned its maximum, so the list may be cut');
});
