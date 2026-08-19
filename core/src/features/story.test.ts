/**
 * The wide story vector, as the one trap it exists to avoid.
 *
 * The `Story` handed to the builder is the CURRENT aggregate, and every summary field
 * on it is a fact about members that may not have existed at `asOf`. Reading one is
 * lookahead that typechecks, passes review, and produces a feature that looks
 * brilliant right up until it is deployed — because in a backtest it is partly made of
 * the answer.
 *
 * So the fixtures below do something deliberately hostile: the `Story` object carries
 * summary fields that are FLATLY WRONG for the instant being asked about, and the
 * tests assert that none of them reaches the output. A builder that read the aggregate
 * would not merely be imprecise here, it would be visibly, numerically wrong — which
 * is the only way to make a silent failure loud.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { MatchEvidence, Story, StoryMember } from '@insidor/contracts/story.ts';

import { featureShapeHash } from './registry.ts';
import { storyFeatures } from './story.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const P = DEFAULT_POLICY;

const STORY = storyId('7f3a');
const FEED: SourceId = sourceId('feed-a');
const OTHER: SourceId = sourceId('feed-b');
const CREATED = NOW - 2 * HOUR;

const CARRIER: MatchEvidence = {
  kind: 'carrier',
  carrier: 'formatId',
  key: 'template-nine-second-clip',
  distance: null,
  weight: 0.4,
};

interface MemberSpec {
  readonly author: string;
  readonly source?: SourceId;
  readonly joinedAt: number;
  readonly postedAt?: number | null;
  readonly evidence?: MatchEvidence;
}

function member(index: number, spec: MemberSpec): StoryMember {
  return {
    storyId: STORY,
    itemId: itemId(spec.source ?? FEED, `i${index}`),
    authorKey: authorKey(spec.source ?? FEED, spec.author),
    source: spec.source ?? FEED,
    postedAt: spec.postedAt === undefined ? spec.joinedAt - MINUTE : spec.postedAt,
    joinedAt: spec.joinedAt,
    evidence: spec.evidence ?? CARRIER,
  };
}

/**
 * ★ EVERY SUMMARY FIELD IS A LIE, on purpose. If the builder consults one, the tests
 * below fail loudly rather than drifting by a percent.
 */
function lyingAggregate(over: Partial<Story> = {}): Story {
  return {
    storyId: STORY,
    state: 'promoted',
    createdAt: CREATED,
    promotedAt: NOW - HOUR,
    // A minimum over ALL members, including ones that joined after asOf. It moves
    // BACKWARDS as a story accretes, which is what makes it the subtlest of the eight.
    earliestPostAt: NOW - 10 * HOUR,
    lastMemberAt: NOW,
    memberCount: 999,
    distinctAuthors: 99,
    distinctSources: 9,
    carriers: [],
    mergedInto: null,
    ...over,
  };
}

/* ── the trap ─────────────────────────────────────────────────────────── */

test('a story vector cannot see a member that joined after asOf', () => {
  const asOf = NOW - HOUR;
  const members = [
    member(1, { author: 'a1', joinedAt: CREATED }),
    member(2, { author: 'a2', joinedAt: CREATED + 10 * MINUTE }),
    member(3, { author: 'a3', joinedAt: CREATED + 20 * MINUTE }),
    // Joined after asOf, and carrying a post time EARLIER than every visible member.
    // A builder reading `story.earliestPostAt` would date the story from this post,
    // which nobody had seen when the decision was made.
    member(4, { author: 'a4', source: OTHER, joinedAt: NOW - 5 * MINUTE, postedAt: NOW - 10 * HOUR }),
    member(5, { author: 'a5', source: OTHER, joinedAt: NOW - MINUTE }),
  ];

  const f = storyFeatures(lyingAggregate(), members, asOf, P);

  assert.equal(f.memberCount, 3);
  assert.equal(f.distinctAuthors, 3);
  // The fourth and fifth members are the only cross-source ones. At asOf the story is
  // single-source, and a vector that said otherwise would be claiming the strongest
  // cheap evidence a story can have on the basis of a member that did not exist.
  assert.equal(f.distinctSources, 1);
  assert.equal(f.isCrossSource, 0);

  // Dated from the earliest post among VISIBLE members, which is roughly two hours
  // ago — not the ten-hour-old post the aggregate reports.
  assert.ok((f.postAgeMin ?? 0) < 3 * (HOUR / MINUTE));
});

test('the same asOf gives the same vector however many members arrive afterwards', () => {
  const asOf = NOW - HOUR;
  const early = [
    member(1, { author: 'a1', joinedAt: CREATED }),
    member(2, { author: 'a2', joinedAt: CREATED + 10 * MINUTE }),
    member(3, { author: 'a3', joinedAt: CREATED + 20 * MINUTE }),
  ];
  const later = [
    ...early,
    member(4, { author: 'a4', source: OTHER, joinedAt: NOW - 5 * MINUTE, postedAt: NOW - 10 * HOUR }),
    member(5, { author: 'a5', source: OTHER, joinedAt: NOW - MINUTE }),
    member(6, { author: 'a1', joinedAt: NOW }),
  ];

  // ★ THIS IS THE REPLAY PROPERTY, AS ONE ASSERTION. The left side is the vector the
  // live run wrote an hour ago; the right side is the vector a replay computes today,
  // from a store that has since learned three more members and a much older post. If
  // any term anywhere reached the aggregate — or forgot the filter — these differ, and
  // every threshold ever replayed against this stage would be replayed against a
  // story that did not exist at the moment being replayed.
  assert.deepEqual(
    storyFeatures(lyingAggregate({ memberCount: 3 }), early, asOf, P),
    storyFeatures(lyingAggregate(), later, asOf, P),
  );
});

