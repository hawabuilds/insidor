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

test('★ one person under several spellings is one name: "jensen" reaches into "jensenhuang"; a short name reaches into nothing', () => {
  const a = subjectOf('n-a', posts('jensen', NEO, 6), 1);
  const b = subjectOf('n-b', posts('jensenhuang', NEO_NEAR), 2);
  const c = subjectOf('n-c', posts('dishwasherjensen', NEO_NEAR), 3);
  assert.ok(sameSubject(a, b, P) !== null);
  assert.ok(sameSubject(a, c, P) !== null);
  const kim = subjectOf('n-k', posts('kim', NEO, 6), 1);
  const kimchi = subjectOf('n-kc', posts('kimchi', NEO_NEAR), 2);
  assert.equal(sameSubject(kim, kimchi, P), null, 'under familyMinChars a name is only itself');
});

// Two averages 0.83 alike: under `meaning`, over `titledMeaning`.
const MID = unit(1, 0.1, 0.6);

test('★ when both titles say the shared name, the lower meaning bar holds; without the titles the usual one', () => {
  const big = subjectOf('n-big', posts('jensen', NEO, 6), 1, 'Nvidia CEO Jensen Huang Affair Rumors');
  const small = subjectOf('n-s', posts('dishwasherjensen', MID), 2, 'Jensen Meme Dishwasher Joke');
  const untitled = subjectOf('n-u', posts('dishwasherjensen', MID), 2, 'Dishwasher Joke');
  const c = sameSubject(big, small, P);
  assert.ok(c !== null && c < P.narrative.same.meaning && c >= P.narrative.same.titledMeaning);
  assert.equal(sameSubject(big, untitled, P), null);
});

test('★ a title never links on its own: another name, whatever the titles say, is another story', () => {
  const big = subjectOf('n-big', posts('jensen', NEO, 6), 1, 'Nvidia CEO Jensen Huang Affair Rumors');
  assert.equal(sameSubject(big, subjectOf('n-u', posts('ufo', NEO_NEAR), 2, 'Jensen Huang UFO Claims'), P), null);
  const panda = subjectOf('n-p', posts('pitbull', NEO, 6), 1, 'Panda Panda Pitbull Joins Parade');
  assert.equal(sameSubject(panda, subjectOf('n-f', posts('fuuta', NEO_NEAR), 2, 'Red Panda Fuuta Sets Record'), P), null);
});

test('with no stored vectors on one side the meaning cannot confirm, so no link stands', () => {
  const big = subjectOf('n-big', posts('jensen', NEO, 6), 1, 'Nvidia CEO Jensen Huang Affair Rumors');
  const none = [{ name: 'jensen', vector: undefined }, { name: 'jensen', vector: undefined }];
  assert.equal(sameSubject(big, subjectOf('n-t', none, 2, 'Jensen Huang Meme Coins Flood'), P), null);
});

test('a run of generic title words names nothing, and kind words are no name', () => {
  assert.equal(subjectName('Elon Musk', P), null);
  assert.equal(subjectName('coin', P), null);
  assert.equal(subjectName('Baby', P), null);
  assert.equal(subjectName('panda', P), null);
});

test('★ a match never chains through a narrative merged away this pass', () => {
  const xs = [
    subjectOf('n-jensen', posts('jensen', NEO, 6), 1),
    subjectOf('n-jh', posts('jensenhuang', NEO_NEAR, 4), 2),
    subjectOf('n-jhh', posts('jensenhuanghat', NEO_NEAR), 3),
  ];
  assert.deepEqual(sameSubjectMerges(xs, new Set(), P).map((m) => [m.from, m.into]), [['n-jh', 'n-jensen'], ['n-jhh', 'n-jensen']]);
});
