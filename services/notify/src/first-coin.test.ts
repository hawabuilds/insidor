/**
 * A starred narrative's first coin: only a settled coin counts, a narrative is told about once
 * ever, the unstarred ones are remembered too (so starring one later never says "first coin"), and
 * a pass tells at most its bound, leaving the rest for the next.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { firstCoins, settledCoin, type NarrativeCoin } from './first-coin.ts';
import { alertText } from './text.ts';

const coin = { address: 'Pan1111111111111111111111111111111111pump', ticker: 'PANCAKE' };

test('★ only one or several is a coin: none, pending, unsure and a top coin are not', () => {
  assert.deepEqual(settledCoin({ kind: 'one', coin }), coin);
  assert.deepEqual(settledCoin(JSON.stringify({ kind: 'several', coins: [coin, { address: 'b', ticker: 'B' }] })), coin);
  for (const raw of [{ kind: 'none' }, { kind: 'pending' }, { kind: 'unsure', claimCount: 4 }, null, { kind: 'one' }]) assert.equal(settledCoin(raw), null);
});

const n = (storyId: string, has: boolean): NarrativeCoin => ({ storyId, title: storyId, coin: has ? coin : null });

test('★ a starred narrative new to a coin is due; an unstarred one is remembered and not told; a seen one is neither', () => {
  const r = firstCoins([n('starred', true), n('other', true), n('seen', true), n('bare', false)], new Set(['seen']), new Set(['starred', 'seen', 'bare']), 20);
  assert.deepEqual(r.due.map((d) => d.storyId), ['starred']);
  assert.deepEqual(r.keys, ['starred', 'other']);
});

test('past the bound the starred ones wait, unremembered, for the next pass', () => {
  const rows = ['a', 'b', 'c'].map((id) => n(id, true));
  const r = firstCoins(rows, new Set(), new Set(['a', 'b', 'c']), 2);
  assert.deepEqual(r.due.map((d) => d.storyId), ['a', 'b']);
  assert.deepEqual(r.keys, ['a', 'b']);
  assert.deepEqual(firstCoins(rows, new Set(r.keys), new Set(['a', 'b', 'c']), 2).due.map((d) => d.storyId), ['c']);
});

test('the words: the narrative and its coin, the cap only when known', () => {
  assert.deepEqual(alertText('starred_first_coin', { title: 'Pancake the cat', symbol: 'PANCAKE', mcUsd: 12_000 }), { title: 'Pancake the cat has its first coin: $PANCAKE', body: '$12K MC. A narrative you starred.' });
  assert.deepEqual(alertText('starred_first_coin', { title: 'Pancake the cat', symbol: 'PANCAKE', mcUsd: null }), { title: 'Pancake the cat has its first coin: $PANCAKE', body: 'A narrative you starred.' });
});
