/**
 * The viral exception's route as the projector applies it (Policy.judge.viral): a "no", or a
 * politics or showbiz hold, passes with a moment answer and a passing kind; nothing else is lifted,
 * and the owner's Not a meme and a shill still win.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
/* The held kinds these cases were written against (policy.v196); v197 holds only SPORT, a choice of the policy's. */
const DEFAULT_POLICY = { ...LIVE_POLICY, judge: { ...LIVE_POLICY.judge, heldKinds: ['AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'NOT_MEME_MATCH'] } };

import { postRoute, type RisingRow } from './rising.ts';

/* @PopBase's post as the judge filed it on 2026-10-25: a plain "no" at 0.9, never asked its kind. */
const NO: RisingRow = {
  item_id: 'x:2114457821421109411', source: 'x', source_item_id: '2114457821421109411', posted_at: '2026-10-25T20:43:24Z', first_seen_at: '2026-10-25T20:46:46Z',
  body: 'Donald Trump says Nicki Minaj has a “beautiful a**” during rally in Port Huron, Michigan', media: [], handle: 'PopBase', display_name: null, source_author_id: 'a',
  coinable: false, confidence: 0.9, looked_at: 'text', proposed_name: null, picture_similarity: null, story_id: null, owner_call: null, kind_label: null,
};
const MOMENT = { moment: true, confidence: 0.85, name: 'BEAUTIFUL', kind: 'SHOWBIZ' };
const OFF = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, viral: { ...DEFAULT_POLICY.judge.viral, on: false } } };

test('★ a turned-down post with a moment and a passing kind passes by the viral route', () => {
  assert.deepEqual(postRoute({ ...NO, viral: MOMENT }), { why: 'passes', route: 'viral' });
  assert.equal(postRoute({ ...NO, coinable: true, kind_label: 'SHOWBIZ', viral: { ...MOMENT, kind: 'SHOWBIZ' } }, DEFAULT_POLICY).route, 'viral', 'a showbiz hold is lifted');
  assert.equal(postRoute({ ...NO, viral: { ...MOMENT, kind: 'OTHER' } }).route, 'viral');
  assert.equal(postRoute({ ...NO, viral: { ...MOMENT, kind: 'POLITICS' } }).route, null, 'politics never passes from policy.v202');
});

test('never asked, a "no" moment, a tragedy or company news: not passed', () => {
  assert.deepEqual(postRoute(NO), { why: 'not_memeable', route: null });
  assert.equal(postRoute({ ...NO, viral: { ...MOMENT, moment: false } }).route, null);
  assert.equal(postRoute({ ...NO, viral: { ...MOMENT, kind: 'TRAGEDY' } }).route, null);
  assert.equal(postRoute({ ...NO, viral: { ...MOMENT, kind: 'CORP_NEWS' } }).route, null);
  assert.equal(postRoute({ ...NO, viral: MOMENT }, OFF).route, null, 'off: the stored answer is not read');
});

test("★ the owner's Not a meme, a shill and every other held kind still hold", () => {
  assert.equal(postRoute({ ...NO, owner_call: 'not', viral: MOMENT }).why, 'owner_not_meme');
  assert.equal(postRoute({ ...NO, viral: MOMENT }, undefined, { others: false, shill: true }).route, null);
  for (const kind_label of ['AD', 'SPORT', 'FANDOM', 'NOT_MEME_MATCH']) assert.equal(postRoute({ ...NO, kind_label, viral: MOMENT }, DEFAULT_POLICY).route, null, kind_label);
});

test('a post the first route passes keeps its own route', () => {
  assert.equal(postRoute({ ...NO, coinable: true, confidence: 0.95, proposed_name: 'NICKI', viral: MOMENT }).route, 'judge');
});
