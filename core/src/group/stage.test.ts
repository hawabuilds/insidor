/**
 * GROUP, as the claims the join has to satisfy.
 *
 * ★ WHAT A GREEN RUN HERE DOES AND DOES NOT SUPPORT. Every fixture below is invented.
 * These are algebra over inputs constructed by hand, and they prove that the stage
 * computes what the design says it computes: which tier settles a pair, which of the
 * four verdicts comes out, and which threshold moved it. They prove NOTHING about
 * recall or precision on real posts, because there is no labelled set of real pairs in
 * this repository to measure either against — the seeded corpus was built from the
 * answer, with each member's hash distance chosen to equal the distance its own
 * membership row asserts, and it contains no near-miss anywhere. A matcher that joins
 * everything inside its radius passes on that data.
 *
 * So: mechanism, yes. Accuracy, not yet, and not from here.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import type { SourceId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { StageContext } from '@insidor/contracts/decision.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Fingerprint, Item } from '@insidor/contracts/vocabulary.ts';

import { corpusKey } from './carriers.ts';
import { matchScore, NO_PAIR_CONTEXT } from './match.ts';
import { planMerge } from './merge.ts';
import { carrierWeight, persistence } from './persistence.ts';
import { shouldPromote } from './promote.ts';
import { extract, gate, group, type GroupInput } from './stage.ts';

/* ── fixtures ─────────────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

const CTX: StageContext = { now: NOW, policyHash: 'test-policy-hash', seed: 'story-7f3a' };

const FEED: SourceId = sourceId('feed-a');
const OTHER_FEED: SourceId = sourceId('feed-b');

/** A template id: exact-match, no metric, and nothing generic about it. */
const TEMPLATE: Fingerprint = { kind: 'formatId', key: 'template-nine-second-clip' };
/** The kind an item can share with an unrelated item merely by mentioning a symbol. */
const GENERIC_SPAN: Fingerprint = { kind: 'entitySpan', key: '$SOL' };
const NAMED_SPAN: Fingerprint = { kind: 'entitySpan', key: 'hipposeason' };

function item(over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(FEED, 'i1'),
    source: FEED,
    sourceItemId: 'i1',
    authorKey: authorKey(FEED, 'a1'),
    postedAt: NOW - 10 * MINUTE,
    firstSeenAt: NOW - 5 * MINUTE,
    lang: null,
    text: 'the ferry refuses to dock and the pigeon is unbothered',
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: 'local:test/i1',
    ...over,
  };
}

function story(over: Partial<Story> = {}): Story {
  return {
    storyId: storyId('aaa1'),
    state: 'candidate',
    createdAt: NOW - 3 * HOUR,
    promotedAt: null,
    earliestPostAt: NOW - 3 * HOUR,
    lastMemberAt: NOW - 30 * MINUTE,
    memberCount: 3,
    distinctAuthors: 3,
    distinctSources: 1,
    carriers: [],
    mergedInto: null,
    ...over,
  };
}

function input(over: Partial<GroupInput> = {}): GroupInput {
  return {
    item: item(),
    candidates: [],
    similarity: {},
    lineage: null,
    corpus: {},
    costUsd: 0,
    ...over,
  };
}

/** DEFAULT_POLICY ships `similarityBars: {}`, so the paid tier is unreachable by
 *  design. This is the only way to exercise it, and it stays local to the tests that
 *  are about the paid tier — every other test runs against the shipped policy. */
const WITH_A_BAR: Policy = {
  ...DEFAULT_POLICY,
  group: { ...DEFAULT_POLICY.group, similarityBars: { 'text.v2': 0.9 } },
};

/* ── the weighting rule, already implemented in persistence.ts ────────── */

test('a term present in almost every bucket is weighted to nothing', () => {
  const alwaysThere = new Array<number>(14).fill(40);
  assert.equal(persistence(alwaysThere, DEFAULT_POLICY), 1);
  assert.equal(carrierWeight('hipposeason', 5, alwaysThere, DEFAULT_POLICY), 0);
});

test('a term that spiked in the last two buckets keeps almost all its weight', () => {
  // The case raw document frequency gets backwards: high df today, absent all week.
  const brandNew = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 80, 120];
  const w = carrierWeight('hipposeason', 5, brandNew, DEFAULT_POLICY);

  assert.ok(w > 4, `expected nearly full weight, got ${w}`);
});

test('a generic symbol is worth zero whatever its frequency', () => {
  assert.equal(carrierWeight('$SOL', 9, [0, 0, 1], DEFAULT_POLICY), 0);
});

/* ── ★ todo 1: the free tier settles it without the paid one ──────────── */

test('an item sharing an exact carrier joins with no model call', () => {
  const shared = input({
    item: item({ fingerprints: [TEMPLATE] }),
    candidates: [story({ carriers: [TEMPLATE] })],
    // The representation map is EMPTY. Whatever the embed port is doing, it was not
    // asked, and the join still has to happen.
    similarity: {},
  });

  const d = group(shared, DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'M0_carrier_join');
  assert.equal(d.subjectKind, 'pair');

  // "No model call" stated as strongly as a pure function allows: hand `matchScore` a
  // similarity map that THROWS on any access, and watch the free tier settle the pair
  // without touching it. Passing `{}` proves the join survives an empty map; this
  // proves the map was never consulted in the first place.
  const tripwire: Readonly<Record<string, number>> = new Proxy(
    {},
    {
      get(_target, space) {
        throw new Error(`the free tier read representation space ${String(space)}`);
      },
      ownKeys() {
        throw new Error('the free tier enumerated the representation spaces');
      },
    },
  );

  const scored = matchScore(
    item({ fingerprints: [TEMPLATE] }),
    story({ carriers: [TEMPLATE] }),
    tripwire,
    DEFAULT_POLICY,
  );

  assert.equal(scored.evidence?.kind, 'carrier');
  if (scored.evidence?.kind !== 'carrier') return assert.fail('expected carrier evidence');
  assert.equal(scored.evidence.carrier, 'formatId');
  // Null, not zero. An exact-match kind has no metric, and a zero here would claim we
  // measured something — the store spells the same rule as carrier_distance_needs_a_carrier.
  assert.equal(scored.evidence.distance, null);
});

