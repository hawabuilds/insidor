/**
 * Each judge reads its own number of precedents from one closest-first list: the main judge its
 * `k`, the open model its `openK`, cut further only when a call would not fit the model's window.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { storyId } from '@insidor/contracts/ids.ts';
import type { JudgePrecedent, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { withPrecedentsUpTo } from '@insidor/judge-anthropic';

import { fitPrecedents } from './index.ts';

const near = (n: number, tag: string): JudgePrecedent[] => Array.from({ length: n }, (_, i) => ({ ref: `x:${tag}${i}`, text: `labelled post ${tag}${i}`, label: i % 2 === 0 ? 'meme' : 'not', why: null }));
const subject = (id: string, n: number): JudgeSubject => ({ storyId: storyId(id), texts: ['a post'], media: [], distinctAuthors: 1, distinctSources: 1, precedents: near(n, id) });
const policy = DEFAULT_POLICY.judge;

test('★ the main judge keeps its first k, closest first; the open judge its first openK', () => {
  const batch = [subject('a', 40), subject('b', 3)];
  const main = withPrecedentsUpTo(batch, policy.precedents.k);
  assert.equal(main[0]?.precedents?.length, policy.precedents.k);
  assert.deepEqual(main[0]?.precedents?.map((p) => p.ref), near(40, 'a').slice(0, policy.precedents.k).map((p) => p.ref), 'the closest, in order');
  assert.equal(main[1]?.precedents?.length, 3, 'a post with fewer keeps all it has');
  const open = fitPrecedents(batch, policy, () => 0);
  assert.equal(open[0]?.precedents?.length, policy.precedents.openK);
});

test('★ a call over the window keeps fewer precedents per post until it fits, the farthest dropped first', () => {
  const batch = [subject('a', 40)];
  /* A fake token count: 1,000 a precedent. */
  const tokens = (b: readonly JudgeSubject[]) => b.reduce((n, s) => n + (s.precedents?.length ?? 0) * 1_000, 0);
  const fitted = fitPrecedents(batch, { ...policy, precedents: { ...policy.precedents, openK: 40, openMaxInputTokens: 22_000 } }, tokens);
  assert.equal(fitted[0]?.precedents?.length, 20);
  assert.deepEqual(fitted[0]?.precedents?.map((p) => p.ref), near(40, 'a').slice(0, 20).map((p) => p.ref));
  const none = fitPrecedents(batch, { ...policy, precedents: { ...policy.precedents, openK: 40, openMaxInputTokens: 0 } }, tokens);
  assert.equal(none[0]?.precedents?.length, 0, 'never below none');
});
