/**
 * A starred narrative's first coin: only a settled coin counts, a narrative is told about once
 * ever, the unstarred ones are remembered too (so starring one later never says "first coin"), and
 * a pass tells at most its bound, leaving the rest for the next.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { firstCoins, pageCoins, settledCoin, type NarrativeCoin } from './first-coin.ts';
import type { Db } from './deliver.ts';
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

test('each page\'s title and coins are read only when their digest changed', async () => {
  const pages = new Map([
    ['s1', { v: 'a', title: 'Moo Deng', coins: { kind: 'one', coin: { address: 'A1', ticker: 'MOO' } } }],
    ['s2', { v: 'b', title: 'Chill guy', coins: { kind: 'none' } }],
  ]);
  const read: string[][] = [];
  const db: Db = {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (!sql.includes('any($1::text[])')) {
        assert.ok(!sql.includes("-> 'coins' as coins"));
        return [...pages].map(([storyId, p]) => ({ storyId, v: p.v })) as R[];
      }
      const ids = (params?.[0] ?? []) as string[];
      read.push(ids);
      return ids.flatMap((storyId) => { const p = pages.get(storyId); return p === undefined ? [] : [{ storyId, ...p }]; }) as R[];
    },
  };
  const titles = async () => (await pageCoins(db)).map((p) => [p.storyId, p.title]);
  assert.deepEqual(await titles(), [['s1', 'Moo Deng'], ['s2', 'Chill guy']]);
  assert.deepEqual(await titles(), [['s1', 'Moo Deng'], ['s2', 'Chill guy']]);
  assert.deepEqual(read, [['s1', 's2']]);
  pages.set('s2', { v: 'c', title: 'Chill guy', coins: { kind: 'one', coin: { address: 'C1', ticker: 'CHILL' } } });
  const now = await pageCoins(db);
  assert.deepEqual(settledCoin(now[1]?.coins), { address: 'C1', ticker: 'CHILL' });
  assert.deepEqual(read, [['s1', 's2'], ['s2']]);
});
