/** The per-post bar: 0.70 on text, 0.75 with a video frame, and no score means wait. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Judgement } from '@insidor/contracts/judgement.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { couldPassWithBoost, postScore, postScoreReason } from './post-score.ts';

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

test('★ the name test: a "yes" naming a headline in five words is below, however confident', () => {
  assert.equal(postScore(judged({ confidence: 0.75, proposedName: 'Kacey Musgraves dog shot response' }), DEFAULT_POLICY), 'below');
  assert.equal(postScore(judged({ confidence: 0.75, proposedName: 'WILLIAM CONTRERAS' }), DEFAULT_POLICY), 'passes');
  assert.equal(postScore(judged({ proposedName: 'J-HOPE' }), DEFAULT_POLICY), 'passes');
  assert.equal(postScore(judged({ proposedName: null }), DEFAULT_POLICY), 'below');
});

test('the reason names which check a post failed, and agrees with the score', () => {
  assert.equal(postScoreReason(null, DEFAULT_POLICY), 'not_scored');
  assert.equal(postScoreReason(judged({ coinable: false }), DEFAULT_POLICY), 'not_memeable');
  assert.equal(postScoreReason(judged({ proposedName: 'Kacey Musgraves dog shot response' }), DEFAULT_POLICY), 'name_test');
  assert.equal(postScoreReason(judged({ confidence: 0.5 }), DEFAULT_POLICY), 'judge_unsure');
  assert.equal(postScoreReason(judged({}), DEFAULT_POLICY), 'passes');
});

test('★ the picture boost lifts only a "yes" just under its bar, with a picture like a coined post', () => {
  const bar = DEFAULT_POLICY.qualify.minJudgeConfidence.text;
  const margin = DEFAULT_POLICY.rising.boostBarMargin;
  const near = judged({ confidence: bar - margin });
  assert.equal(postScore(near, DEFAULT_POLICY, 0.5), 'passes');
  assert.equal(postScore(near, DEFAULT_POLICY, 0.3), 'below', 'not alike enough');
  assert.equal(postScore(near, DEFAULT_POLICY, null), 'below', 'never compared is not alike');
  assert.equal(postScore(judged({ confidence: bar - margin - 0.05 }), DEFAULT_POLICY, 0.99), 'below', 'too far under the bar');
  assert.equal(postScore(judged({ confidence: bar - margin, proposedName: 'one two three four five' }), DEFAULT_POLICY, 0.99), 'below', 'the name test still holds');
});

test('★ a "no" is never lifted by the picture, however unsure or alike (the tiger-mauling post: a "no" at 0.3)', () => {
  const no = (confidence: number) => judged({ coinable: false, confidence, proposedName: null });
  for (const c of [0, 0.15, 0.3, 0.5, 0.9]) assert.equal(postScore(no(c), DEFAULT_POLICY, 0.99), 'below', `no at ${c}`);
});

test('★ a held kind fails whatever the picture, the confidence or the yes/no it was filed with — held means policy holds it', () => {
  /* The Goliath coaster death passed the first question as GOLIATH at 0.92. */
  const goliath = judged({ confidence: 0.92, proposedName: 'GOLIATH' });
  const all = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, heldKinds: ['TRAGEDY', 'AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'CORP_NEWS', 'MEDIA_NEWS'] } };
  for (const kind of ['TRAGEDY', 'AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'CORP_NEWS', 'MEDIA_NEWS', ' tragedy ']) {
    assert.equal(postScoreReason(goliath, all, 0.99, kind), 'not_memeable', kind);
  }
  const adsOnly = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, heldKinds: ['AD'] } };
  assert.equal(postScoreReason(goliath, adsOnly, 0.99, 'AD'), 'not_memeable');
  assert.equal(postScoreReason(goliath, adsOnly, null, 'TRAGEDY'), 'passes', 'a label policy does not hold holds nothing');
});

test('★ an OTHER kind answer (or an unknown label) holds nothing: the two stray rows of 2026-10-13', () => {
  const yes = judged({ confidence: 0.85, proposedName: 'CHILLGUY' });
  assert.equal(postScoreReason(yes, DEFAULT_POLICY, null, 'OTHER'), 'passes');
  assert.equal(postScoreReason(yes, DEFAULT_POLICY, null, 'NEWS'), 'passes');
  assert.equal(postScoreReason(yes, DEFAULT_POLICY, null, null), 'passes');
});

test('couldPassWithBoost: a pass or a "yes" near the bar; never a "no"', () => {
  const bar = DEFAULT_POLICY.qualify.minJudgeConfidence.text;
  assert.equal(couldPassWithBoost(judged({}), DEFAULT_POLICY), true);
  assert.equal(couldPassWithBoost(judged({ confidence: bar - DEFAULT_POLICY.rising.boostBarMargin }), DEFAULT_POLICY), true);
  assert.equal(couldPassWithBoost(judged({ confidence: 0.4 }), DEFAULT_POLICY), false);
  assert.equal(couldPassWithBoost(judged({ coinable: false, confidence: 0.15, proposedName: null }), DEFAULT_POLICY), false);
});
