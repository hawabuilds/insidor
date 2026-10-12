/**
 * The origin eval's scoring, on hand-made evidence: a matched post that is the founders'
 * origin is right; one that is not is wrongly linked; an origin named where there was none is
 * wrongly called viral; and a coin missing a stage is incomplete, never a miss.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { CoinEvidence } from './coin-evidence.ts';
import type { GoldCoin } from './coin-origins.ts';
import { evaluateCoin, pictureTier } from './origin-eval.ts';

const P = DEFAULT_POLICY;
const LAUNCH = '2026-07-01T12:00:00.000Z';
const H = 3_600_000;
const before = Date.parse(LAUNCH) - 2 * H;

const coin = (origin: GoldCoin['origin']): GoldCoin => ({
  id: 'bt3:1', sheet: 'backtest3', rowId: 1, mint: 'Mint', ticker: 'TROUT', name: 'Big Trout', description: null,
  createdAt: LAUNCH, createdAtSheet: null, creatorLink: null, origin, features: {}, labelledBy: 'test', labelledOn: '2026-10-12', split: 'tune',
});
const result = (postId: string, text = 'big trout spotted') => ({ postId, url: `https://x.com/i/status/${postId}`, postedAt: before, text, authorHandle: null, authorFollowers: null, reach: null, imageUri: 'img', quotes: null });
const evidence = (similarity: number): CoinEvidence => ({
  id: 'bt3:1', meta: { name: 'Big Trout', ticker: 'TROUT', imageUri: 'coin' }, creator: { kind: 'none' },
  search: { term: 'Big Trout', results: [result('11')] }, similarity: { '11': similarity },
});
const xPost = (postId: string): GoldCoin['origin'] => ({ kind: 'post', platform: 'x', url: `https://x.com/a/status/${postId}`, postId });

test('★ the founders\' post, matched on picture plus name plus timing, is right', () => {
  assert.equal(evaluateCoin(coin(xPost('11')), evidence(0.9), P).outcome, 'right');
});

test('a different post named as the origin is wrongly linked', () => {
  assert.equal(evaluateCoin(coin(xPost('99')), evidence(0.9), P).outcome, 'wrongPost');
});

test('★ an origin named where the founders found none is wrongly called viral; a dissimilar picture names nothing', () => {
  assert.equal(evaluateCoin(coin({ kind: 'none' }), evidence(0.9), P).outcome, 'calledViral');
  assert.equal(evaluateCoin(coin({ kind: 'none' }), evidence(0.5), P).outcome, 'correctNone');
  assert.equal(evaluateCoin(coin(xPost('11')), evidence(0.5), P).outcome, 'missed');
});

test('★ a coin missing a stage is incomplete, never a miss', () => {
  const { similarity: _s, ...noPictures } = evidence(0.9);
  assert.equal(evaluateCoin(coin(xPost('11')), noPictures, P).outcome, 'incomplete');
  assert.equal(evaluateCoin(coin(xPost('11')), undefined, P).outcome, 'incomplete');
});

test('a borderline picture counts only with the judge\'s yes', () => {
  assert.equal(pictureTier(0.75, undefined, P), null);
  assert.equal(pictureTier(0.75, 'yes', P), 'confirmed');
  assert.equal(pictureTier(0.96, undefined, P), 'near');
});
