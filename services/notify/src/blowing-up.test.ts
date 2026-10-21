/**
 * The blowing-up pass's card read (blowing-up.ts `readRiserPosts`): For You's live cards are read as
 * ids and row versions every pass, and a card whole only when it is not held at its version, so a
 * rewritten card shows and an unchanged one does not cross the wire again. Against a fake `Db`
 * answering by statement text. Checked against the live store, read only: the same 1,405 cards,
 * ~1.7 KB each when read whole.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Db } from './deliver.ts';
import { readRiserPosts } from './blowing-up.ts';

test('a live card is read whole only when its row version changed', async () => {
  const cards = new Map([
    ['x:1', { v: '10', excerpt: 'one' }],
    ['x:2', { v: '11', excerpt: 'two' }],
  ]);
  const whole: string[][] = [];
  const db = {
    query: async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('from public.same_name_coin')) return [];
      if (sql.includes('f.xmin::text as v from public.feed_post f')) return [...cards].map(([itemId, c]) => ({ itemId, v: c.v }));
      if (sql.includes("f.payload ->> 'excerpt'")) {
        const ids = (params?.[0] ?? []) as string[];
        whole.push(ids);
        return ids.map((itemId) => ({ itemId, source: 'x', readings: [], postedMs: null, coins: [], author: null, excerpt: cards.get(itemId)?.excerpt ?? null, views: null, image: null, v: cards.get(itemId)?.v }));
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
  } as unknown as Db;
  const read = async () => (await readRiserPosts(db)).map((p) => `${p.itemId}:${p.excerpt}`);

  assert.deepEqual(await read(), ['x:1:one', 'x:2:two']);
  assert.deepEqual(whole, [['x:1', 'x:2']]);
  assert.deepEqual(await read(), ['x:1:one', 'x:2:two']);
  assert.equal(whole.length, 1, 'nothing rewritten, nothing read whole');
  cards.set('x:2', { v: '12', excerpt: 'two, rewritten' });
  cards.delete('x:1');
  assert.deepEqual(await read(), ['x:2:two, rewritten']);
  assert.deepEqual(whole[1], ['x:2']);
});
