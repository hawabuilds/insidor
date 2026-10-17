/**
 * The owner's second junk measure: the label old answers give, the seeded draw, and the unclear page.
 * Run: node --test --experimental-strip-types tools/lib/junk-sample.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { drawSample, oldLabel, unclearMarkdown, type Untapped } from './junk-sample.ts';

const P = DEFAULT_POLICY;
const a = (coinable: boolean, confidence: number) => ({ coinable, confidence });

test('★ the Haiku answer where there is one, else Gemma at 0.90; disagreeing or borderline answers are unclear', () => {
  assert.deepEqual(oldLabel({ haiku: a(false, 0.9), gemma: null }, P), { label: 'not' });
  assert.deepEqual(oldLabel({ haiku: a(true, 0.85), gemma: null }, P), { label: 'meme' });
  assert.deepEqual(oldLabel({ haiku: null, gemma: a(true, 0.95) }, P), { label: 'meme' });
  assert.deepEqual(oldLabel({ haiku: null, gemma: a(true, 0.85) }, P), { label: 'not' }, 'a Gemma yes under 0.90 is a no');
  assert.equal(oldLabel({ haiku: a(false, 0.7), gemma: null }, P).label, 'unclear', 'borderline');
  assert.equal(oldLabel({ haiku: a(true, 0.9), gemma: a(false, 0.95) }, P).label, 'unclear', 'they disagree');
  assert.deepEqual(oldLabel({ haiku: null, gemma: null }, P), { label: null });
});

const post = (i: number, h = a(false, 0.9)): Untapped => ({ itemId: `x:${1000 + i}`, text: `post ${i}`, imageUri: null, haiku: h, gemma: null });

test('the draw is the seed and the ids alone: the same posts whatever the order, never an excluded one or one with no old answer', () => {
  const all = Array.from({ length: 500 }, (_, i) => post(i));
  const one = drawSample(all, P, new Set()).map((u) => u.itemId);
  const two = drawSample([...all].reverse(), P, new Set()).map((u) => u.itemId);
  assert.equal(one.length, P.learning.ownerGate.untapped.sample);
  assert.deepEqual(one, two);
  const ex = drawSample(all, P, new Set([one[0]!]));
  assert.ok(!ex.some((u) => u.itemId === one[0]));
  assert.equal(drawSample([{ ...post(1), haiku: null }], P, new Set()).length, 0);
});

test('the unclear page lists each unclear post with its link, text and old answers', () => {
  const md = unclearMarkdown(drawSample([post(1, a(false, 0.7)), post(2)], P, new Set()), new Date(0));
  assert.match(md, /1 of 2/);
  assert.match(md, /\[x:1001\]\(https:\/\/x\.com\/i\/status\/1001\) \| post 1 \| Haiku no 0\.70; Gemma — \|/);
});
