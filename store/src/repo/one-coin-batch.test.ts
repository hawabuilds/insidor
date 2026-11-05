/**
 * One row per key in one statement: a batch naming the same candidate or pick twice leaves what
 * writing them one after another would, and a batch without repeats is written as given.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { oneCandidateEach, onePickEach, type CandidateRow, type PickWrite } from './one-coin.ts';

const cand = (itemId: string, address: string, path: CandidateRow['path'], evidence: Record<string, unknown>, foundAtMs: number): CandidateRow =>
  ({ itemId, address, path, evidence, launchedAtMs: 1, foundAtMs }) as CandidateRow;
const pick = (subjectId: string, address: string | null): PickWrite => ({ subjectId, address }) as unknown as PickWrite;

test('★ a candidate named twice: the first path and found time stay, the last evidence wins (2026-11-05)', () => {
  const out = oneCandidateEach([cand('x:1', 'A', 'launch', { link: true }, 10), cand('x:2', 'B', 'launch', {}, 11), cand('x:1', 'A', 'existing', { link: true, picture: true }, 12)]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], cand('x:1', 'A', 'launch', { link: true, picture: true }, 10));
  assert.equal(out[1]?.itemId, 'x:2');
});

test('★ a pick named twice: the last wins, as two writes would leave it', () => {
  const out = onePickEach([pick('x:1', 'A'), pick('x:2', 'B'), pick('x:1', 'C')]);
  assert.deepEqual(out.map((p) => [p.subjectId, p.address]), [['x:2', 'B'], ['x:1', 'C']]);
});

test('no repeats: written exactly as given', () => {
  const rows = [cand('x:1', 'A', 'launch', {}, 1), cand('x:1', 'B', 'launch', {}, 2)];
  assert.deepEqual(oneCandidateEach(rows), rows);
  const picks = [pick('x:1', 'A'), pick('x:2', null)];
  assert.deepEqual(onePickEach(picks), picks);
});
