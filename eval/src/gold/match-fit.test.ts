/**
 * The refit gate (match-fit.ts `refitRefusal`): a refit with fewer right coins, or more likely
 * coins named wrongly, on the gold set or on the owner's labels, is never kept. Its own file
 * because the gate is what stops a worse ranking reaching the feed twice a day unattended.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { refitRefusal, rightAnswers, type FitTally } from './match-fit.ts';

const T = (o: Partial<FitTally> = {}): FitTally => ({ provenRight: 0, provenWrong: 0, likelyRight: 0, likelyWrong: 0, missed: 0, clear: 0, ...o });

test('right answers are proven right, likely right and clear', () => {
  assert.equal(rightAnswers(T({ provenRight: 2, likelyRight: 1, clear: 13, missed: 15, provenWrong: 1 })), 16);
});

test('★ the 2026-10-14 06:54 refit is refused: it lost one likely-right coin on the owner labels', () => {
  /* The scores recorded in internal.coin_match_fit for that row. */
  const gold = T({ provenRight: 7, clear: 1, missed: 15 });
  const before = { gold, owner: T({ provenRight: 2, provenWrong: 1, likelyRight: 1, missed: 14, clear: 13 }) };
  const after = { gold, owner: T({ provenRight: 2, provenWrong: 1, likelyRight: 0, missed: 15, clear: 13 }) };
  const why = refitRefusal(before, after);
  assert.ok(why !== null);
  assert.match(why, /fewer right coins on the owner's labels \(16 to 15\)/);
});

test('a loss on gold is refused even when the owner labels gain', () => {
  const before = { gold: T({ provenRight: 7, likelyRight: 2 }), owner: T({ likelyRight: 1 }) };
  const after = { gold: T({ provenRight: 7, likelyRight: 1 }), owner: T({ likelyRight: 3 }) };
  assert.match(refitRefusal(before, after) ?? '', /fewer right coins on gold/);
});

test('more likely-wrong coins is still refused, with no loss of right ones', () => {
  const before = { gold: T({ likelyRight: 2 }), owner: T() };
  const after = { gold: T({ likelyRight: 2, likelyWrong: 1 }), owner: T() };
  assert.match(refitRefusal(before, after) ?? '', /more likely coins named wrongly on gold/);
});

test('a refit as good or better on both is kept', () => {
  const before = { gold: T({ provenRight: 7, missed: 3 }), owner: T({ likelyRight: 1, clear: 13 }) };
  assert.equal(refitRefusal(before, before), null);
  assert.equal(refitRefusal(before, { gold: T({ provenRight: 7, likelyRight: 1, missed: 2 }), owner: T({ likelyRight: 2, clear: 13 }) }), null);
});
