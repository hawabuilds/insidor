import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { badgeText, grouped, sectionOf } from './group.ts';

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
