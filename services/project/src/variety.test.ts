/**
 * For You's variety rule (variety.ts): one topic takes at most a few cards in any run of twenty,
 * the strongest of it keeps the places, the order is never changed, and a topic is joined by a
 * story, a normalised name or alike meaning — not by a story alone, which launch-day posts lacked.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { topicName, topicsOf, withVariety, type TopicFacts, type VarietyCard } from './variety.ts';

test('names normalise: GTA6, GTA VI, gta-6 and GTAVI are one topic; other names stay apart', () => {
  for (const n of ['GTA6', 'GTA VI', 'gta-6', 'GTAVI', 'Gta 6']) assert.equal(topicName(n), 'GTA6', n);
  assert.equal(topicName('ROADSTER'), 'ROADSTER');
  assert.equal(topicName('Justice'), 'JUSTICE');
  assert.equal(topicName('  '), null);
  assert.equal(topicName(null), null);
  assert.notEqual(topicName('GTA5'), topicName('GTA6'));
});

const card = (id: string, at: number, views: number | null): VarietyCard => ({ id, at, views });
const check = (list: readonly VarietyCard[], topic: ReadonlyMap<string, string>, per: number, win: number) => {
  for (let i = 0; i < list.length; i += 1) {
    const counts = new Map<string, number>();
    for (const c of list.slice(i, i + win)) counts.set(topic.get(c.id) ?? c.id, (counts.get(topic.get(c.id) ?? c.id) ?? 0) + 1);
    for (const n of counts.values()) assert.ok(n <= per, `window at ${i} holds ${n}`);
  }
};

test('★ at most three of one topic in any twenty consecutive cards; the order is unchanged', () => {
  /* 30 cards newest first: 22 about one game, 8 about other things. */
  const cards = Array.from({ length: 30 }, (_, i) => card(i % 4 === 0 ? `other${i}` : `game${i}`, 1000 - i, 100 + i));
  const topic = new Map(cards.map((c) => [c.id, c.id.startsWith('game') ? 'game' : c.id] as const));
  const out = withVariety(cards, topic, 3, 20);
  check(out, topic, 3, 20);
  /* Every other post keeps its place, and the list is still newest first. */
  for (const c of cards.filter((c) => !c.id.startsWith('game'))) assert.ok(out.includes(c), c.id);
  assert.deepEqual(out, [...out].sort((a, b) => b.at - a.at));
});

test('★ the strongest posts of a crowded topic keep the places, not merely the newest', () => {
  const cards = [card('g1', 10, 5), card('g2', 9, 50_000), card('g3', 8, 10), card('g4', 7, 900_000), card('g5', 6, 3), card('g6', 5, 70_000)];
  const topic = new Map(cards.map((c) => [c.id, 'game'] as const));
  assert.deepEqual(withVariety(cards, topic, 3, 20).map((c) => c.id), ['g2', 'g4', 'g6']);
});

test('a post whose views we have not read is last in line for a crowded topic', () => {
  const cards = [card('a', 3, null), card('b', 2, 1), card('c', 1, 2)];
  const topic = new Map(cards.map((c) => [c.id, 't'] as const));
  assert.deepEqual(withVariety(cards, topic, 2, 20).map((c) => c.id), ['b', 'c']);
});

test('a small topic and lone posts are never touched', () => {
  const cards = [card('a', 3, 1), card('b', 2, 1), card('c', 1, 1)];
  assert.deepEqual(withVariety(cards, new Map(), 3, 20), cards);
});

test('★ topics join by story, by normalised name, or by alike meaning, transitively', () => {
  const facts = new Map<string, TopicFacts>([
    ['trailer', { storyId: null, name: 'GTA6' }],
    ['roman', { storyId: null, name: 'GTAVI' }],
    ['music', { storyId: null, name: 'JUSTICE' }],
    ['music2', { storyId: null, name: 'Justice' }],
    ['inStory', { storyId: 's1', name: 'CAT' }],
    ['inStory2', { storyId: 's1', name: 'KITTEN' }],
    ['car', { storyId: null, name: 'ROADSTER' }],
    ['nameless', { storyId: null, name: null }],
  ]);
  const ids = [...facts.keys()];
  /* The music post is alike in meaning to a trailer post; nothing links the car or the nameless post. */
  const topics = topicsOf(ids, facts, [['music', 'trailer']]);
  const t = (id: string) => topics.get(id);
  assert.equal(t('roman'), t('trailer'));
  assert.equal(t('music'), t('trailer'));
  assert.equal(t('music2'), t('trailer'));
  assert.equal(t('inStory'), t('inStory2'));
  assert.notEqual(t('inStory'), t('trailer'));
  assert.notEqual(t('car'), t('trailer'));
  assert.notEqual(t('nameless'), t('car'));
});
