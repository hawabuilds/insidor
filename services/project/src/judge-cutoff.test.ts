/** Each stored answer is held to the cutoff of the model that gave it: the block's for the main judge, the open model's own once tuned, the block's until then. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { postScoreReason } from '@insidor/core';

import { answerPolicies, policyForAnswer } from './judge-cutoff.ts';

const answer = { coinable: true, confidence: 0.8, lookedAt: 'text' as const, proposedName: 'CAT' };
const MAIN = 'judge:anthropic/claude-haiku-4-5@abc';
const OPEN = 'judge:openrouter/google/gemma-3-27b-it@abc';

test('the open model is held to its own cutoff and the main judge to the block\'s', () => {
  const p = answerPolicies({ ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, openCutoff: 0.85 } }, 0.71);
  assert.equal(postScoreReason(answer, policyForAnswer(MAIN, p.main, p.open)), 'passes');
  assert.equal(postScoreReason(answer, policyForAnswer(OPEN, p.main, p.open)), 'judge_unsure');
  /* Copies, rules and unknown ids are the main judge's. */
  assert.equal(policyForAnswer('rule:not-meme-match@0.67', p.main, p.open), p.main);
  assert.equal(policyForAnswer(null, p.main, p.open), p.main);
});

test('until the open model is tuned its answers are held to the block\'s cutoff', () => {
  const p = answerPolicies({ ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, openCutoff: null } }, 0.82);
  assert.equal(postScoreReason(answer, policyForAnswer(OPEN, p.main, p.open)), 'judge_unsure');
  assert.deepEqual(p.open.qualify.minJudgeConfidence, p.main.qualify.minJudgeConfidence);
});
