/**
 * A search lane's own daily cap: the next ask fits or it does not, and new posts carry their judging.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { laneJudgeUsd, laneMayAsk, paceBetweenPages, pacedDailyUsd, rereadAllowanceUsd, searchDayAllowanceUsd, searchDayMayAsk, searchDayMayFinish, searchDayStart } from './lane-cap.ts';

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

const DAY = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, searchDay: { on: true, dailyUsd: 7.2, aheadMs: 3_600_000, countFromMs: null, rereadDailyUsd: 2.4 } } };
const MIDNIGHT = Date.parse('2026-10-19T00:00:00Z');

test('★ the X search day is paced over the UTC day, an hour ahead, and never more than the day', () => {
  assert.equal(searchDayAllowanceUsd(MIDNIGHT, DAY), 0.3, 'an hour of the day is there at midnight');
  assert.equal(searchDayAllowanceUsd(MIDNIGHT + 11 * 3_600_000, DAY), 3.6, 'half the day by 11:00, with the hour ahead');
  assert.equal(searchDayAllowanceUsd(MIDNIGHT + 23.5 * 3_600_000, DAY), 7.2, 'the last hour is capped at the day');
  assert.equal(searchDayMayAsk(3.5, 0.1, MIDNIGHT + 11 * 3_600_000, DAY), true);
  assert.equal(searchDayMayAsk(3.55, 0.1, MIDNIGHT + 11 * 3_600_000, DAY), false, 'spent plus the quote, against the pace');
  assert.equal(searchDayMayAsk(Number.NaN, 0.1, MIDNIGHT, DAY), false, 'an unreadable day asks nothing');
});

test("re-reads take their own share of the X day, on the same pace", () => {
  assert.ok(Math.abs(rereadAllowanceUsd(MIDNIGHT, DAY) - 0.1) < 1e-9, 'an hour of the re-read day at midnight');
  assert.equal(rereadAllowanceUsd(MIDNIGHT + 23.5 * 3_600_000, DAY), 2.4, 'never more than the day');
});

test('the X search day off allows every ask', () => {
  const off = { ...DAY, feed: { ...DAY.feed, searchDay: { ...DAY.feed.searchDay, on: false } } };
  assert.equal(searchDayMayAsk(1_000, 1, MIDNIGHT, off), true);
});

test("the day's bill starts at countFrom on its own UTC day, at the normal pace from there, and at 00:00 on any other day", () => {
  const from = Date.UTC(2026, 9, 19, 12, 30);
  const P = { ...DAY, feed: { ...DAY.feed, searchDay: { ...DAY.feed.searchDay, aheadMs: 0, countFromMs: from } } };
  assert.equal(searchDayStart(from + 3_600_000, P), from);
  assert.equal(searchDayAllowanceUsd(from + 3_600_000, P), 7.2 / 24);
  assert.equal(searchDayStart(Date.UTC(2026, 9, 20, 6), P), Date.UTC(2026, 9, 20));
  assert.equal(searchDayStart(Date.UTC(2026, 9, 19, 9), P), Date.UTC(2026, 9, 19));
});

test('★ a paced search may spend its day only as the UTC day goes, half an hour ahead, never past the day', () => {
  const day = Date.UTC(2026, 9, 24);
  const ahead = DEFAULT_POLICY.feed.searchDay.aheadMs;
  /* 14:40 UTC: where the unpaced band had spent all $1.55 on 23 Oct, a paced one has about 60%. */
  const at1440 = pacedDailyUsd(1.55, day + (14 * 60 + 40) * 60_000, DEFAULT_POLICY);
  assert.ok(Math.abs(at1440 - 1.55 * (((14 * 60 + 40) * 60_000 + ahead) / 86_400_000)) < 1e-9);
  assert.ok(at1440 < 1.0);
  /* Midnight: the ahead share only, so the first ask of the day is not refused. */
  assert.ok(pacedDailyUsd(1.55, day, DEFAULT_POLICY) > 0);
  /* The last minute of the day: the whole day, never more. */
  assert.equal(pacedDailyUsd(1.55, day + 86_399_000, DEFAULT_POLICY), 1.55);
});

test('★ inside an ask the X day is held to its hard total, not its pace (policy.v185 `paceBeforeAskOnly`)', () => {
  const day = DEFAULT_POLICY.feed.searchDay.dailyUsd;
  assert.equal(paceBetweenPages(DEFAULT_POLICY), false, 'as shipped, the pace only starts an ask');
  assert.equal(paceBetweenPages({ ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, paging: { ...DEFAULT_POLICY.feed.paging, paceBeforeAskOnly: false } } }), true);
  assert.equal(searchDayMayFinish(day - 0.003, 0.003, DEFAULT_POLICY), true, 'landing on the total is allowed');
  assert.equal(searchDayMayFinish(day - 0.002, 0.003, DEFAULT_POLICY), false, 'never over it');
  assert.equal(searchDayMayFinish(Number.NaN, 0.003, DEFAULT_POLICY), false, 'an unreadable bill asks nothing');
  const off = { ...DEFAULT_POLICY, feed: { ...DEFAULT_POLICY.feed, searchDay: { ...DEFAULT_POLICY.feed.searchDay, on: false } } };
  assert.equal(searchDayMayFinish(1_000, 1, off), true);
});
