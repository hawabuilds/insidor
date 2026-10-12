/**
 * What a GROUP decision owes the store, as the claims the rows have to satisfy: a seeded
 * story says where it came from and cannot be seeded twice, a join records its evidence,
 * and promotion follows the breadth bar and nothing else.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Fingerprint, Item } from '@insidor/contracts/vocabulary.ts';

import { afterMembership, carriersWith, joinMember, seedStory } from './membership.ts';
import { joinTarget, type GroupInput } from './stage.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const FEED = sourceId('feed-a');
const TEMPLATE: Fingerprint = { kind: 'formatId', key: 'template-nine-second-clip' };
const SPAN: Fingerprint = { kind: 'entitySpan', key: 'hipposeason' };

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(FEED, id),
    source: FEED,
    sourceItemId: id,
    origin: 'observed',
    authorKey: authorKey(FEED, `a-${id}`),
    postedAt: NOW - 10 * MINUTE,
    firstSeenAt: NOW - 5 * MINUTE,
    lang: null,
    text: 'the hippo will not leave the pool',
    media: [],
    counters: {},
    fingerprints: [TEMPLATE],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `local:test/${id}`,
    ...over,
  };
}

function story(over: Partial<Story> = {}): Story {
  return {
    storyId: storyId('aaa1'),
    state: 'candidate',
    origin: 'observed',
    createdAt: NOW - MINUTE,
    promotedAt: null,
    earliestPostAt: NOW - 10 * MINUTE,
    lastMemberAt: NOW - MINUTE,
    memberCount: 1,
    distinctAuthors: 1,
    distinctSources: 1,
    carriers: [TEMPLATE],
    mergedInto: null,
    ...over,
  };
}

test('a seeded story is a one-member candidate whose first member says it was the seed', () => {
  const { story: seeded, member } = seedStory(item('p1'), NOW);
  assert.equal(seeded.state, 'candidate');
  assert.equal(seeded.promotedAt, null);
  assert.equal(seeded.memberCount, 1);
  assert.deepEqual(seeded.carriers, [TEMPLATE]);
  assert.deepEqual(member.evidence, { kind: 'seed' });
  assert.equal(member.storyId, seeded.storyId);
});

test('★ a seeded story takes its origin from the post, so a fixture post never seeds a real story', () => {
  assert.equal(seedStory(item('p1'), NOW).story.origin, 'observed');
  assert.equal(seedStory(item('p1', { origin: 'fixture' }), NOW).story.origin, 'fixture');
});

test('★ seeding the same post twice names the same story, so a retry cannot make a second one', () => {
  assert.equal(seedStory(item('p1'), NOW).story.storyId, seedStory(item('p1'), NOW + MINUTE).story.storyId);
  assert.notEqual(seedStory(item('p1'), NOW).story.storyId, seedStory(item('p2'), NOW).story.storyId);
});

test('a post with no post time anchors the story at first sight, which is later and never earlier', () => {
  const seen = item('p1', { postedAt: null });
  assert.equal(seedStory(seen, NOW).story.earliestPostAt, seen.firstSeenAt);
});

test('a join writes the evidence the match found, onto the story it found', () => {
  const target = story();
  const input: GroupInput = {
    item: item('p2'),
    candidates: [target],
    similarity: {},
    lineage: null,
    corpus: {},
    costUsd: 0,
  };
  const match = joinTarget(input, DEFAULT_POLICY);
  assert.ok(match, 'a shared template is a join on its own');
  const member = joinMember(input.item, match, NOW);
  assert.equal(member.storyId, target.storyId);
  assert.equal(member.evidence.kind, 'carrier');
});

test('an empty block has no join target', () => {
  const input: GroupInput = { item: item('p1'), candidates: [], similarity: {}, lineage: null, corpus: {}, costUsd: 0 };
  assert.equal(joinTarget(input, DEFAULT_POLICY), null);
});

test("a joining post adds the carriers the story did not have, and only those", () => {
  const grown = carriersWith(story(), item('p2', { fingerprints: [TEMPLATE, SPAN] }));
  assert.deepEqual(grown, [TEMPLATE, SPAN]);
  const same = story();
  assert.equal(carriersWith(same, item('p3')), same.carriers);
});

test('★ promotion follows the breadth bar: enough posts from enough people, and not before', () => {
  const p = DEFAULT_POLICY.group;
  const narrow = story({ memberCount: p.promoteMinMembers, distinctAuthors: p.promoteMinDistinctAuthors - 1 });
  assert.equal(afterMembership(narrow, item('p2'), DEFAULT_POLICY, NOW).state, 'candidate');

  const broad = story({
    memberCount: p.promoteMinMembers,
    distinctAuthors: p.promoteMinDistinctAuthors,
    distinctSources: p.promoteMinDistinctSources,
  });
  const promoted = afterMembership(broad, item('p2'), DEFAULT_POLICY, NOW);
  assert.equal(promoted.state, 'promoted');
  assert.equal(promoted.promotedAt, NOW);
});

test('a story already promoted keeps the time it was promoted', () => {
  const earlier = NOW - 30 * MINUTE;
  const promoted = story({ state: 'promoted', promotedAt: earlier, memberCount: 9, distinctAuthors: 9 });
  assert.equal(afterMembership(promoted, item('p2'), DEFAULT_POLICY, NOW).promotedAt, earlier);
});