/* ── ★ todo 2: the outage degrades, it does not stop ──────────────────── */

test('a representation outage degrades grouping to the free tiers, never stops it', () => {
  const carried = {
    item: item({ fingerprints: [TEMPLATE] }),
    candidates: [story({ carriers: [TEMPLATE] })],
  };
  const st = carried.candidates[0];
  if (st === undefined) return assert.fail('fixture');

  // The same input twice: once with the paid tier answering, once with it silent.
  const withPaidTier = group(
    input({ ...carried, similarity: { [st.storyId]: { 'text.v2': 0.97 } } }),
    DEFAULT_POLICY,
    CTX,
  );
  const withOutage = group(input({ ...carried, similarity: {} }), DEFAULT_POLICY, CTX);

  assert.equal(withPaidTier.verdict, 'pass');
  assert.equal(withOutage.verdict, 'pass');
  assert.equal(withPaidTier.reason, withOutage.reason);
  assert.equal(withOutage.reason, 'M0_carrier_join');
  assert.equal(withOutage.score, withPaidTier.score);

  // ...and under a policy where the paid tier IS reachable, the same holds. The free
  // carrier still carries the join, and the paid tier's absence changes nothing about
  // it. This is the half that would break if a representation ever became a
  // precondition rather than a contributor.
  assert.equal(group(input({ ...carried, similarity: {} }), WITH_A_BAR, CTX).reason, 'M0_carrier_join');

  // A pair with NO free carrier is the honest measure of what the paid tier adds: it
  // joins when the tier answers, and falls back to a named drop when it does not.
  // Degraded, and saying so — not an exception, and not a silent zero.
  const bare = { item: item(), candidates: [story()] };
  const bareStory = bare.candidates[0];
  if (bareStory === undefined) return assert.fail('fixture');

  const paidJoin = group(
    input({ ...bare, similarity: { [bareStory.storyId]: { 'text.v2': 0.97 } } }),
    WITH_A_BAR,
    CTX,
  );
  const paidGone = group(input({ ...bare, similarity: {} }), WITH_A_BAR, CTX);

  assert.equal(paidJoin.verdict, 'pass');
  assert.equal(paidJoin.reason, 'M2_semantic_join');
  assert.equal(paidGone.verdict, 'drop');
  assert.equal(paidGone.reason, 'M3_below_match_bar');

  // The log can tell an outage from a dissimilarity, which is the whole reason
  // `representationPresent` is a separate feature from `representationSimilarity`.
  assert.equal(paidJoin.features.representationPresent, 1);
  assert.equal(paidJoin.features.representationSimilarity, 0.97);
  assert.equal(paidGone.features.representationPresent, 0);
  assert.equal(paidGone.features.representationSimilarity, null);

  // And it can tell "we did not need to look" from "we looked and there was nothing".
  assert.equal(withOutage.features.representationConsulted, 0);
  assert.equal(paidGone.features.representationConsulted, 1);
});

/* ── ★ todo 3: inside the band, a human decides ───────────────────────── */

test('two candidates inside the adjudication band go to a human, not to a guess', () => {
  // Two stories the item matches identically. Our ordering between them is noise, and
  // the honest answer is that we cannot tell them apart.
  const twins = input({
    item: item({ fingerprints: [TEMPLATE] }),
    candidates: [
      story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] }),
      story({ storyId: storyId('bbb2'), carriers: [TEMPLATE] }),
    ],
  });

  const d = group(twins, DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'M4_ambiguous_match');
  // Not a join to the higher one. That is the failure this test exists to catch, and
  // it would look identical in every dashboard if the verdict were `pass`.
  assert.notEqual(d.verdict, 'pass');
  // Nor a drop: `abstain` and `drop` are different populations, and merging them
  // poisons every recall number computed over this log.
  assert.notEqual(d.verdict, 'drop');

  const margin = d.features.scoreMargin;
  assert.ok(margin !== null && margin !== undefined && margin < DEFAULT_POLICY.group.adjudicationBand);

  // GROUP never fabricates the human's answer. `{kind:'adjudicated'}` arrives later as
  // data; nothing in this decision claims one was consulted.
  assert.equal(d.decider, 'rule:group@1');

  // Separate the two and the same block joins. The band is about separation, not about
  // there being two of anything.
  const separated = input({
    item: item({ fingerprints: [TEMPLATE] }),
    candidates: [
      story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] }),
      story({ storyId: storyId('bbb2'), carriers: [] }),
    ],
  });
  const joined = group(separated, DEFAULT_POLICY, CTX);
  assert.equal(joined.verdict, 'pass');
  assert.equal(joined.reason, 'M0_carrier_join');
  assert.equal(joined.subjectId, `${itemId(FEED, 'i1')}|${storyId('aaa1')}`);
});

/* ── ★ todo 4: a merge cannot move the clock forward ──────────────────── */

