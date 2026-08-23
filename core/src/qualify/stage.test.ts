/**
 * What QUALIFY must be true of. Most of these assert that a confident judge does not
 * get its way — which is the only reason the stage is shaped the way it is.
 *
 * The rule being held is an ORDERING, and an ordering is the kind of thing no type can
 * enforce: the deterministic caps run AFTER the judge's score and may only lower it.
 * Reorder those two and the code still compiles, still returns a number in [0,1], and
 * still looks correct in review — the only thing that changes is that a model can argue
 * its way past a rule whose inputs are ours. The cap test is written to fail in exactly
 * that case: it pins `score === 0.5`, the cap, against a weighted sum of 0.71 that would
 * otherwise have carried the story past the bar.
 *
 * ★ AND TWO TESTS ARE ABOUT ABSENCE, NOT DISAGREEMENT. A story the judge never saw and a
 * story the judge declined are different populations, so they are `abstain` with a named
 * reason rather than `drop`. If those two ever collapse into one verdict, the stage's
 * recall becomes unmeasurable — an outage and a rejection would be the same row — and
 * nothing downstream would report an error, because both are perfectly valid decisions.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { StageContext } from '@insidor/contracts/decision.ts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { Judgement } from '@insidor/contracts/judgement.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';

import { qualify, type QualifyInput } from './stage.ts';

const STORY = storyId('7f3a');
const SOURCE_A = sourceId('srca');
const SOURCE_B = sourceId('srcb');
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'story-7f3a' };

function story(over: Partial<Story> = {}): Story {
  return {
    storyId: STORY,
    state: 'promoted',
    origin: 'observed',
    createdAt: NOW - 60 * MINUTE,
    promotedAt: NOW - 30 * MINUTE,
    earliestPostAt: NOW - 70 * MINUTE,
    lastMemberAt: NOW - 2 * MINUTE,
    memberCount: 4,
    distinctAuthors: 4,
    distinctSources: 2,
    carriers: [],
    mergedInto: null,
    ...over,
  };
}

function member(n: number, source = SOURCE_A): StoryMember {
  return {
    storyId: STORY,
    itemId: itemId(source, `i${n}`),
    authorKey: authorKey(source, `a${n}`),
    source,
    postedAt: NOW - (70 - n) * MINUTE,
    joinedAt: NOW - (60 - n) * MINUTE,
    evidence: { kind: 'carrier', carrier: 'imageHash', key: 'k', distance: 2, weight: 1 },
  };
}

const MEMBERS: readonly StoryMember[] = [
  member(1),
  member(2),
  member(3, SOURCE_B),
  member(4, SOURCE_B),
];

function judgement(over: Partial<Judgement> = {}): Judgement {
  return {
    judgeId: 'judge:test@1',
    promptId: 'prompt.v1',
    judgedAt: NOW - MINUTE,
    coinable: true,
    confidence: 0.9,
    proposedName: 'small hippo',
    alternateNames: [],
    subjectSpans: ['a small hippo yawning', 'the small hippo again'],
    rationaleRef: null,
    costUsd: 0.0004,
    ...over,
  };
}

function input(over: Partial<QualifyInput> = {}): QualifyInput {
  return {
    story: story(),
    members: MEMBERS,
    judgement: judgement(),
    judgeCostUsd: 0.0004,
    ...over,
  };
}

test('a story the judge never saw ABSTAINS; it is not a negative', () => {
  const d = qualify(input({ judgement: null }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'Q1_unjudged');
  assert.equal(d.features.judgeCoinable, null, 'absent must not collapse into negative');
});

test('an unpromoted story is not this stage’s business, and costs no judge call', () => {
  const d = qualify(
    input({ story: story({ state: 'candidate', promotedAt: null }) }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'S0_not_applicable');
});

test('a generic name is dropped however confident the judge is', () => {
  const d = qualify(
    input({ judgement: judgement({ proposedName: '$SOL', confidence: 0.99, coinable: true }) }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'Q5_generic_name');
  assert.equal(d.score, null, 'a gate decided, so there is no score to report');
});

test('one author is not a story, whatever else is true of it', () => {
  const d = qualify(input({ members: [member(1), member(1), member(1)] }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'Q2_single_author');
});

test('a name the story does not actually contain fails the specificity floor', () => {
  const d = qualify(
    input({
      judgement: judgement({
        proposedName: 'quarterly earnings',
        subjectSpans: ['a small hippo yawning', 'the small hippo again'],
      }),
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'Q7_name_unspecific');
});

test('the nameability cap lowers a score the judge would have carried past the bar', () => {
  // Anchored in two of four spans: specific enough to clear the floor, not specific
  // enough to be worth naming. The weighted score would be 0.71; the cap is 0.5.
  const d = qualify(
    input({
      judgement: judgement({
        subjectSpans: [
          'a small hippo yawning',
          'the small hippo again',
          'unrelated text',
          'more unrelated text',
        ],
      }),
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'Q8_score_below_bar');
  assert.equal(d.score, 0.5, 'the cap, not the weighted sum, decided');
});

test('our gates pass and the judge says no: dropped, and the reason says which', () => {
  const d = qualify(input({ judgement: judgement({ coinable: false }) }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'Q9_judged_not_coinable');
  assert.ok(d.score !== null && d.score >= DEFAULT_POLICY.qualify.passScore);
});

test('a nameable cross-source story passes, and the decision is auditable', () => {
  const d = qualify(input(), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'Q0_coinable');
  assert.equal(d.decider, 'rule:qualify@1');
  assert.equal(d.featureSet, 'story.qualify.v1');
  assert.equal(d.policyHash, 'test-policy-hash');
  assert.equal(d.costUsd, 0.0004);
  assert.equal(d.features.isCrossSource, 1);
  assert.ok(d.featureAsOf <= d.decidedAt, 'no lookahead');
});
