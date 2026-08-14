/**
 * The button rule, asserted.
 *
 * The type system already prevents an `unsure` link reaching a buy component; these tests
 * cover the part types cannot: that the mapping from coin count to affordance is the one the
 * product asked for, and that an unsure match produces no action rather than a quiet default.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Coin } from '../../shared/api/index.ts';
import { known, instant } from '../../shared/format/measure.ts';
import { actionFor, actionLabel } from './row-action.ts';

function coin(ticker: string, tradable = true): Coin {
  return {
    coinId: `c_${ticker}`,
    ticker,
    name: ticker,
    address: `addr_${ticker}`,
    venueLabel: 'a launchpad',
    imageUrl: null,
    mintedAt: instant(1_700_000_000_000),
    priceUsd: known(0.0001),
    marketCapUsd: known(120_000),
    marketCapBasis: 'fully-diluted',
    liquidityUsd: known(9_000),
    priceChange24h: known(4.2),
    tradable,
  };
}

test('no coins means Create', () => {
  const action = actionFor('st_1', { kind: 'none' });
  assert.equal(action.kind, 'create');
  if (action.kind === 'create') assert.equal(actionLabel(action), 'Create');
});

test('one coin means Buy', () => {
  const action = actionFor('st_1', { kind: 'one', coin: coin('KANG') });
  assert.equal(action.kind, 'buy');
  if (action.kind === 'buy') assert.equal(actionLabel(action), 'Buy KANG');
});

test('several coins mean Compare', () => {
  const action = actionFor('st_1', { kind: 'several', coins: [coin('A'), coin('B'), coin('C')] });
  assert.equal(action.kind, 'compare');
  if (action.kind === 'compare') assert.equal(actionLabel(action), 'Compare 3');
});

test('an unsure match produces no button at all, not a disabled one', () => {
  const action = actionFor('st_1', { kind: 'unsure', claimCount: 306 });
  assert.equal(action.kind, 'none');
  if (action.kind === 'none') {
    assert.equal(action.reason, 'match_unsure');
    assert.equal(action.claimCount, 306);
  }
  /* And there is no coin anywhere in the result to hand to a buy panel. */
  assert.equal(JSON.stringify(action).includes('ticker'), false);
});

test('a single coin we cannot trade also produces no button', () => {
  /* The venue design: if mint time cannot be confirmed, no buy affordance renders. The
     server expresses that as tradable=false and the client is not allowed to argue. */
  const action = actionFor('st_1', { kind: 'one', coin: coin('KANG', false) });
  assert.equal(action.kind, 'none');
  if (action.kind === 'none') assert.equal(action.reason, 'not_tradable');
});