test('a merge always folds into the older story, so earliestPostAt cannot move forward', () => {
  const older = story({
    storyId: storyId('aaa1'),
    earliestPostAt: NOW - 5 * HOUR,
    carriers: [TEMPLATE, NAMED_SPAN],
  });
  const newer = story({
    storyId: storyId('bbb2'),
    earliestPostAt: NOW - 1 * HOUR,
    carriers: [TEMPLATE, NAMED_SPAN, { kind: 'entitySpan', key: 'ferrywatch' }],
  });

  const forwards = planMerge(older, newer, DEFAULT_POLICY);
  const backwards = planMerge(newer, older, DEFAULT_POLICY);

  assert.ok(forwards, 'expected a merge plan');
  assert.ok(backwards, 'expected a merge plan');

  // Idempotent: argument order cannot change the survivor.
  assert.equal(forwards.into.storyId, older.storyId);
  assert.equal(backwards.into.storyId, older.storyId);
  assert.equal(forwards.from.storyId, newer.storyId);
  assert.equal(backwards.from.storyId, newer.storyId);
  assert.equal(forwards.carrierOverlap, backwards.carrierOverlap);

  // The invariant itself. RESOLVE's G2_predates_post gate reads this same field, so a
  // merge that moved it forward would reclassify every asset in the gap from "adopted"
  // to "minted from this story" — retroactively, for decisions already logged.
  assert.ok(forwards.into.earliestPostAt <= forwards.from.earliestPostAt);
  assert.ok(backwards.into.earliestPostAt <= backwards.from.earliestPostAt);
});

test('a merge with equal earliest posts still picks the same survivor every time', () => {
  const a = story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] });
  const b = story({ storyId: storyId('bbb2'), carriers: [TEMPLATE] });

  const first = planMerge(a, b, DEFAULT_POLICY);
  const second = planMerge(b, a, DEFAULT_POLICY);

  assert.ok(first);
  assert.ok(second);
  // Arbitrary, but deterministic. A replay that picked the other one would produce a
  // different graph from the run it claims to reproduce.
  assert.equal(first.into.storyId, second.into.storyId);
  assert.equal(first.into.storyId, storyId('aaa1'));
});

test('a story cannot merge into itself, and a merged story cannot merge again', () => {
  const live = story({ storyId: storyId('aaa1'), carriers: [TEMPLATE, NAMED_SPAN] });

  // no_self_merge, checked before the write rather than after it.
  assert.equal(planMerge(live, live, DEFAULT_POLICY), null);
  assert.equal(planMerge(live, { ...live }, DEFAULT_POLICY), null);

  // ★ THE CYCLE RULE. A story that already points somewhere has its one edge. Giving
  // it a second is how a cycle appears without anyone choosing one, so both directions
  // refuse — a caller holding a merged story must follow the pointer once and re-ask.
  const alreadyMerged = story({
    storyId: storyId('bbb2'),
    state: 'merged',
    mergedInto: storyId('aaa1'),
    carriers: [TEMPLATE, NAMED_SPAN],
  });

  assert.equal(planMerge(alreadyMerged, live, DEFAULT_POLICY), null);
  assert.equal(planMerge(live, alreadyMerged, DEFAULT_POLICY), null);

  // The two-node cycle spelled out: b points at a, and a is now asked to point at b.
  const pointsBack = story({
    storyId: storyId('aaa1'),
    mergedInto: storyId('bbb2'),
    carriers: [TEMPLATE, NAMED_SPAN],
  });
  assert.equal(planMerge(pointsBack, alreadyMerged, DEFAULT_POLICY), null);
  assert.equal(planMerge(alreadyMerged, pointsBack, DEFAULT_POLICY), null);
});

test('a merge needs carriers to compare, and enough of them', () => {
  const bare = story({ storyId: storyId('aaa1'), carriers: [] });
  const also = story({ storyId: storyId('bbb2'), carriers: [] });
  // No basis for comparison is null, not a ratio of zero over zero that compares
  // false to every bar by accident.
  assert.equal(planMerge(bare, also, DEFAULT_POLICY), null);
  assert.equal(planMerge(bare, story({ storyId: storyId('ccc3'), carriers: [TEMPLATE] }), DEFAULT_POLICY), null);

  // One carrier in common out of three on each side is 1/3, under the 0.6 bar.
  const a = story({
    storyId: storyId('aaa1'),
    carriers: [TEMPLATE, { kind: 'entitySpan', key: 'ferrywatch' }, { kind: 'entitySpan', key: 'dockrefusal' }],
  });
  const b = story({
    storyId: storyId('bbb2'),
    carriers: [TEMPLATE, { kind: 'entitySpan', key: 'kitchenquiet' }, { kind: 'entitySpan', key: 'soupline' }],
  });
  assert.equal(planMerge(a, b, DEFAULT_POLICY), null);
});

/* ── promotion is breadth, never volume ───────────────────────────────── */

