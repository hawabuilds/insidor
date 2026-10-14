/**
 * The owner's coin calls folded per post (owner-coin-calls.ts): "wrong" + a coin is the right coin,
 * except a retraction of a coin once called right (the KARL label), and the order decides.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { addressOfCoinId, coinLabelOf, foldCoinCalls, type CoinCallRow } from './owner-coin-calls.ts';

let id = 0;
const call = (verdict: string, coin: string | null, atMs: number, shownCoin: string | null = null, itemId = 'p'): CoinCallRow => ({ itemId, verdict, coinAddress: coin, shownCoin, atMs, id: (id += 1) });

test('★ KARL: "This is the coin" then "wrong" on the same coin is a retraction, not a confirmation', () => {
  /* internal.owner_feedback rows 15 and 183, 2026-10-13. */
  const f = foldCoinCalls([call('right', '84NRtW', 1), call('wrong', '84NRtW', 2)]).get('p');
  assert.ok(f !== undefined);
  assert.equal(f.own, null);
  assert.equal(f.wrong.get('84NRtW'), 2);
  assert.equal(coinLabelOf(f), null);
});

test('★ "Wrong coin" then "This one": the picked coin is the post\'s, the shown coin is wrong', () => {
  const f = foldCoinCalls([call('wrong', null, 1, 'SHOWN'), call('wrong', 'PICKED', 2, 'SHOWN')]).get('p');
  assert.deepEqual(f?.own, { address: 'PICKED', atMs: 2 });
  assert.equal(f?.wrong.has('SHOWN'), true);
  assert.equal(f?.wrong.has('PICKED'), false);
  assert.deepEqual(coinLabelOf(f), { right: 'PICKED' });
});

test('"wrong" + a coin read alone (no earlier right on it) is the right coin', () => {
  assert.deepEqual(coinLabelOf(foldCoinCalls([call('wrong', 'A', 1)]).get('p')), { right: 'A' });
});

test('the order is by time, then id, whatever order the rows come in', () => {
  const rows = [call('wrong', 'A', 2), call('right', 'A', 1)];
  assert.equal(foldCoinCalls(rows.reverse()).get('p')?.own, null);
});

test('a later right takes a coin off the wrong list; none and cleared stand as said', () => {
  const later = foldCoinCalls([call('right', 'A', 1), call('wrong', 'A', 2), call('right', 'A', 3)]).get('p');
  assert.deepEqual(later?.own, { address: 'A', atMs: 3 });
  assert.equal(later?.wrong.size, 0);
  const none = foldCoinCalls([call('right', 'A', 1), call('none', null, 2)]).get('p');
  assert.equal(none?.none, true);
  assert.deepEqual(coinLabelOf(none), { right: null });
  const cleared = foldCoinCalls([call('wrong', null, 1, 'S'), call('cleared', null, 2)]).get('p');
  assert.equal(cleared?.wrong.size, 0);
  assert.equal(coinLabelOf(cleared), null);
});

test('a retraction after "Remove my label" is still a retraction', () => {
  const f = foldCoinCalls([call('right', 'A', 1), call('cleared', null, 2), call('wrong', 'A', 3)]).get('p');
  assert.equal(f?.own, null);
  assert.equal(f?.wrong.has('A'), true);
});

test('a bare "Wrong coin" on the owner\'s own coin drops it; on another coin keeps it', () => {
  assert.equal(foldCoinCalls([call('right', 'A', 1), call('wrong', null, 2, 'A')]).get('p')?.own, null);
  assert.deepEqual(foldCoinCalls([call('right', 'A', 1), call('wrong', null, 2, 'B')]).get('p')?.own, { address: 'A', atMs: 1 });
});

test('a stored coin id gives its address', () => {
  assert.equal(addressOfCoinId('chain:Abc123'), 'Abc123');
  assert.equal(addressOfCoinId('Abc123'), 'Abc123');
  assert.equal(addressOfCoinId(null), null);
  assert.equal(addressOfCoinId(''), null);
});
