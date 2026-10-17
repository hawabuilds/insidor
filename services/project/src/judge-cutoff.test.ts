/** Each stored answer is held to the cutoff of the model that gave it: its policy number, the block's once tuned on it, the block's for every other judge. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { postScoreReason } from '@insidor/core';

import { answerPolicies, onePolicy, policyForAnswer } from './judge-cutoff.ts';

const answer = { coinable: true, confidence: 0.8, lookedAt: 'text' as const, proposedName: 'CAT' };
const MAIN = 'judge:anthropic/claude-haiku-4-5@abc';
const GEMMA = 'judge:openrouter/google/gemma-3-27b-it@abc';
const NEMOTRON = 'judge:together/nvidia/NVIDIA-Nemotron-3.5-Super-VL@abc';
const policy = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, cutoffs: { primary: 0.7, fallback: 0.9 } } };

test('each open model is held to its own number while the block was chosen on neither', () => {
  const p = answerPolicies(policy, { cutoff: 0.9, chosenOn: null });
  assert.equal(postScoreReason(answer, policyForAnswer(NEMOTRON, p)), 'passes');
  assert.equal(postScoreReason(answer, policyForAnswer(`${NEMOTRON.replace('@', '+text-only@')}`, p)), 'passes');
  assert.equal(postScoreReason(answer, policyForAnswer(GEMMA, p)), 'judge_unsure');
  /* The main judge, rules, copies and unknown ids: the block's. */
  assert.equal(postScoreReason(answer, policyForAnswer(MAIN, p)), 'judge_unsure');
  assert.equal(policyForAnswer('rule:not-meme-match@0.67', p), p.main);
  assert.equal(policyForAnswer(null, p), p.main);
});

test('a block tuned on the primary holds the primary to its cutoff and leaves the fallback at its own', () => {
  const p = answerPolicies(policy, { cutoff: 0.85, chosenOn: 'judge:together/nvidia/NVIDIA-Nemotron-3.5-Super-VL' });
  assert.equal(postScoreReason(answer, policyForAnswer(NEMOTRON, p)), 'judge_unsure');
  assert.equal(postScoreReason({ ...answer, confidence: 0.88 }, policyForAnswer(NEMOTRON, p)), 'passes');
  assert.equal(postScoreReason({ ...answer, confidence: 0.88 }, policyForAnswer(GEMMA, p)), 'judge_unsure');
});

test('a model with no number of its own is held to the block, and one policy holds everything', () => {
  const p = answerPolicies({ ...policy, judge: { ...policy.judge, cutoffs: { primary: null, fallback: null } } }, { cutoff: 0.82, chosenOn: null });
  assert.equal(postScoreReason(answer, policyForAnswer(NEMOTRON, p)), 'judge_unsure');
  assert.equal(policyForAnswer(GEMMA, p), policyForAnswer(MAIN, p));
  const one = onePolicy(DEFAULT_POLICY);
  assert.equal(policyForAnswer(NEMOTRON, one), DEFAULT_POLICY);
});