test('a hundred posts by one account is not a story', () => {
  // The bar an adversary controls directly, refused. One account is buyable by the
  // thousand; a second unconnected author is not.
  assert.equal(
    shouldPromote(story({ memberCount: 100, distinctAuthors: 1, distinctSources: 1 }), DEFAULT_POLICY),
    false,
  );

  // Three posts by three unconnected accounts is.
  assert.equal(
    shouldPromote(story({ memberCount: 3, distinctAuthors: 3, distinctSources: 1 }), DEFAULT_POLICY),
    true,
  );

  // Breadth without volume is still not enough: two authors, two posts.
  assert.equal(
    shouldPromote(story({ memberCount: 2, distinctAuthors: 2, distinctSources: 1 }), DEFAULT_POLICY),
    false,
  );

  // And the exact bar, both sides of it.
  assert.equal(
    shouldPromote(story({ memberCount: 3, distinctAuthors: 2, distinctSources: 1 }), DEFAULT_POLICY),
    true,
  );
  assert.equal(shouldPromote(story({ memberCount: 0, distinctAuthors: 0 }), DEFAULT_POLICY), false);

  // The source clause exists and is readable, even though it passes everything today.
  const strictSources: Policy = {
    ...DEFAULT_POLICY,
    group: { ...DEFAULT_POLICY.group, promoteMinDistinctSources: 2 },
  };
  assert.equal(
    shouldPromote(story({ memberCount: 9, distinctAuthors: 9, distinctSources: 1 }), strictSources),
    false,
  );
});

/* ── the rest of the ladder ───────────────────────────────────────────── */

test('an empty candidate block is an abstain about the item, not a drop', () => {
  const d = group(input({ candidates: [] }), DEFAULT_POLICY, CTX);

  // "We never asked" — there was nothing to ask about. The caller seeds a new
  // candidate story from this item, whose first member carries `seed` evidence.
  assert.equal(d.verdict, 'abstain');
  assert.equal(d.reason, 'M6_no_candidate_block');
  // No pair exists, so the subject is the item. Naming a pair here would invent a
  // second half that does not exist.
  assert.equal(d.subjectKind, 'item');
  assert.equal(d.subjectId, itemId(FEED, 'i1'));
  assert.equal(d.subjectOrigin, NOW - 10 * MINUTE);
  assert.equal(d.features.candidateCount, 0);
  assert.equal(d.features.bestScore, null);
});

test('a shared carrier that weighs nothing is named as such, not as a plain miss', () => {
  // The thirty-nine-post story: every member mentioned the same symbol, and the
  // grouper called that evidence. A zero-weight carrier is a drop with its own code.
  const d = group(
    input({
      item: item({ fingerprints: [GENERIC_SPAN] }),
      candidates: [story({ carriers: [GENERIC_SPAN] })],
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'M5_generic_carrier');
  assert.equal(d.features.carrierWeight, 0);
  // Sharing something worthless is not sharing nothing, and the vector says both.
  assert.equal(d.features.sharedCarrierCount, 1);

  // The same span with a name behind it joins, which is what makes the previous
  // assertion a rule about genericness rather than about entitySpans.
  const named = group(
    input({
      item: item({ fingerprints: [NAMED_SPAN] }),
      candidates: [story({ carriers: [NAMED_SPAN] })],
    }),
    DEFAULT_POLICY,
    CTX,
  );
  assert.equal(named.verdict, 'pass');
  assert.equal(named.reason, 'M0_carrier_join');
});

test('a candidate sharing nothing is a drop we can defend, not an abstain', () => {
  const d = group(input({ candidates: [story()] }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'M3_below_match_bar');
  assert.equal(d.subjectKind, 'pair');
  assert.equal(d.features.sharedCarrierCount, 0);
});

test('a lineage pointer joins on the tier below no tier at all', () => {
  const parent = itemId(OTHER_FEED, 'p1');
  const home = story({ storyId: storyId('aaa1') });

  const d = group(
    input({
      item: item({ reproductionOf: parent }),
      candidates: [home],
      lineage: { via: 'reproduction', toItem: parent, story: home.storyId },
    }),
    DEFAULT_POLICY,
    CTX,
  );

  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'M1_lineage_join');
  assert.equal(d.features.lineagePresent, 1);

  // A pointer into some OTHER story is not evidence about this one, and the vector
  // says "we had a pointer and it went elsewhere" rather than "there was no pointer".
  const elsewhere = group(
    input({
      item: item({ reproductionOf: parent }),
      candidates: [home],
      lineage: { via: 'reproduction', toItem: parent, story: storyId('zzz9') },
    }),
    DEFAULT_POLICY,
    CTX,
  );
  assert.equal(elsewhere.verdict, 'drop');
  assert.equal(elsewhere.features.lineageOffered, 1);
  assert.equal(elsewhere.features.lineagePresent, 0);

  // An item with no pointer at all: null, because "this source publishes no lineage"
  // is a different fact from "this item's lineage points somewhere else".
  const none = group(input({ candidates: [home] }), DEFAULT_POLICY, CTX);
  assert.equal(none.features.lineageOffered, 0);
  assert.equal(none.features.lineagePresent, null);
});

test('a story at its member cap holds the item rather than dropping a correct join', () => {
  const full = story({ carriers: [TEMPLATE], memberCount: DEFAULT_POLICY.group.maxMembersPerInterval });

  const d = group(
    input({ item: item({ fingerprints: [TEMPLATE] }), candidates: [full] }),
    DEFAULT_POLICY,
    CTX,
  );

  // The item belongs here. Dropping it would discard a correct join because of a rate
  // limit, and the recall number would never show it.
  assert.equal(d.verdict, 'hold');
  assert.equal(d.reason, 'M9_member_cap');
  assert.equal(d.features.atMemberCap, 1);
});

/* ── the properties the weight table is chosen for ────────────────────── */

test('corroboration alone cannot carry a join, whatever else agrees', () => {
  const w = DEFAULT_POLICY.group.matchWeights;

  // The property, stated as arithmetic: a pair that agrees on source and was posted at
  // the same instant, and shares NOTHING, cannot reach the bar. Without it a busy hour
  // merges everything posted during it.
  assert.ok(w.sourceAgreement + w.timeProximity < DEFAULT_POLICY.group.matchBar);

  // And the same thing run through the stage: same instant, cross-source story, no
  // shared carrier, no pointer.
  const together = story({ earliestPostAt: NOW - 10 * MINUTE, lastMemberAt: NOW - 10 * MINUTE, distinctSources: 2 });
  const d = group(input({ candidates: [together] }), DEFAULT_POLICY, CTX);

  assert.equal(d.verdict, 'drop');
  assert.equal(d.reason, 'M3_below_match_bar');
  assert.equal(d.features.sourceAgreement, 1);
  assert.equal(d.features.timeProximity, 1);
});

test('every free carrier tier can carry a join on its own, so none of them is a precondition', () => {
  const w = DEFAULT_POLICY.group.matchWeights;
  const bar = DEFAULT_POLICY.group.matchBar;

  // If any one of these fell under the bar, that tier would only ever join in company,
  // and "the free path is the primary path" would quietly stop being true.
  assert.ok(w.imageCarrier >= bar, 'image carrier alone must clear the bar');
  assert.ok(w.textCarrier >= bar, 'text carrier alone must clear the bar');
  assert.ok(w.exactCarrier >= bar, 'exact carrier alone must clear the bar');
  assert.ok(w.lineage >= bar, 'a lineage pointer alone must clear the bar');
  assert.ok(w.representation >= bar, 'the paid tier must be able to settle what the free ones missed');
});

/* ── the replay path ──────────────────────────────────────────────────── */

test('the gate reproduces every non-join reason from the logged vector alone', () => {
  // eval replays a stage through gate(features, policy) and nothing else, because the
  // log carries the vector and not the stage input. If these two ever disagree, a
  // GROUP threshold change becomes untestable against history without anyone noticing.
  const cases: readonly GroupInput[] = [
    input({ candidates: [] }),
    input({ candidates: [story()] }),
    input({
      item: item({ fingerprints: [GENERIC_SPAN] }),
      candidates: [story({ carriers: [GENERIC_SPAN] })],
    }),
    input({
      item: item({ fingerprints: [TEMPLATE] }),
      candidates: [story({ carriers: [TEMPLATE] })],
    }),
    input({
      item: item({ fingerprints: [TEMPLATE] }),
      candidates: [
        story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] }),
        story({ storyId: storyId('bbb2'), carriers: [TEMPLATE] }),
      ],
    }),
    input({
      item: item({ fingerprints: [TEMPLATE] }),
      candidates: [
        story({ carriers: [TEMPLATE], memberCount: DEFAULT_POLICY.group.maxMembersPerInterval }),
      ],
    }),
  ];

  for (const c of cases) {
    const d = group(c, DEFAULT_POLICY, CTX);
    const blocked = gate(d.features, DEFAULT_POLICY);
    if (d.verdict === 'pass') {
      assert.equal(blocked, null, `gate blocked a pass with ${blocked}`);
    } else {
      assert.equal(blocked, d.reason, `gate and stage disagree on ${d.reason}`);
    }
  }
});

