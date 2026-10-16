/**
 * The learning book's split (Policy.budget.learningLines): the re-tune's reserve is taken first,
 * and tests have their own small day inside what is left. Pure arithmetic on the policy, tested
 * here because tools/lib/shared-meter.ts and the runner's missed-post work both read it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { learningDailyCapUsd, testsLineUsd } from './vendor-lines.ts';

const withLines = (l: Partial<Policy['budget']['learningLines']>): Policy => ({
  ...DEFAULT_POLICY,
  budget: { ...DEFAULT_POLICY.budget, learningLines: { ...DEFAULT_POLICY.budget.learningLines, ...l } },
});

test('★ the re-tune may spend the whole learning day; nothing else may spend its reserve', () => {
  const p = withLines({ dailyUsd: 8.5, retuneReserveUsd: 2 });
  assert.equal(learningDailyCapUsd(p, 'retune'), 8.5);
  assert.equal(learningDailyCapUsd(p, 'work'), 6.5);
  assert.equal(learningDailyCapUsd(p, 'test'), 6.5);
});

test("★ tests and experiments have their own day, all vendors together, never past the reserve", () => {
  assert.equal(testsLineUsd(withLines({ dailyUsd: 8.5, retuneReserveUsd: 2, testsUsd: 1 })), 1);
  /* A reserve that leaves less than the tests' line: the reserve wins. */
  assert.equal(testsLineUsd(withLines({ dailyUsd: 2.5, retuneReserveUsd: 2, testsUsd: 1 })), 0.5);
  assert.equal(learningDailyCapUsd(withLines({ dailyUsd: 1, retuneReserveUsd: 2 }), 'test'), 0, 'never below zero');
});

test('the policy as shipped keeps a reserve and a tests line inside the learning day', () => {
  const l = DEFAULT_POLICY.budget.learningLines;
  assert.ok(l.retuneReserveUsd > 0 && l.testsUsd > 0);
  assert.ok(l.retuneReserveUsd + l.testsUsd <= l.dailyUsd);
});
