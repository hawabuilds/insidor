/**
 * The judge's name as a carrier: carried only when the post says it, keyed so a hashtag and
 * the spelled-out name are one key, and refused for a bare short word or an old post.
 *
 * The texts are today's real posts (2026-10-12/13), cut short. The last test runs the pair
 * through `matchScore` so the join is pinned end to end, not only the key.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { Story } from '@insidor/contracts/story.ts';
import type { Item } from '@insidor/contracts/vocabulary.ts';

import { matchScore } from './match.ts';
import { nameCarriers, nameSpanKey, withNameCarriers } from './name-span.ts';

const P = DEFAULT_POLICY;
const NOW = 1_800_000_000_000;
const X = sourceId('x');
const DAY = P.group.name.maxPostAgeMs;

function post(id: string, text: string, over: Partial<Item> = {}): Item {
  return {
    itemId: itemId(X, id), source: X, sourceItemId: id, origin: 'observed', authorKey: authorKey(X, `a${id}`),
    postedAt: NOW - 60_000, firstSeenAt: NOW, lang: 'en', text, media: [], counters: {},
    fingerprints: [], rebroadcastOf: null, reproductionOf: null, formatIds: [], rawRef: `x/${id}`, ...over,
  };
}

const keys = (item: Item, names: string[]) => nameCarriers(item, names, P).map((f) => f.key);

test('a name written in the post is carried; one read off the picture is not', () => {
  assert.deepEqual(keys(post('1', 'WILLIAM CONTRERAS HOMER AND THIS GAME IS TIED AGAIN'), ['William Contreras']), [
    nameSpanKey('William Contreras'),
  ]);
  // The pig is in the picture, not the words: two posts the judge called "smiling pig" may be two pigs.
  assert.deepEqual(keys(post('2', 'A smile for your timeline..'), ['SMILING PIG']), []);
});

test("★ a hashtag and the spelled-out name are one key: #AndysHole is Andy's Hole", () => {
  const tag = keys(post('3', 'Update on the balls in #AndysHole'), ["Andy's Hole"]);
  const words = keys(post('4', "the swamp that is Andy's Hole"), ["Andy's Hole"]);
  assert.equal(tag.length, 1);
  assert.deepEqual(tag, words);
});

test('the words must appear whole and in order, so "pig" is not found inside "pigeon"', () => {
  assert.deepEqual(keys(post('5', 'a new viral gif of a trench pigeon'), ['TRENCH PIG']), []);
});

test('a bare short word is not a name: under minChars it carries nothing', () => {
  assert.ok('pig'.length < P.group.name.minChars);
  assert.deepEqual(keys(post('6', 'couch pig has claimed the couch'), ['PIG']), []);
});

test('★ an old post resurfacing today carries no name, so it cannot join a new story that shares one', () => {
  // The Goliath case: a days-old expedition post found today, named like the roller coaster.
  const old = post('7', 'Karl and the Goliath expedition', { postedAt: NOW - DAY - 1 });
  assert.deepEqual(keys(old, ['GOLIATH']), []);
  assert.equal(keys(post('8', 'falls from the Goliath roller coaster'), ['GOLIATH']).length, 1);
});

test('a post with no names, or names it already carries, comes back unchanged', () => {
  const plain = post('9', 'nothing named here');
  assert.equal(withNameCarriers(plain, [], P), plain);
  const carried = post('10', 'Goliath', { fingerprints: [{ kind: 'entitySpan', key: nameSpanKey('Goliath') }] });
  assert.equal(withNameCarriers(carried, ['GOLIATH'], P), carried);
});

test('★ two posts that both say the judged name join on it, with carrier evidence', () => {
  const first = withNameCarriers(post('11', 'Man dies after falling out of the Goliath roller coaster'), ['GOLIATH'], P);
  const second = withNameCarriers(post('12', 'falls to his death from the 200-foot-tall "Goliath" roller coaster'), ['GOLIATH'], P);
  const story: Story = {
    storyId: storyId('seed-x-11'), state: 'candidate', origin: 'observed', createdAt: NOW - 600_000, promotedAt: null,
    earliestPostAt: NOW - 600_000, lastMemberAt: NOW - 600_000, memberCount: 1, distinctAuthors: 1, distinctSources: 1,
    carriers: first.fingerprints, mergedInto: null,
  };
  const scored = matchScore(second, story, {}, P);
  assert.ok(scored.score >= P.group.matchBar);
  assert.equal(scored.evidence?.kind, 'carrier');
  assert.equal(scored.evidence?.kind === 'carrier' ? scored.evidence.key : null, nameSpanKey('Goliath'));
});

test('★ an explicit "not the same subject" from the judge outranks a shared name', () => {
  // The second raccoon is also called Jimothy, and says so; the judge, shown both pictures, said no.
  const story: Story = {
    storyId: storyId('jimothy'), state: 'promoted', origin: 'observed', createdAt: NOW - 600_000, promotedAt: NOW - 300_000,
    earliestPostAt: NOW - 600_000, lastMemberAt: NOW - 300_000, memberCount: 3, distinctAuthors: 3, distinctSources: 1,
    carriers: [{ kind: 'entitySpan', key: nameSpanKey('Jimothy') }], mergedInto: null,
  };
  const other = withNameCarriers(post('13', 'my raccoon is also called jimothy'), ['Jimothy'], P);
  const asked = (denied: boolean) => ({ lineage: null, corpus: {}, picture: { itemNames: ['Jimothy'], storyNames: {}, confirmed: {}, denied: { [story.storyId]: denied } } });
  assert.ok(matchScore(other, story, {}, P, asked(false)).score >= P.group.matchBar);
  assert.ok(matchScore(other, story, {}, P, asked(true)).score < P.group.matchBar);
});