/* ── the three clocks ─────────────────────────────────────────────────── */

test('the pair is dated from the story it would join, never from the clock', () => {
  const home = story({ earliestPostAt: NOW - 3 * HOUR, lastMemberAt: NOW - 2 * MINUTE, carriers: [TEMPLATE] });
  const d = group(
    input({ item: item({ fingerprints: [TEMPLATE] }), candidates: [home] }),
    DEFAULT_POLICY,
    CTX,
  );

  // subjectOrigin is when the THING began — the story's earliest post. A story that
  // starts accreting today may have begun three hours ago, and horizonS measured from
  // the wrong end is the column that answers "how early were we" incorrectly for ever.
  assert.equal(d.subjectOrigin, NOW - 3 * HOUR);
  assert.equal(d.horizonS, (3 * HOUR) / 1000);

  // featureAsOf is the newest datum the decider was ALLOWED to see, across BOTH halves
  // of the pair. Here the story's last member is fresher than our first sight of the
  // item, so it is the one that dates the decision.
  assert.equal(d.featureAsOf, NOW - 2 * MINUTE);
  assert.equal(d.decidedAt, NOW);
  assert.ok(d.featureAsOf <= d.decidedAt);

  // And the other way round: a quiet story and a freshly seen item are dated from the
  // item. Taking only the story's clock would understate what the decider had seen,
  // which is lookahead's mirror image and just as unfindable later.
  const quiet = group(
    input({
      item: item({ fingerprints: [TEMPLATE] }),
      candidates: [story({ lastMemberAt: NOW - 30 * MINUTE, carriers: [TEMPLATE] })],
    }),
    DEFAULT_POLICY,
    CTX,
  );
  assert.equal(quiet.featureAsOf, NOW - 5 * MINUTE);

  // The policy in force rides on the row, or nothing decided under it is auditable
  // once a threshold moves.
  assert.equal(d.policyHash, 'test-policy-hash');
  assert.equal(d.propensity, 1);
});

/* ── absence is never a defaulted zero ────────────────────────────────── */