test('forty posts by one account is one person, and the vector says which', () => {
  const asOf = NOW;
  const persistent = Array.from({ length: 40 }, (_, i) =>
    member(i, { author: 'a1', joinedAt: CREATED + i * MINUTE }),
  );
  const spread = Array.from({ length: 40 }, (_, i) =>
    member(i, { author: `a${i}`, joinedAt: CREATED + i * MINUTE }),
  );

  const one = storyFeatures(lyingAggregate(), persistent, asOf, P);
  const many = storyFeatures(lyingAggregate(), spread, asOf, P);

  // Volume is identical. The product's claim is "people are making their own versions
  // of this", and on that claim these two stories could not be further apart.
  assert.equal(one.memberCount, many.memberCount);

  assert.equal(one.distinctAuthors, 1);
  assert.equal(one.topAuthorShare, 1);
  assert.equal(one.membersPerAuthor, 40);

  assert.equal(many.distinctAuthors, 40);
  assert.equal(many.topAuthorShare, 1 / 40);
  // Saturating: forty authors and twelve authors are both simply "wide", because the
  // difference between them is not a difference the product cares about.
  assert.equal(many.authorBreadth, 1);
  assert.ok((one.authorBreadth ?? 1) < (many.authorBreadth ?? 0));
});

test('a story with no post times is undated, not dated from our own crawl', () => {
  const undated = [
    member(1, { author: 'a1', joinedAt: CREATED, postedAt: null }),
    member(2, { author: 'a2', joinedAt: CREATED + MINUTE, postedAt: null }),
  ];
  const f = storyFeatures(lyingAggregate(), undated, NOW, P);

  // ★ `ageMin` is always available because it runs off OUR clock. `postAgeMin` is
  // null, and falling back to `createdAt` there would silently report our own crawl
  // latency as the story's age — a number that gets better when our reader gets
  // slower, which is the worst possible direction for a feature to be wrong in.
  assert.equal(f.postTimeKnownShare, 0);
  assert.equal(f.postAgeMin, null);
  assert.equal(f.discoveryLagMin, null);
  assert.ok((f.ageMin ?? 0) > 0);
});

test('the evidence mix is recorded, because it is what decides the paid tier bill', () => {
  const members = [
    member(1, { author: 'a1', joinedAt: CREATED, evidence: { kind: 'seed' } }),
    member(2, { author: 'a2', joinedAt: CREATED + MINUTE }),
    member(3, {
      author: 'a3',
      joinedAt: CREATED + 2 * MINUTE,
      evidence: { kind: 'representation', similarity: 0.9, space: 'text.v2' },
    }),
    member(4, {
      author: 'a4',
      joinedAt: CREATED + 3 * MINUTE,
      evidence: { kind: 'lineage', via: 'reproduction', toItem: itemId(FEED, 'i1') },
    }),
  ];
  const f = storyFeatures(lyingAggregate(), members, NOW, P);

  // Three of the four joins cost nothing. A story assembled entirely from similarity
  // scores is a weaker claim than one assembled from identical images, whatever the
  // two scores say — and this is the pair of numbers that lets anyone check.
  assert.equal(f.freeJoinShare, 3 / 4);
  assert.equal(f.representationJoinShare, 1 / 4);
  assert.equal(f.carrierJoinShare, 1 / 4);
  assert.equal(f.lineageJoinShare, 1 / 4);
  assert.equal(f.seedJoinShare, 1 / 4);
});

test('an empty story is nulls, not zeroes: there is no share of nothing', () => {
  const f = storyFeatures(lyingAggregate(), [], NOW, P);

  assert.equal(f.memberCount, 0);
  assert.equal(f.freeJoinShare, null);
  assert.equal(f.topAuthorShare, null);
  assert.equal(f.postTimeKnownShare, null);
  assert.equal(f.recentJoinShare, null);
  assert.equal(f.sinceLastJoinMin, null);
});

test('the story set has one shape, and changing it is a version bump rather than a diff', () => {
  const f = storyFeatures(lyingAggregate(), [], NOW, P);
  const populated = storyFeatures(
    lyingAggregate(),
    [member(1, { author: 'a1', joinedAt: CREATED })],
    NOW,
    P,
  );

  assert.equal(featureShapeHash(Object.keys(f)), '94bf0122');
  assert.equal(Object.keys(f).length, 26);
  // Same keys with members and without: absent is a value, never a missing key.
  assert.equal(featureShapeHash(Object.keys(populated)), featureShapeHash(Object.keys(f)));
});
