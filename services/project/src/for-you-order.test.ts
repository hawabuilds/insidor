/**
 * For You's order and the pass routes, as the projector applies them (the owner, 2026-10-13): newest
 * first by when the post went up, whatever route it passed by. A shill never passes; the owner's call outranks all of it.
 * And the order model's bar still holds a post back only when set, with a fit, never over a meme call.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { cryptoSignalFor, forYouOrder, postRoute, underScoreBar, type RisingRow } from './rising.ts';

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
