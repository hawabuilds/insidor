/**
 * The re-read gate: a post that can never be shown loses its paid re-reads; a post that is
 * on screen, could still pass, or is waiting on its reach to be judged keeps them.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

import { staleUnpassed, worthRereading } from './track-gate.ts';

const P = DEFAULT_POLICY;
const r = P.rising;
const yes: TrackingJudgement = { coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'CHILLGUY' };
const firmNo: TrackingJudgement = { coinable: false, confidence: 0.9, lookedAt: 'picture', proposedName: null };
/* A "no" at 0.15 is the model's routine firm no as often as a doubtful one: never lifted, never re-read. */
const lowNo: TrackingJudgement = { coinable: false, confidence: 0.15, lookedAt: 'picture', proposedName: null };
const longName: TrackingJudgement = { ...yes, proposedName: 'one two three four five six' };
const nearYes: TrackingJudgement = { ...yes, confidence: P.qualify.minJudgeConfidence.text - r.boostBarMargin };
const unsureYes: TrackingJudgement = { ...yes, confidence: P.qualify.minJudgeConfidence.text - r.boostBarMargin - 0.1 };

function facts(over: Partial<{ [K in keyof TrackingFacts]: TrackingFacts[K] }> = {}): TrackingFacts {
  return { onFeed: new Set(), catchAll: new Set(), storiesOf: new Map(), membersOf: new Map(), judged: new Map(), ...over };
}

test('a post on a feed is always re-read', () => {
  assert.equal(worthRereading('a', facts({ onFeed: new Set(['a']), judged: new Map([['a', firmNo]]) }), P), true);
});

test('any no, a failed name test and a yes far under the bar are never re-read off the feed', () => {
  for (const j of [firmNo, lowNo, longName, unsureYes]) {
    assert.equal(worthRereading('a', facts({ judged: new Map([['a', j]]), catchAll: new Set(['a']) }), P), false);
  }
});

test('a pass and a yes near the bar keep their re-reads: reach and the picture boost can still show them', () => {
  for (const j of [yes, nearYes]) {
    assert.equal(worthRereading('a', facts({ judged: new Map([['a', j]]) }), P), true);
  }
});

test('an unjudged catch-all post keeps its re-reads, even in a hidden narrative', () => {
  const f = facts({ catchAll: new Set(['a']), storiesOf: new Map([['a', ['s']]]), membersOf: new Map([['s', ['a', 'b']]]) });
  assert.equal(worthRereading('a', f, P), true);
});

test('an unjudged watch post is re-read only while its narrative is on the board', () => {
  const members = ['w', 'p1', 'p2'];
  const shown = facts({ storiesOf: new Map([['w', ['s']]]), membersOf: new Map([['s', members]]), judged: new Map([['p1', yes], ['p2', yes]]) });
  assert.equal(r.narrativeMinPassingPosts <= 2, true, 'the fixture has two passing posts');
  assert.equal(worthRereading('w', shown, P), true);
  const hidden = facts({ storiesOf: new Map([['w', ['s']]]), membersOf: new Map([['s', members]]), judged: new Map([['p1', yes], ['p2', firmNo]]) });
  assert.equal(worthRereading('w', hidden, P), false);
});

test('★ the stale cut is off by default: an old unjudged post keeps its re-reads', () => {
  const now = 100 * 3_600_000;
  assert.equal(staleUnpassed('a', now - 10 * 3_600_000, now, facts(), P), false);
});

test('the stale cut, on: an unjudged post off every feed past six hours is dropped; judged, on a feed, younger or undated is kept', () => {
  const on = { ...P, feed: { ...P.feed, fresh: { ...P.feed.fresh, cutStale: true } } };
  const now = 100 * 3_600_000;
  const old = now - P.feed.fresh.staleAfterMs - 1;
  assert.equal(staleUnpassed('a', old, now, facts(), on), true);
  assert.equal(staleUnpassed('a', old, now, facts({ judged: new Map([['a', yes]]) }), on), false);
  assert.equal(staleUnpassed('a', old, now, facts({ onFeed: new Set(['a']) }), on), false);
  assert.equal(staleUnpassed('a', now - P.feed.fresh.staleAfterMs, now, facts(), on), false);
  assert.equal(staleUnpassed('a', null, now, facts(), on), false);
});
