/**
 * The re-read gate: a post that can never be shown loses its paid re-reads; a post that is
 * on screen, could still pass, or is waiting on its reach to be judged keeps them.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

import { worthRereading } from './track-gate.ts';

const P = DEFAULT_POLICY;
const r = P.rising;
const yes: TrackingJudgement = { coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'CHILLGUY' };
const firmNo: TrackingJudgement = { coinable: false, confidence: r.boostMaxNoConfidence + 0.2, lookedAt: 'picture', proposedName: null };
const unsureNo: TrackingJudgement = { coinable: false, confidence: r.boostMaxNoConfidence, lookedAt: 'picture', proposedName: null };
const longName: TrackingJudgement = { ...yes, proposedName: 'one two three four five six' };
const unsureYes: TrackingJudgement = { ...yes, confidence: P.qualify.minJudgeConfidence.text - 0.1 };

function facts(over: Partial<{ [K in keyof TrackingFacts]: TrackingFacts[K] }> = {}): TrackingFacts {
  return { onFeed: new Set(), catchAll: new Set(), storiesOf: new Map(), membersOf: new Map(), judged: new Map(), ...over };
}

test('a post on a feed is always re-read', () => {
  assert.equal(worthRereading('a', facts({ onFeed: new Set(['a']), judged: new Map([['a', firmNo]]) }), P), true);
});

test('a firm no, a failed name test and an unsure yes are never re-read off the feed', () => {
  for (const j of [firmNo, longName, unsureYes]) {
    assert.equal(worthRereading('a', facts({ judged: new Map([['a', j]]), catchAll: new Set(['a']) }), P), false);
  }
});

test('a pass and an unsure no keep their re-reads: reach and the picture boost can still show them', () => {
  for (const j of [yes, unsureNo]) {
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
