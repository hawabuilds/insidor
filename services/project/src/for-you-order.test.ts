/**
 * For You's order and the pass routes, as the projector applies them (the owner, 2026-10-13): newest
 * first by when the post went up, whatever route it passed by. A shill never passes; the owner's call outranks all of it.
 * And the order model's bar still holds a post back only when set, with a fit, never over a meme call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { cryptoSignalFor, forYouOrder, postRoute, underScoreBar, type RisingRow } from './rising.ts';
import { withVariety } from './variety.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

type P = { at: number; id: string };
const sorted = (posts: P[]) => [...posts].sort(forYouOrder).map((p) => p.id);

test('★ newest first by when the post went up, then by id', () => {
  assert.deepEqual(
    sorted([
      { at: 2, id: 'older' },
      { at: 9, id: 'newest' },
      { at: 5, id: 'middle' },
    ]),
    ['newest', 'middle', 'older'],
  );
  assert.deepEqual(sorted([{ at: 1, id: 'b' }, { at: 1, id: 'a' }]), ['a', 'b']);
  assert.deepEqual(sorted([{ at: 1, id: 'a:1' }, { at: 1, id: 'X:1' }]), ['X:1', 'a:1'], 'byte order, as the scroll\'s collate "C" sorts');
});

test('★ the frame never runs older-then-newer: the variety rule leaves a card out, it never moves one down', () => {
  /* Ten posts of one topic, newest first, and three others among them: the topic keeps a few places. */
  const cards = Array.from({ length: 13 }, (_, i) => ({ id: `x:${i}`, at: 1000 - i * 10, views: i % 4 === 0 ? 5 : 100 - i }));
  const topic = new Map(cards.map((c) => [c.id, c.views === 5 ? c.id : 'gta'] as const));
  const kept = withVariety([...cards].sort(forYouOrder), topic, 3, 20);
  assert.ok(kept.length < cards.length, 'some of the crowded topic are left out');
  for (let i = 1; i < kept.length; i += 1) assert.ok(forYouOrder(kept[i - 1] as P, kept[i] as P) < 0, `card ${i} is not newer than the one above it`);
});

const ROW: RisingRow = {
  item_id: 'x:1', source: 'x', source_item_id: '1', posted_at: null, first_seen_at: new Date(0), body: 'my dog did a thing', media: [],
  handle: 'h', display_name: null, source_author_id: 'a', coinable: true, confidence: 0.95, looked_at: 'picture', proposed_name: 'DOG',
  picture_similarity: null, story_id: null, owner_call: null, kind_label: null,
};
const NO = { ...ROW, coinable: false, confidence: 0.9, proposed_name: null };

test('★ the routes: judge, judge with the signal, the signal alone on a kind not held; a shill never', () => {
  assert.deepEqual(postRoute(ROW), { why: 'passes', route: 'judge' });
  assert.equal(postRoute(ROW, undefined, cryptoSignalFor(ROW, { others: true, ownTalk: false })).route, 'judge+signal');
  assert.equal(postRoute(NO, undefined, cryptoSignalFor(NO, { others: true, ownTalk: false })).route, 'signal');
  assert.equal(postRoute({ ...NO, kind_label: 'SPORT' }, undefined, { others: true, shill: false }).route, null, 'a held kind is not lifted by the signal');
  const shillText = { ...ROW, body: 'my dog $DOG is live' };
  assert.deepEqual(postRoute(shillText, undefined, cryptoSignalFor(shillText, undefined)), { why: 'not_memeable', route: null });
  assert.equal(postRoute(ROW, undefined, cryptoSignalFor(ROW, { others: true, ownTalk: true })).route, null, "the author's own CA is a shill");
  assert.equal(postRoute({ ...NO, owner_call: 'meme' }).why, 'passes');
  assert.equal(postRoute({ ...ROW, owner_call: 'not' }, undefined, { others: true, shill: false }).why, 'owner_not_meme');
  assert.equal(cryptoSignalFor(ROW, undefined), null, 'no read and a clean text: nothing to say');
});

test('★ the bar holds a post back only when set, with a number, and never over the owner\'s meme call', () => {
  assert.equal(underScoreBar(0.2, null, null), false, 'no bar: the rules decide');
  assert.equal(underScoreBar(null, 0.5, null), false, 'no fit: nothing to hold by');
  assert.equal(underScoreBar(0.2, 0.5, null), true);
  assert.equal(underScoreBar(0.5, 0.5, null), false, 'at the bar is over it');
  assert.equal(underScoreBar(0.2, 0.5, 'meme'), false);
  assert.equal(underScoreBar(0.2, 0.5, 'not'), true);
});

test('★ the safety net: a plain no with a net score passes only while it is on, never over a held kind, a shill or the owner', () => {
  const NET = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, coinModel: { ...DEFAULT_POLICY.judge.coinModel, on: true } } };
  const net = { ...NO, net_add: true };
  assert.equal(postRoute(net).route, null, 'off (the default): the stored score is not read');
  assert.deepEqual(postRoute(net, NET), { why: 'passes', route: 'net' });
  assert.equal(postRoute({ ...NO, net_add: false }, NET).route, null, 'a score under the threshold');
  assert.equal(postRoute({ ...net, kind_label: 'SPORT' }, NET).route, null, 'a held kind still holds');
  assert.equal(postRoute(net, NET, { others: false, shill: true }).route, null, 'a shill never');
  assert.equal(postRoute({ ...net, owner_call: 'not' }, NET).route, null, "the owner's Not a meme wins");
  assert.equal(postRoute({ ...ROW, confidence: 0.1, net_add: true }, NET).route, null, 'an unsure yes is not a no');
});
