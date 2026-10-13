/**
 * The trades list's filter and its arrivals: buys, sells and your own trades kept by fact, and a
 * row marked new only when it appears after the first read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MarketTrade } from '../../shared/api/index.ts';
import { arrivals, emptyLine, filterTape, filtersFor, shortWallet, tradeKey, tradeUsd } from './trades-view.ts';

const t = (tx: string, side: 'buy' | 'sell', maker: string | null): MarketTrade => ({
  tx, side, maker,
  tokenAmount: { known: true, amount: 10 },
  usd: { known: true, amount: 1 },
  priceUsd: { known: true, amount: 0.1 },
  at: { known: true, at: 5 as never },
});

const TAPE = [t('a', 'buy', 'me'), t('b', 'sell', 'you'), t('c', 'sell', 'me')];

test('★ buys, sells and mine keep exactly those trades', () => {
  assert.deepEqual(filterTape(TAPE, 'buys', null).map((x) => x.tx), ['a']);
  assert.deepEqual(filterTape(TAPE, 'sells', null).map((x) => x.tx), ['b', 'c']);
  assert.deepEqual(filterTape(TAPE, 'mine', 'me').map((x) => x.tx), ['a', 'c']);
  assert.deepEqual(filterTape(TAPE, 'mine', null), [], 'mine with no wallet matches nothing');
});

test('Mine is offered only to a signed-in wallet, and every empty filter says why in words', () => {
  assert.deepEqual(filtersFor(null).map((f) => f.value), ['all', 'buys', 'sells']);
  assert.deepEqual(filtersFor('me').map((f) => f.value), ['all', 'buys', 'sells', 'mine']);
  assert.match(emptyLine('mine', 'JIM'), /JIM/);
});

test('★ the first read marks nothing new; a later read marks only what arrived', () => {
  const first = arrivals(null, TAPE.map(tradeKey));
  assert.equal(first.fresh.size, 0);
  const next = arrivals(first.seen, [tradeKey(t('d', 'buy', null)), ...TAPE.map(tradeKey)]);
  assert.deepEqual([...next.fresh], ['d:buy']);
});

test('a row says its dollars to the cent under $1,000 and its wallet by both ends; a missing amount is never $0', () => {
  assert.deepEqual(tradeUsd({ known: true, amount: 2.1 }), { kind: 'value', text: '$2.10' });
  assert.deepEqual(tradeUsd({ known: true, amount: 4_300 }), { kind: 'value', text: '$4.3K' });
  assert.deepEqual(tradeUsd({ known: true, amount: 0.004 }), { kind: 'value', text: '<$0.01' });
  assert.equal(tradeUsd({ known: false, pending: 'not_reported' }).kind, 'pending');
  assert.equal(shortWallet('3rpfQ8aZk1mN2pXyMDA'), '3rpf...yMDA');
  assert.equal(shortWallet('short'), 'short');
});