test('an item that carries no fingerprint of a kind says so, and does not say zero', () => {
  const d = group(
    input({ item: item({ fingerprints: [TEMPLATE] }), candidates: [story({ carriers: [TEMPLATE] })] }),
    DEFAULT_POLICY,
    CTX,
  );

  // No adapter can compute an image hash today. An item with none has told us nothing
  // about images; a defaulted zero would teach a model that it is image-dissimilar to
  // everything, which is a claim nobody made.
  assert.equal(d.features.imageCarrierOffered, 0);
  assert.equal(d.features.imageCarrierShared, null);
  assert.equal(d.features.imageCarrierDistance, null);

  // The kind it does carry answers positively, and the exact kinds carry no distance
  // because they have no metric.
  assert.equal(d.features.exactCarrierOffered, 1);
  assert.equal(d.features.exactCarrierShared, 1);

  // A source that omits the post time gets a null proximity, not a zero one — the
  // difference between "we were not told when" and "it was posted a week away".
  const undated = group(
    input({
      item: item({ postedAt: null, fingerprints: [TEMPLATE] }),
      candidates: [story({ carriers: [TEMPLATE] })],
    }),
    DEFAULT_POLICY,
    CTX,
  );
  assert.equal(undated.features.timeProximity, null);
  assert.equal(undated.features.timeGapMin, null);
  assert.equal(undated.verdict, 'pass');
  assert.equal(undated.subjectOrigin, story().earliestPostAt);
});

test('an item with no post time and no candidates has a null origin, never the clock', () => {
  const d = group(input({ item: item({ postedAt: null }), candidates: [] }), DEFAULT_POLICY, CTX);
  assert.equal(d.subjectOrigin, null);
  assert.equal(d.horizonS, null);
});

/* ── ★ the adversarial pass: five things that were true before it ─────── */

test('a dropped pair still records its runner-up, so a lowered bar replays as ambiguous', () => {
  // ★ THE HOLE THIS CLOSES. `gate()` exists so a threshold change can be tested against
  // history, and history is the logged vector — nothing else. `rejected` used to carry
  // no runner-up, so a dropped block logged `secondScore: null, scoreMargin: null`, and
  // on replay under a lower `matchBar` the M4 test was skipped for want of a margin.
  // `gate` returned null. Null means join. "We cannot tell these two apart" came back
  // from the replay as "join the higher one", which is the single collapse the
  // three-outcome union was built to make impossible.
  const twins = input({
    candidates: [
      story({ storyId: storyId('aaa1'), distinctSources: 2 }),
      story({ storyId: storyId('bbb2'), distinctSources: 2 }),
    ],
  });

  const f = extract(twins, DEFAULT_POLICY, CTX);

  // Corroboration only: under the shipped bar this is a drop, and the drop is right.
  assert.equal(gate(f, DEFAULT_POLICY), 'M3_below_match_bar');
  assert.equal(group(twins, DEFAULT_POLICY, CTX).reason, 'M3_below_match_bar');

  // The runner-up is on the row even though we dropped the pair.
  assert.equal(f.secondScore, f.bestScore);
  assert.equal(f.scoreMargin, 0);

  // ★ And now the replay the whole gate/vector split exists for. Move the bar under
  // both candidates and the answer must become "a human decides", never a join.
  const lowered: Policy = {
    ...DEFAULT_POLICY,
    group: { ...DEFAULT_POLICY.group, matchBar: 0.1 },
  };
  assert.equal(gate(f, lowered), 'M4_ambiguous_match');
  assert.notEqual(gate(f, lowered), null);
});

test('the pair score has no ceiling, because a ceiling invents ties inside the band', () => {
  // The seven weights sum to 2.05. Clamping the score to [0,1] before ranking meant any
  // two candidates whose evidence saturated compared EQUAL, and a margin of exactly
  // zero is inside every adjudication band there will ever be. A decisive join was
  // filed as "we cannot tell" — and it would look identical to a real ambiguity in
  // every dashboard.
  const image: Fingerprint = { kind: 'imageHash', key: 'a'.repeat(64), bits: 256 };
  const priorItem = itemId(FEED, 'i0');

  const strong = story({ storyId: storyId('aaa1'), distinctSources: 2, carriers: [image, TEMPLATE] });
  const weaker = story({ storyId: storyId('bbb2'), distinctSources: 2, carriers: [image, TEMPLATE] });

  const d = group(
    input({
      item: item({ fingerprints: [image, TEMPLATE], reproductionOf: priorItem }),
      candidates: [strong, weaker],
      // Only ONE of the two holds the item this one says it reproduces.
      lineage: { via: 'reproduction', toItem: priorItem, story: strong.storyId },
    }),
    DEFAULT_POLICY,
    CTX,
  );

  const best = d.features.bestScore ?? null;
  const second = d.features.secondScore ?? null;
  assert.ok(best !== null && best > 1, `expected an uncapped score, got ${best}`);
  assert.ok(second !== null && second > 1, `expected an uncapped runner-up, got ${second}`);

  // The lineage weight is 0.6 and the band is 0.05, so the separation is real and large.
  assert.equal(d.features.scoreMargin, best - second);
  // The separation IS the lineage weight, and it is twelve times the adjudication band.
  const margin = d.features.scoreMargin ?? 0;
  assert.ok(
    margin > DEFAULT_POLICY.group.adjudicationBand,
    `a clamped score would have made this 0; got ${margin}`,
  );
  assert.equal(d.verdict, 'pass');
  assert.equal(d.reason, 'M1_lineage_join');
  assert.equal(d.subjectId, `${itemId(FEED, 'i1')}|${storyId('aaa1')}`);
});

