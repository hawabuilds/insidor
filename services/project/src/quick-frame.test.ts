/**
 * The quick frame's two decisions: when it runs (something changed, the answers have settled, not
 * too soon after the last), and what For You becomes (the committed list with the changed posts
 * put in, re-placed or taken off, newest first, every unchanged card kept as it was).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { mergeForYou, quickDue, type QuickProbe } from './quick-frame.ts';

const P = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, quickFrame: { on: true, checkEveryMs: 5_000, minGapMs: 20_000, settleMs: 10_000 } } };
const NOW = 1_800_000_000_000;
const probe = (answerId: number, answerAgoMs: number | null, linkAtMs: number | null = null, callAtMs: number | null = null): QuickProbe => ({ answerId, atMs: NOW, answerAtMs: answerAgoMs === null ? null : NOW - answerAgoMs, linkAtMs, callAtMs });

test('a new answer, settled, past the gap: a quick frame is due', () => {
  assert.equal(quickDue({ answerId: 10, atMs: NOW - 60_000 }, null, probe(11, 12_000), NOW, P), true);
  assert.equal(quickDue({ answerId: 10, atMs: NOW - 60_000 }, NOW - 25_000, probe(11, 12_000), NOW, P), true);
});

test('★ answers still arriving: not yet — a pass files its kind answers after its yeses', () => {
  assert.equal(quickDue({ answerId: 10, atMs: NOW - 60_000 }, null, probe(11, 3_000), NOW, P), false);
});

test('nothing new, too soon after the last, no cursor yet, or switched off: not due', () => {
  assert.equal(quickDue({ answerId: 11, atMs: NOW - 60_000 }, null, probe(11, 60_000), NOW, P), false, 'nothing new');
  assert.equal(quickDue({ answerId: 10, atMs: NOW - 60_000 }, NOW - 5_000, probe(11, 60_000), NOW, P), false, 'inside the gap');
  assert.equal(quickDue(null, null, probe(11, 60_000), NOW, P), false, 'no frame has begun yet');
  const off = { ...P, rising: { ...P.rising, quickFrame: { ...P.rising.quickFrame, on: false } } };
  assert.equal(quickDue({ answerId: 10, atMs: NOW - 60_000 }, null, probe(11, 60_000), NOW, off), false);
});

test('a coin linking a passed post, or the owner calling a post, since the cursor is a change too', () => {
  assert.equal(quickDue({ answerId: 11, atMs: NOW - 60_000 }, null, probe(11, 60_000, NOW - 1_000), NOW, P), true, 'a new link');
  assert.equal(quickDue({ answerId: 11, atMs: NOW - 60_000 }, null, probe(11, 60_000, NOW - 90_000), NOW, P), false, 'a link from before the cursor');
  assert.equal(quickDue({ answerId: 11, atMs: NOW - 60_000 }, null, probe(11, 60_000, null, NOW - 1_000), NOW, P), true, 'an owner call');
});

const card = (id: string, at: number, v = 'old') => ({ id, at, v });
const at = (c: { at: number }) => c.at;

test('★ a new post goes in at its place, newest first; unchanged cards stay exactly as written', () => {
  const showing = [card('a', 30), card('b', 20), card('c', 10)];
  const merged = mergeForYou(showing, new Set(['n']), [card('n', 25, 'new')], at);
  assert.deepEqual(merged.map((c) => c.id), ['a', 'n', 'b', 'c']);
  assert.equal(merged[0], showing[0], 'the same object: an unchanged card is not rebuilt');
});

test('a changed post that no longer passes is taken off; one that still does is re-placed with its new card', () => {
  const showing = [card('a', 30), card('b', 20), card('c', 10)];
  const merged = mergeForYou(showing, new Set(['b', 'c']), [card('c', 10, 'new')], at);
  assert.deepEqual(merged.map((c) => `${c.id}:${c.v}`), ['a:old', 'c:new']);
});
