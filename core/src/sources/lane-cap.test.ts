/**
 * A search lane's own daily cap: the next ask fits or it does not, and new posts carry their judging.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { laneJudgeUsd, laneMayAsk, searchDayAllowanceUsd, searchDayMayAsk } from './lane-cap.ts';

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

const DAY = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, searchDay: { on: true, dailyUsd: 7.2, aheadMs: 3_600_000 } } };
const MIDNIGHT = Date.parse('2026-10-19T00:00:00Z');

test('★ the X search day is paced over the UTC day, an hour ahead, and never more than the day', () => {
  assert.equal(searchDayAllowanceUsd(MIDNIGHT, DAY), 0.3, 'an hour of the day is there at midnight');
  assert.equal(searchDayAllowanceUsd(MIDNIGHT + 11 * 3_600_000, DAY), 3.6, 'half the day by 11:00, with the hour ahead');
  assert.equal(searchDayAllowanceUsd(MIDNIGHT + 23.5 * 3_600_000, DAY), 7.2, 'the last hour is capped at the day');
  assert.equal(searchDayMayAsk(3.5, 0.1, MIDNIGHT + 11 * 3_600_000, DAY), true);
  assert.equal(searchDayMayAsk(3.55, 0.1, MIDNIGHT + 11 * 3_600_000, DAY), false, 'spent plus the quote, against the pace');
  assert.equal(searchDayMayAsk(Number.NaN, 0.1, MIDNIGHT, DAY), false, 'an unreadable day asks nothing');
});

test('the X search day off allows every ask', () => {
  const off = { ...DAY, feed: { ...DAY.feed, searchDay: { ...DAY.feed.searchDay, on: false } } };
  assert.equal(searchDayMayAsk(1_000, 1, MIDNIGHT, off), true);
});
