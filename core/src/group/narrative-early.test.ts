/** The early posts (narrative-early.ts): the parts' own rule, one narrative a post, earliest first. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

/* These tests pin the rules before the subject rule (policy.v242 `narrative.subject`), which they were
   written for: links on a topic word, stories merged across names. narrative-subject.test.ts tests the rule. */
const P = { ...DEFAULT_POLICY, narrative: { ...DEFAULT_POLICY.narrative, subject: { ...DEFAULT_POLICY.narrative.subject, on: false } } };

import { earlyMatches, earlyShortlist, type EarlyInput } from './narrative-early.ts';
import { foldNarrativeCalls, type NarrativePost } from './narrative.ts';

const post = (itemId: string, atMs: number, text: string, names: readonly string[] = []): NarrativePost => ({ itemId, atMs, text, names, hasPicture: false });
const unit = (angle: number) => Float32Array.from([Math.cos(angle), Math.sin(angle)]);
const ROADSTER = 'The new Tesla Roadster flies over the crowd at the unveil tonight';
const CATS = 'A new cat cafe opened downtown with twenty rescue cats inside today';

const input = (stored: readonly NarrativePost[], narratives = [{ id: 'n-road', members: ['a', 'b'] }]): EarlyInput => ({
  narratives,
  posts: new Map([post('a', 100, ROADSTER, ['Flying Roadster']), post('b', 200, ROADSTER), post('c', 150, CATS, ['Cat Cafe']), post('d', 160, CATS)].map((x) => [x.itemId, x] as const)),
  stored,
  calls: foldNarrativeCalls([]),
});

test('★ only posts sharing a name or topic word are shortlisted; their vectors are all that is read', () => {
  const i = input([post('old', 10, ROADSTER), post('cat', 10, CATS)]);
  assert.deepEqual(earlyShortlist(i, P), new Map([['n-road', ['old']]]));
});

test('★ a shortlisted post far from the narrative in meaning is not early; a close one is', () => {
  const i = input([post('old', 10, ROADSTER), post('drift', 20, ROADSTER)]);
  const v = new Map([['a', unit(0)], ['b', unit(0.1)], ['old', unit(0.05)], ['drift', unit(1.4)]]);
  assert.deepEqual(earlyMatches(i, earlyShortlist(i, P), v, P), new Map([['n-road', ['old']]]));
});

test('a post two narratives would take goes to the one whose average it is closest to', () => {
  const both = 'The new Tesla Roadster cat cafe opened downtown with rescue cats inside';
  const i = input([post('x', 10, both)], [{ id: 'n-road', members: ['a', 'b'] }, { id: 'n-cat', members: ['c', 'd'] }]);
  const v = new Map([['a', unit(0)], ['b', unit(0)], ['c', unit(0.5)], ['d', unit(0.5)], ['x', unit(0.4)]]);
  assert.deepEqual(earlyMatches(i, earlyShortlist(i, P), v, P), new Map([['n-cat', ['x']]]));
});

test('★ a link counts only inside the regroup gap: a post days before anything else in the story is not early', () => {
  const day = P.narrative.maxGapMs;
  const i = input([post('bridge', 100 - day / 2, ROADSTER), post('first', 100 - day, ROADSTER), post('lone', 100 - 4 * day, ROADSTER)]);
  const v = new Map(['a', 'b', 'bridge', 'first', 'lone'].map((k) => [k, unit(0)] as const));
  assert.deepEqual(earlyMatches(i, earlyShortlist(i, P), v, P), new Map([['n-road', ['first', 'bridge']]]));
});

test('earliest first, at most maxPerNarrative', () => {
  const policy = { ...P, narrative: { ...P.narrative, early: { ...P.narrative.early, maxPerNarrative: 2 } } };
  const i = input([post('late', 50, ROADSTER), post('first', 10, ROADSTER), post('mid', 30, ROADSTER)]);
  const v = new Map(['a', 'b', 'late', 'first', 'mid'].map((k) => [k, unit(0)] as const));
  assert.deepEqual(earlyMatches(i, earlyShortlist(i, policy), v, policy), new Map([['n-road', ['first', 'mid']]]));
});
