/**
 * A search lane's own daily cap: the next ask fits or it does not, and new posts carry their judging.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { laneJudgeUsd, laneMayAsk } from './lane-cap.ts';

const CAP = { dailyUsd: 6, judgeUsdPerPost: 0.002, judgedShare: 0.5 };

test('★ an ask fits only when spent plus its quote stays at or under the cap', () => {
  assert.equal(laneMayAsk(5.9, 0.1, CAP), true, 'landing exactly on the cap is allowed');
  assert.equal(laneMayAsk(5.95, 0.1, CAP), false, 'checked on spent plus the quote, not on spent alone');
  assert.equal(laneMayAsk(6.5, 0, CAP), false, 'a day already over its cap asks nothing more');
});

test('an unreadable number refuses the ask', () => {
  assert.equal(laneMayAsk(Number.NaN, 0.1, CAP), false);
  assert.equal(laneMayAsk(0, Number.POSITIVE_INFINITY, CAP), false);
});

test('new posts are charged their judging: count times price times the share the judge is asked about', () => {
  assert.equal(laneJudgeUsd(100, CAP), 0.1);
  assert.equal(laneJudgeUsd(0, CAP), 0);
  assert.equal(laneJudgeUsd(-3, CAP), 0);
});
