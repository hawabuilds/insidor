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
  const out = withVariety(cards, [{ groupOf: topic, perWindow: 3, window: 20 }]);
  check(out, topic, 3, 20);
  /* Every other post keeps its place, and the list is still newest first. */
  for (const c of cards.filter((c) => !c.id.startsWith('game'))) assert.ok(out.includes(c), c.id);
  assert.deepEqual(out, [...out].sort((a, b) => b.at - a.at));
});

test('★ the strongest posts of a crowded topic keep the places, not merely the newest', () => {
  const cards = [card('g1', 10, 5), card('g2', 9, 50_000), card('g3', 8, 10), card('g4', 7, 900_000), card('g5', 6, 3), card('g6', 5, 70_000)];
  const topic = new Map(cards.map((c) => [c.id, 'game'] as const));
  assert.deepEqual(withVariety(cards, [{ groupOf: topic, perWindow: 3, window: 20 }]).map((c) => c.id), ['g2', 'g4', 'g6']);
});

test('a post whose views we have not read is last in line for a crowded topic', () => {
  const cards = [card('a', 3, null), card('b', 2, 1), card('c', 1, 2)];
  const topic = new Map(cards.map((c) => [c.id, 't'] as const));
  assert.deepEqual(withVariety(cards, [{ groupOf: topic, perWindow: 2, window: 20 }]).map((c) => c.id), ['b', 'c']);
});

test('a small topic and lone posts are never touched', () => {
  const cards = [card('a', 3, 1), card('b', 2, 1), card('c', 1, 1)];
  assert.deepEqual(withVariety(cards, [{ groupOf: new Map(), perWindow: 3, window: 20 }]), cards);
});

test('★ one account takes at most two places on the list: its most-viewed keep them, the next post fills in', () => {
  /* 62 cards newest first: a news account posts six times among them, everyone else once. */
  const mario = new Set(['m0', 'm8', 'm16', 'm24', 'm32', 'm40']);
  const cards = Array.from({ length: 62 }, (_, i) => card(mario.has(`m${i}`) ? `m${i}` : `o${i}`, 1000 - i, mario.has(`m${i}`) ? 1_000 * (i + 1) : 50));
  const account = new Map(cards.map((c) => [c.id, c.id.startsWith('m') ? 'x:mario' : `x:${c.id}`] as const));
  const out = withVariety(cards, [{ groupOf: account, perWindow: 2, window: 60 }]);
  /* His two most-viewed stay, in place; the other four go and nobody else does. */
  assert.deepEqual(out.filter((c) => c.id.startsWith('m')).map((c) => c.id), ['m32', 'm40']);
  assert.equal(out.length, 58);
  /* Cut to the list's sixty, the posts below the old cut move up into the freed places. */
  assert.ok(out.slice(0, 60).some((c) => c.id === 'o60') && out.slice(0, 60).some((c) => c.id === 'o61'));
  assert.deepEqual(out, [...out].sort((a, b) => b.at - a.at));
});

test('★ the account limit is a rolling window: a post far below the account\'s others does not block a new one', () => {
  const cards = Array.from({ length: 80 }, (_, i) => card(i === 0 || i === 70 || i === 75 ? `m${i}` : `o${i}`, 1000 - i, i === 0 ? 10 : i >= 70 ? 1_000_000 : 50));
  const account = new Map(cards.map((c) => [c.id, c.id.startsWith('m') ? 'x:mario' : `x:${c.id}`] as const));
  const out = withVariety(cards, [{ groupOf: account, perWindow: 2, window: 60 }]);
  /* m0 is the weakest, but m70 and m75 are over sixty cards below it: all three keep a place. */
  assert.deepEqual(out.filter((c) => c.id.startsWith('m')).map((c) => c.id), ['m0', 'm70', 'm75']);
});

test('★ topic and account are checked together: a card stays only when it fits both', () => {
  const cards = [card('a1', 9, 900), card('a2', 8, 800), card('a3', 7, 700), card('b1', 6, 600), card('b2', 5, 500)];
  const topic = new Map(cards.map((c) => [c.id, c.id === 'b2' ? 'gta' : c.id === 'a3' ? 'gta' : c.id] as const));
  const account = new Map(cards.map((c) => [c.id, c.id.startsWith('a') ? 'x:a' : `x:${c.id}`] as const));
  const out = withVariety(cards, [
    { groupOf: topic, perWindow: 1, window: 20 },
    { groupOf: account, perWindow: 2, window: 60 },
  ]);
  /* a3 is over its account's two; with it gone, b2 is the topic's only card and stays. */
  assert.deepEqual(out.map((c) => c.id), ['a1', 'a2', 'b1', 'b2']);
});

test('no rules: every card, as given', () => {
  const cards = [card('a', 3, 1), card('b', 2, 1)];
  assert.deepEqual(withVariety(cards, []), cards);
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
