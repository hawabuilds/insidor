/**
 * The picture evidence: an edited copy of the same image joins; a different subject that
 * merely looks alike does not; and likely-the-same needs a shared name to count.
 *
 * The similarities are the numbers GROUP reads off stored embeddings. The tests in e2e/ run
 * the same cases from vectors through the store; these pin the rule itself.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { matchScore } from './match.ts';
import { nameKey, readPicture } from './picture.ts';

const P = DEFAULT_POLICY;
const SPACE = P.group.image.space;
const NOW = 1_800_000_000_000;
const X = sourceId('x');
const STORY = storyId('jimothy');

const raccoonPost: Item = {
  itemId: itemId(X, '2'), source: X, sourceItemId: '2', origin: 'observed', authorKey: authorKey(X, 'b'),
  postedAt: NOW - 60_000, firstSeenAt: NOW, lang: 'en', text: 'lmao look at him go', media: [], counters: {},
  fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: 'x/2',
};

const story: Story = {
  storyId: STORY, state: 'promoted', origin: 'observed', createdAt: NOW - 3_600_000, promotedAt: NOW - 3_000_000,
  earliestPostAt: NOW - 3_600_000, lastMemberAt: NOW - 600_000, memberCount: 4, distinctAuthors: 3, distinctSources: 1,
  carriers: [], mergedInto: null,
};

const named = (itemNames: string[], confirmed = false) => ({
  lineage: null,
  corpus: {},
  picture: { itemNames, storyNames: { [STORY]: ['Jimothy', 'raccoon in a red cap'] }, confirmed: { [STORY]: confirmed } },
});

test('★ a cropped and captioned copy of the same picture joins, with the evidence that joined it', () => {
  // The same raccoon photo, cropped and with a caption bar: likely the same subject, and the
  // judge called the post "Jimothy" too.
  const result = matchScore(raccoonPost, story, { [SPACE]: 0.9 }, P, named(['Jimothy!']));
  assert.ok(result.score >= P.group.matchBar, `score ${result.score}`);
  assert.equal(result.evidence?.kind, 'nameImage');
  assert.equal(result.evidence?.kind === 'nameImage' ? result.evidence.name : null, 'jimothy');
});

test('★ a different raccoon does not join, even with a familiar look and a judge asked', () => {
  // Another raccoon: borderline-similar, the judge said "no", and the post is named differently.
  const result = matchScore(raccoonPost, story, { [SPACE]: 0.76 }, P, named(['Trash panda at the bins'], false));
  assert.ok(result.score < P.group.matchBar, `score ${result.score}`);
  assert.equal(result.evidence, null);
});

test('★ likely the same picture with no shared name is not evidence; neither is a name with no picture', () => {
  assert.equal(readPicture(STORY, { [SPACE]: 0.9 }, named(['some other name']).picture, P).kind, null);
  assert.equal(readPicture(STORY, {}, named(['Jimothy']).picture, P).kind, null);
});

test('a borderline picture counts only when the judge said yes — and still needs the name', () => {
  assert.equal(readPicture(STORY, { [SPACE]: 0.76 }, named(['Jimothy'], true).picture, P).kind, 'nameImage');
  assert.equal(readPicture(STORY, { [SPACE]: 0.76 }, named(['Jimothy'], false).picture, P).kind, null);
  assert.equal(readPicture(STORY, { [SPACE]: 0.6 }, named(['Jimothy'], true).picture, P).kind, null, 'below borderline is never asked about');
});

test('★ the same image, edited, joins on its own like a near-copy', () => {
  const result = matchScore(raccoonPost, story, { [SPACE]: 0.97 }, P, named([]));
  assert.ok(result.score >= P.group.matchBar);
  assert.equal(result.evidence?.kind, 'representation');
});

test('names are compared normalised', () => {
  assert.equal(nameKey('  Jímothy!! '), 'jimothy');
  assert.equal(nameKey('Chill-Guy'), 'chill guy');
});
