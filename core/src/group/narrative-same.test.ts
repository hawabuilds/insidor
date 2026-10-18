/**
 * The same-subject rule (narrative-same.ts) on the 18 Oct duplicates: one story told three times
 * merges into its oldest telling; two close narratives with different names, or with a generic
 * name, never do; the owner's narratives are never touched; a new group joins its subject.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { joinExisting, sameSubject, sameSubjectMerges, subjectName, subjectOf, type SubjectPost } from './narrative-same.ts';

const unit = (...xs: number[]) => {
  const l = Math.hypot(...xs);
  return xs.map((x) => x / l);
};
const NEO = unit(1, 0.1, 0);
const NEO_NEAR = unit(1, 0.12, 0.02);
const AGENTS = unit(0.98, 0.15, 0.05); // a shill's words: close to everything
const FAR = unit(0, 0, 1);
const posts = (name: string | null, v: number[], n = 2): SubjectPost[] => Array.from({ length: n }, () => ({ name, vector: v }));

test('the name is compacted, and short, generic or kind-of-thing names are no name', () => {
  assert.equal(subjectName('Neo', P), 'neo');
  assert.equal(subjectName('$GIGA BITE', P), 'gigabite');
  assert.equal(subjectName('CAT', P), null);
  assert.equal(subjectName('viral', P), null);
  assert.equal(subjectName('ab', P), null);
  assert.equal(subjectName(null, P), null);
});

test('★ the same subject is the same name AND close in meaning; close meaning alone is not', () => {
  const a = subjectOf('n-a', posts('neo', NEO, 6), 1);
  const b = subjectOf('n-b', posts('neo', NEO_NEAR), 2);
  const other = subjectOf('n-c', posts('nakama', AGENTS), 3);
  const far = subjectOf('n-d', posts('neo', FAR), 4);
  assert.ok((sameSubject(a, b, P) ?? 0) >= P.narrative.same.meaning);
  assert.equal(sameSubject(a, other, P), null, 'a shill of another name reads alike and is another story');
  assert.equal(sameSubject(a, far, P), null, 'the same name far apart in meaning is another story');
});

test('a name only a few of its posts carry is not what the narrative is about', () => {
  const a = subjectOf('n-a', [...posts('zazu', NEO, 1), ...posts('bean', NEO, 1), ...posts('mittens', NEO, 1)], 1);
  const b = subjectOf('n-b', posts('bean', NEO), 2);
  assert.equal(a.name, 'bean');
  assert.ok(a.nameShare < P.narrative.same.nameShare);
  assert.equal(sameSubject(a, b, P), null);
});

test('★ a story told three times ends as one: each newer telling merges into the oldest', () => {
  const xs = [subjectOf('n-new', posts('neo', NEO_NEAR), 30), subjectOf('n-old', posts('neo', NEO, 6), 10), subjectOf('n-mid', posts('neo', NEO), 20), subjectOf('n-x', posts('nakama', AGENTS), 5)];
  const merges = sameSubjectMerges(xs, new Set(), P);
  assert.deepEqual(merges.map((m) => [m.from, m.into]), [['n-mid', 'n-old'], ['n-new', 'n-old']]);
});

test('★ a narrative the owner called on is never merged, nor merged into', () => {
  const xs = [subjectOf('n-old', posts('neo', NEO), 10), subjectOf('n-new', posts('neo', NEO), 20)];
  assert.deepEqual(sameSubjectMerges(xs, new Set(['n-old']), P), []);
  assert.deepEqual(sameSubjectMerges(xs, new Set(['n-new']), P), []);
  const off = { ...P, narrative: { ...P.narrative, same: { ...P.narrative.same, on: false } } };
  assert.deepEqual(sameSubjectMerges(xs, new Set(), off), []);
});

test('a new group joins the narrative of its subject, the closest of several; another subject stays new', () => {
  const existing = [subjectOf('n-a', posts('neo', NEO), 1), subjectOf('n-b', posts('neo', NEO_NEAR), 2), subjectOf('n-c', posts('comet', NEO), 3)];
  const groups = [subjectOf('g0', posts('neo', NEO_NEAR), 9), subjectOf('g1', posts('arya', NEO), 9)];
  const joins = joinExisting(groups, existing, P);
  assert.equal(joins.get(0), 'n-b');
  assert.equal(joins.has(1), false);
});