test('a merge needs carriers that are worth something, not merely present', () => {
  // ★ The thirty-nine-post story at STORY granularity. `$SOL` is on the by-nature list
  // and weighs exactly zero, so it cannot admit a member — and until this pass it could
  // still fold two entire unrelated stories into one, because the overlap ratio counted
  // presence and never asked what the shared thing was worth.
  const a = story({ storyId: storyId('aaa1'), earliestPostAt: NOW - 5 * HOUR, carriers: [GENERIC_SPAN] });
  const b = story({ storyId: storyId('bbb2'), carriers: [GENERIC_SPAN] });
  assert.equal(planMerge(a, b, DEFAULT_POLICY), null);

  // The same is true by WEAR and not only by nature: a carrier present in all fourteen
  // daily buckets weighs zero too, and a corpus that says so must reach the merge rule.
  const everywhere: Fingerprint = { kind: 'entitySpan', key: 'ferrywatch' };
  // Built with corpusKey, never by hand: the separator is a NUL, and a hand-spelled
  // key misses silently and weights a fourteen-day background term at full strength.
  const background = { [corpusKey(everywhere)]: { idf24h: 1, dfByBucket: new Array<number>(14).fill(40) } };
  const c = story({ storyId: storyId('ccc3'), earliestPostAt: NOW - 5 * HOUR, carriers: [everywhere] });
  const e = story({ storyId: storyId('ddd4'), carriers: [everywhere] });
  assert.ok(planMerge(c, e, DEFAULT_POLICY), 'with no corpus it is an unknown carrier at full weight');
  assert.equal(planMerge(c, e, DEFAULT_POLICY, background), null);

  // ★ AND THE DENOMINATOR IS FILTERED TOO, which is the half an adversary reaches for.
  // Padding a story with worthless carriers must not dilute its share below the bar and
  // buy it immunity from being merged away.
  const padding: readonly Fingerprint[] = new Array<Fingerprint>(40).fill(GENERIC_SPAN);
  const real = story({ storyId: storyId('aaa1'), earliestPostAt: NOW - 5 * HOUR, carriers: [NAMED_SPAN] });
  const padded = story({ storyId: storyId('bbb2'), carriers: [NAMED_SPAN, ...padding] });
  const plan = planMerge(real, padded, DEFAULT_POLICY);
  assert.ok(plan, 'forty stock symbols bought the decoy immunity from the merge sweep');
  assert.equal(plan.into.storyId, real.storyId);
  assert.equal(plan.carrierOverlap, 1);
});

test('an uninterpretable similarity is still written down, or no bar can ever be fit', () => {
  // ★ THE BOOTSTRAP DEADLOCK. `similarityBars` ships as `{}`, so no space is
  // interpretable, so `representationSimilarity` is null on every row — including rows
  // where the embed port answered 0.97. A bar is fit from logged similarities. Logging
  // similarities only once a bar exists means no bar is ever fit, and the paid tier
  // stays permanently unreachable for a reason nobody typed on purpose.
  const st = story();
  const answered = extract(
    input({ candidates: [st], similarity: { [st.storyId]: { 'text.v2': 0.97 } } }),
    DEFAULT_POLICY,
    CTX,
  );

  // Not comparable, contributes nothing, cannot be evidence — all unchanged.
  assert.equal(answered.representationPresent, 0);
  assert.equal(answered.representationSimilarity, null);
  // ...and recorded anyway.
  assert.equal(answered.representationObserved, 0.97);

  // An outage is the other value, and that is the point: `present: 0` alone cannot tell
  // "the port is down" from "the port answered in a space we never calibrated".
  const outage = extract(input({ candidates: [st], similarity: {} }), DEFAULT_POLICY, CTX);
  assert.equal(outage.representationPresent, 0);
  assert.equal(outage.representationObserved, null);
  assert.notEqual(answered.representationObserved, outage.representationObserved);

  // Under a policy that DOES calibrate the space, both keys carry the number.
  const calibrated = extract(
    input({ candidates: [st], similarity: { [st.storyId]: { 'text.v2': 0.97 } } }),
    WITH_A_BAR,
    CTX,
  );
  assert.equal(calibrated.representationPresent, 1);
  assert.equal(calibrated.representationSimilarity, 0.97);
  assert.equal(calibrated.representationObserved, 0.97);
});

test('the default pair context cannot be filled in by anybody, at any depth', () => {
  // `Object.freeze` is shallow, and this value is exported and shared by every
  // default-argument call in match.ts. A writable `corpus` on it is hidden mutable
  // module state wearing a `readonly` type: one assignment anywhere in the process
  // reweights every replay that believed it was running against no corpus at all.
  assert.ok(Object.isFrozen(NO_PAIR_CONTEXT));
  assert.ok(Object.isFrozen(NO_PAIR_CONTEXT.corpus));
});

test('the ranking is a total order, so the block size cannot change the answer', () => {
  // A comparator that answers 1 for `compare(x, x)` is not a total order — it claims an
  // element sorts after itself — and V8 switches sort algorithms at 22 elements, so an
  // inconsistent one can order a long block differently from a short one built of the
  // same pairs. Nothing in the types stops a candidate block holding one story twice.
  const one = story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] });
  const two = story({ storyId: storyId('bbb2'), carriers: [TEMPLATE] });
  const bare = story({ storyId: storyId('ccc3'), carriers: [] });

  const shapes: readonly (readonly Story[])[] = [
    [one, two, bare],
    [bare, two, one],
    // The same block padded past V8's insertion-sort cutoff with duplicate story ids.
    [...new Array<Story>(20).fill(one), two, bare, ...new Array<Story>(20).fill(two)],
    [bare, ...new Array<Story>(20).fill(two), ...new Array<Story>(20).fill(one), two],
  ];

  const answers = shapes.map((candidates) => {
    const d = group(input({ item: item({ fingerprints: [TEMPLATE] }), candidates }), DEFAULT_POLICY, CTX);
    return `${d.verdict}/${d.reason}/${d.features.bestScore}/${d.features.scoreMargin}`;
  });

  // Every one of them is the same block. Two carrier-sharing stories we cannot separate
  // is an abstain, whatever order or multiplicity they arrived in.
  for (const answer of answers) assert.equal(answer, answers[0]);
  assert.ok(answers[0]?.startsWith('abstain/M4_ambiguous_match/'), answers[0]);
});

