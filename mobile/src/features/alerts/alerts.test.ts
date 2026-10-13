import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { badgeText, grouped, sectionOf } from './group.ts';
import { markOf } from './mark.ts';

test("the list is grouped as Trador groups it: Today, This week, Earlier", () => {
  const now = new Date(2026, 9, 12, 15).getTime();
  assert.equal(sectionOf(new Date(2026, 9, 12, 0, 1).getTime(), now), 'Today');
  assert.equal(sectionOf(new Date(2026, 9, 11, 23).getTime(), now), 'This week');
  assert.equal(sectionOf(new Date(2026, 9, 6, 1).getTime(), now), 'This week');
  assert.equal(sectionOf(new Date(2026, 9, 5, 23).getTime(), now), 'Earlier');
  const g = grouped([{ at: now }, { at: new Date(2026, 9, 1).getTime() }], now);
  assert.deepEqual(g.map((x) => x.section), ['Today', 'Earlier'], 'an empty section is not shown');
});

test('the bell shows nothing at zero and 9+ past nine', () => {
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(12), '9+');
});

test("the owner's supplier warning gets the dollar mark; coins, ranks and the rest keep theirs", () => {
  const ranks = ['intern', 'goat'];
  assert.deepEqual(markOf({ kind: 'supplier_warning', rank: null, symbol: null }, ranks), { kind: 'money', label: 'Supplier spend' });
  assert.deepEqual(markOf({ kind: 'retune_summary', rank: null, symbol: null }, ranks), { kind: 'learned', label: 'Learning from your calls' });
  assert.deepEqual(markOf({ kind: 'holding_multiple', rank: null, symbol: 'FERRY' }, ranks), { kind: 'coin', letter: 'F' });
  assert.deepEqual(markOf({ kind: 'rank_up', rank: 'goat', symbol: null }, ranks), { kind: 'rank', rank: 'goat' });
  assert.deepEqual(markOf({ kind: 'rising_post', rank: null, symbol: null }, ranks), { kind: 'bell' });
});
