/**
 * The recall model's claims, each pinned: the reason list matches 0047's CHECK, a lane catches
 * only within its measured reach, and "not in search" outranks every floor.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MISS_REASONS, crossingAgeMin, fitGrowthTau, missReasonBefore, verdict, type DiscoverySettings, type PostFacts } from './model.ts';

const S: DiscoverySettings = {
  langs: ['en'],
  excludeReplies: false,
  excludeRebroadcasts: true,
  tauMin: 60,
  lanes: [
    { lane: 'all', floor: 60, reachMin: 10, everyMin: 2, mediaOnly: false },
    { lane: 'slow', floor: 500, reachMin: 45, everyMin: 15, mediaOnly: false },
  ],
};
const post = (approvals: number, extra: Partial<PostFacts> = {}): PostFacts => ({ approvals, lang: 'en', hasMedia: false, isReply: false, isRebroadcast: false, ...extra });

test('the miss reasons are the CHECK list of 0047', () => {
  const sql = readFileSync(new URL('../../../store/migrations/0047_recall_check.sql', import.meta.url), 'utf8');
  const list = /miss_reason\s+text check \(miss_reason in \(([^)]*)\)\)/s.exec(sql)?.[1] ?? '';
  const values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...values].sort(), [...MISS_REASONS].sort());
});

test('a post that crosses the floor inside the reach is caught, half a pass later', () => {
  const v = verdict(post(10_000), S);
  assert.equal(v.kind, 'caught');
  if (v.kind === 'caught') {
    assert.equal(v.lane, 'all');
    assert.ok(Math.abs(v.delayMin - ((crossingAgeMin(10_000, 60, 60) as number) + 1)) < 1e-9);
  }
});

test('a post that crosses only after every reach is between checks, one that never crosses is under the floor', () => {
  assert.deepEqual(verdict(post(100), S), { kind: 'missed', reason: 'between_checks' });
  assert.deepEqual(verdict(post(40), S), { kind: 'missed', reason: 'under_floor' });
});

test('not in search outranks every floor', () => {
  assert.deepEqual(verdict(post(1e6, { lang: 'ja' }), S), { kind: 'missed', reason: 'not_in_search' });
  assert.deepEqual(verdict(post(1e6, { isRebroadcast: true }), S), { kind: 'missed', reason: 'not_in_search' });
  assert.equal(missReasonBefore(post(1e6, { lang: 'es' }), 30, S), 'not_in_search');
});

test('★ a reply is in the search now; it was not while replies were left out', () => {
  assert.equal(verdict(post(10_000, { isReply: true }), S).kind, 'caught');
  assert.deepEqual(verdict(post(10_000, { isReply: true }), { ...S, excludeReplies: true }), { kind: 'missed', reason: 'not_in_search' });
});

test('before a launch, a floor counts only if it was crossed by then', () => {
  assert.equal(missReasonBefore(post(100), 1, S), 'under_floor');
  assert.equal(missReasonBefore(post(100), 600, S), 'between_checks');
});

test('the growth fit recovers the τ that made the readings', () => {
  const tau = 40;
  const at = (age: number) => 1000 * (1 - Math.exp(-age / tau));
  const pairs = [5, 8, 12].map((a) => ({ ageFirstMin: a, approvalsFirst: at(a), ageLastMin: a + 60, approvalsLast: at(a + 60) }));
  const fit = fitGrowthTau(pairs, { fromMin: 5, toMin: 2000, step: 1.01 }) as number;
  assert.ok(Math.abs(fit - tau) / tau < 0.02);
});