test('a chain of merges still ends at the earliest story, however long it gets', () => {
  // ★ CHAINS ARE CONSTRUCTIBLE, and core cannot stop them. `planMerge` refuses a story
  // that ALREADY points somewhere, which forecloses a cycle — but it cannot refuse a
  // live survivor merging on into a third story later, and that is a legitimate merge.
  // So `a → b` followed by `b → c` leaves `a` two hops from its survivor, and neither
  // the schema (`no_self_merge` and `merged_points_somewhere` are the only two
  // constraints) nor this function makes `mergedInto` follow-once.
  //
  // What must survive that is the clock, because RESOLVE's G2_predates_post gate reads
  // `earliestPostAt` and a merge that moved it forward silently reclassifies every
  // asset in the gap. It does survive: every hop is into a strictly older story, so the
  // chain is monotonic and its end is the earliest story of all of them.
  const shared: readonly Fingerprint[] = [TEMPLATE, NAMED_SPAN];
  const newest = story({ storyId: storyId('aaa1'), earliestPostAt: NOW - 1 * HOUR, carriers: [...shared] });
  const middle = story({ storyId: storyId('bbb2'), earliestPostAt: NOW - 3 * HOUR, carriers: [...shared] });
  const oldest = story({ storyId: storyId('ccc3'), earliestPostAt: NOW - 9 * HOUR, carriers: [...shared] });

  const first = planMerge(newest, middle, DEFAULT_POLICY);
  assert.ok(first);
  assert.equal(first.into.storyId, middle.storyId);

  // `middle` survived and is still live, so it may merge on. This is the second hop.
  const merged = { ...newest, state: 'merged' as const, mergedInto: middle.storyId };
  const second = planMerge(middle, oldest, DEFAULT_POLICY);
  assert.ok(second);
  assert.equal(second.into.storyId, oldest.storyId);

  // The chain: aaa1 → bbb2 → ccc3. Monotonically older at every hop, so the earliest
  // post time at the end of the chain is the earliest of all three.
  assert.ok(first.into.earliestPostAt < newest.earliestPostAt);
  assert.ok(second.into.earliestPostAt < first.into.earliestPostAt);
  assert.equal(second.into.earliestPostAt, oldest.earliestPostAt);

  // And the node that already has its one edge is refused a second, in both directions,
  // which is what keeps the chain a chain rather than a cycle.
  assert.equal(planMerge(merged, oldest, DEFAULT_POLICY), null);
  assert.equal(planMerge(oldest, merged, DEFAULT_POLICY), null);
});

test('the same block decided twice produces byte-identical decisions', () => {
  // Replay is the property everything else in this package is built to protect, so it
  // gets an assertion rather than an argument. Two runs over the same inputs, compared
  // whole — features, verdict, reason, score, subject and horizon.
  const image: Fingerprint = { kind: 'imageHash', key: 'f0e1'.repeat(16), bits: 256 };
  const near: Fingerprint = { kind: 'imageHash', key: `f0e1${'f0e1'.repeat(14)}f0e0`, bits: 256 };
  const text: Fingerprint = { kind: 'textShingle', key: 'abcd1234abcd1234', bits: 64 };

  const blocks: readonly GroupInput[] = [
    input({
      item: item({ fingerprints: [image, text, GENERIC_SPAN] }),
      candidates: [
        story({ storyId: storyId('aaa1'), carriers: [near, GENERIC_SPAN] }),
        story({ storyId: storyId('bbb2'), carriers: [text], distinctSources: 2 }),
        story({ storyId: storyId('ccc3'), carriers: [GENERIC_SPAN] }),
      ],
      similarity: { [storyId('bbb2')]: { 'text.v2': 0.94, 'image.v1': 0.94 } },
      corpus: { [corpusKey(GENERIC_SPAN)]: { idf24h: 9, dfByBucket: new Array<number>(14).fill(40) } },
    }),
    input({ item: item({ fingerprints: [] }), candidates: [] }),
    input({
      item: item({ fingerprints: [TEMPLATE] }),
      candidates: [story({ storyId: storyId('aaa1'), carriers: [TEMPLATE] }), story({ storyId: storyId('bbb2'), carriers: [TEMPLATE] })],
    }),
  ];

  for (const block of blocks) {
    const first = JSON.stringify(group(block, WITH_A_BAR, CTX));
    const second = JSON.stringify(group(block, WITH_A_BAR, CTX));
    assert.equal(first, second);
    // ...and the vector alone reaches the same verdict, which is what the replay in
    // eval/ actually runs. `gate` returning null is the join.
    const f = extract(block, WITH_A_BAR, CTX);
    const reason = gate(f, WITH_A_BAR);
    const decided = group(block, WITH_A_BAR, CTX);
    assert.equal(reason === null ? 'pass' : reason, decided.verdict === 'pass' ? 'pass' : decided.reason);
  }
});
