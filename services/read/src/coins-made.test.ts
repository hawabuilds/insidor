/**
 * The Narratives card's "See N coins" count (coins-made.ts): the sheet's set, the phone's rule.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { COIN_LEAD_MS, COINS_MADE_SQL, coinsMade, coinsMadeOf } from './coins-made.ts';
import { MEMBERS_MAX, STORY_COINS_MAX } from './story-sheet.ts';

const FIRST = Date.parse('2026-10-23T09:14:35Z');
const MIN = 60_000;

test('★ only coins launched no earlier than the lead before the oldest post count; an unknown launch does not', () => {
  const r = {
    first_posted: FIRST,
    coins: [
      { a: 'after', at: FIRST + 3 * 60 * MIN },
      { a: 'as-it-went-up', at: FIRST - 9 * MIN },
      { a: 'old', at: FIRST - 11 * MIN },
      { a: 'days-old', at: FIRST - 3 * 24 * 60 * MIN },
      { a: 'unknown', at: null },
    ],
  };
  assert.equal(coinsMadeOf(r), 2);
});

test('a coin listed twice (link, beside it, a post) is one coin', () => {
  assert.equal(coinsMadeOf({ first_posted: FIRST, coins: [{ a: 'x', at: FIRST }, { a: 'x', at: FIRST }, { a: 'y', at: FIRST }] }), 2);
});

test('the proven coin always counts, with the link\'s own launch when the index has none; no oldest post: only it', () => {
  assert.equal(coinsMadeOf({ first_posted: FIRST, proven: 'p', proven_at: FIRST - 100 * MIN, coins: [{ a: 'p', at: null }, { a: 'q', at: FIRST }] }), 2);
  assert.equal(coinsMadeOf({ first_posted: null, proven: 'p', coins: [{ a: 'p', at: null }, { a: 'q', at: FIRST }] }), 1);
  assert.equal(coinsMadeOf({ first_posted: null, coins: [{ a: 'q', at: FIRST }] }), 0);
  assert.equal(coinsMadeOf({ first_posted: FIRST, coins: null }), 0);
});

test('only the first STORY_COINS_MAX coins in the sheet\'s order are counted, as the sheet lists only those', () => {
  const coins = [
    ...Array.from({ length: STORY_COINS_MAX }, (_, i) => ({ a: `old${i}`, at: FIRST - 60 * MIN })),
    { a: 'late-but-cut', at: FIRST + MIN },
  ];
  assert.equal(coinsMadeOf({ first_posted: FIRST, coins }), 0);
});

test('one statement for the page\'s ids, bounded as the sheet is; no ids, no statement; an unanswered narrative has no count', async () => {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: readonly unknown[]) => {
      calls.push({ sql, params });
      return [{ story_id: 'a', first_posted: FIRST, coins: [{ a: 'c', at: FIRST }] }];
    },
  };
  const m = await coinsMade(db, ['a', 'b']);
  assert.equal(m.get('a'), 1);
  assert.equal(m.has('b'), false, 'never a 0 for a narrative the statement did not answer for');
  assert.deepEqual(calls, [{ sql: COINS_MADE_SQL, params: [['a', 'b'], MEMBERS_MAX] }]);
  assert.equal((await coinsMade(db, [])).size, 0);
  assert.equal(calls.length, 1);
});

test('the lead is the phone\'s (mobile/src/shared/coins-made.ts), so the button and the pop-up count alike', () => {
  const phone = readFileSync(new URL('../../../mobile/src/shared/coins-made.ts', import.meta.url), 'utf8');
  const m = /export const COIN_LEAD_MS = (\d+) \* 60_000;/.exec(phone);
  assert.ok(m !== null, 'the phone still says its lead in minutes');
  assert.equal(Number(m[1]) * 60_000, COIN_LEAD_MS);
});
