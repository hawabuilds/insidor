/**
 * The judge's output is evidence, and evidence that did not arrive must not
 * become evidence that says no. That distinction is what these tests hold.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storyId } from '@insidor/contracts/ids.ts';
import type { JudgeSubject } from '@insidor/contracts/ports/judge.ts';

import { PROMPTS, PROMPT_SET_SHA } from './prompts.ts';
import { allUnavailable, toJudgement, toOutcomes } from './to-judgement.ts';
import { RATES, usdOf } from './index.ts';

const AT = 1_800_000_000_000;
const CTX = { judgeId: 'judge:test@0', promptId: 'coinability@0', judgedAt: AT, costUsdPerSubject: 0.001 };

const subject = (token: string): JudgeSubject => ({
  storyId: storyId(token),
  texts: ['the chill guy just standing there'],
  media: [],
  distinctAuthors: 4,
  distinctSources: 2,
});

test('a malformed answer is an absent judgement, never a negative one', () => {
  assert.equal(toJudgement({}, CTX), null);
  assert.equal(toJudgement(null, CTX), null);
  assert.equal(toJudgement({ coinable: 'maybe' }, CTX), null);
});

test('a well-formed answer carries the name and the confidence through', () => {
  const j = toJudgement({ coinable: true, proposedName: '  chill guy  ', confidence: 0.82 }, CTX);
  assert.ok(j);
  assert.equal(j.coinable, true);
  assert.equal(j.proposedName, 'chill guy');
  assert.equal(j.confidence, 0.82);
  assert.equal(j.judgedAt, AT);
  assert.equal(j.judgeId, CTX.judgeId);
  assert.equal(j.promptId, CTX.promptId);
  assert.equal(j.costUsd, 0.001);
});

test('the judge prose is never inlined — only a blob key, or nothing', () => {
  const j = toJudgement({ coinable: true, rationale: 'a long paragraph of reasoning' }, CTX);
  assert.ok(j);
  assert.equal(j.rationaleRef, null);
  assert.equal(JSON.stringify(j).includes('long paragraph'), false);
});

test('a confidence outside the scale is clamped, not trusted', () => {
  assert.equal(toJudgement({ coinable: true, confidence: 1.7 }, CTX)?.confidence, 1);
  assert.equal(toJudgement({ coinable: true, confidence: -3 }, CTX)?.confidence, 0);
  assert.equal(toJudgement({ coinable: true }, CTX)?.confidence, 0);
});

test('a coinable-false answer is a real judgement, distinct from a missing one', () => {
  const j = toJudgement({ coinable: false, proposedName: null, confidence: 0.9 }, CTX);
  assert.ok(j, 'a negative answer is still an answer');
  assert.equal(j.coinable, false);
  assert.equal(j.proposedName, null);
});

test('every subject asked about gets an outcome, and an unanswered one is unavailable', () => {
  const subjects = [subject('aaa'), subject('bbb'), subject('ccc')];
  const outcomes = toOutcomes(
    subjects,
    [
      { storyId: String(subjects[0]?.storyId), coinable: true, proposedName: 'chill guy', confidence: 0.8 },
      { storyId: String(subjects[1]?.storyId) }, // malformed — absent, not negative
    ],
    CTX,
  );

  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0]?.kind, 'judged');
  assert.equal(outcomes[1]?.kind, 'unavailable');
  assert.equal(outcomes[2]?.kind, 'unavailable');
});

test('a failed call makes every subject unavailable, never not-coinable', () => {
  const outcomes = allUnavailable([subject('aaa'), subject('bbb')], 'vendor timed out');
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((o) => o.kind === 'unavailable'));
});

test('prompts load from files and hash to a stable set id', () => {
  assert.ok(PROMPTS.system.text.length > 0);
  assert.ok(PROMPTS['coinability-core'].text.includes('IS THERE ONE SUBJECT?'));
  assert.match(PROMPT_SET_SHA, /^[0-9a-f]{8}$/);
  assert.notEqual(PROMPTS.system.sha, PROMPTS['coinability-core'].sha);
});

test('cost comes from token counts, not from an average', () => {
  assert.equal(usdOf({ inputTokens: 1_000_000, outputTokens: 0 }), RATES.usdPerMillionInput);
  assert.equal(usdOf({ inputTokens: 0, outputTokens: 1_000_000 }), RATES.usdPerMillionOutput);
  assert.equal(usdOf({ inputTokens: 0, outputTokens: 0 }), 0);
});
