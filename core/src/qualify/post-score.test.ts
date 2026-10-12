/** The per-post bar: 0.70 on text, 0.75 with a video frame, and no score means wait. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Judgement } from '@insidor/contracts/judgement.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { postScore } from './post-score.ts';

const judged = (over: Partial<Judgement>): Judgement => ({
  judgeId: 'judge:test@1',
  promptId: 'p@1',
  judgedAt: 0,
  coinable: true,
  confidence: 0.7,
  lookedAt: 'text',
  proposedName: 'small hippo',
  alternateNames: [],
  subjectSpans: [],
  rationaleRef: null,
  costUsd: 0,
  ...over,
});

test('★ a missing score waits; it never passes and is never a failure', () => {
  assert.equal(postScore(null, DEFAULT_POLICY), 'waiting');
});

test('text passes at 0.70 and not below', () => {
  assert.equal(postScore(judged({ confidence: 0.7 }), DEFAULT_POLICY), 'passes');
  assert.equal(postScore(judged({ confidence: 0.69 }), DEFAULT_POLICY), 'below');
});

test('a judgement made with a video frame needs 0.75', () => {
  assert.equal(postScore(judged({ confidence: 0.72, lookedAt: 'videoFrame' }), DEFAULT_POLICY), 'below');
  assert.equal(postScore(judged({ confidence: 0.75, lookedAt: 'videoFrame' }), DEFAULT_POLICY), 'passes');
});

test('not coinable is below the bar however confident', () => {
  assert.equal(postScore(judged({ coinable: false, confidence: 0.99 }), DEFAULT_POLICY), 'below');
});
