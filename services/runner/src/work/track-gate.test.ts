/**
 * The re-read gate: a post that can never be shown loses its paid re-reads; a post that is
 * on screen, could still pass, or is waiting on its reach to be judged keeps them.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

import { judgedYesUnshown, offFeedTooOld, rereadsThatFit, offForYouPerPostTooOld, staleUnpassed, worthRereading } from './track-gate.ts';

/* The fresh bands and the stale cut as they were before they were switched on, so these tests keep
   pinning the switch-off behaviour whatever the live policy says; a test that wants them on says so. */
const DEFAULT_POLICY = { ...LIVE_POLICY, feed: { ...LIVE_POLICY.feed, fresh: { ...LIVE_POLICY.feed.fresh, enabled: false, cutStale: false } } };

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
  return { onFeed: new Set(), onForYou: new Set(), catchAll: new Set(), storiesOf: new Map(), membersOf: new Map(), judged: new Map(), ...over };
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

test('★ the off-feed cut: a paid-read post past twelve hours, off For You, loses its re-reads whatever its answer', () => {
  assert.equal(P.track.offFeedMaxAgeMs, 12 * 3_600_000);
  const now = 100 * 3_600_000;
  const old = now - P.track.offFeedMaxAgeMs - 1;
  for (const source of ['x', 'tiktok']) {
    /* a pass, an unjudged catch-all post and a hidden-narrative post alike */
    assert.equal(offFeedTooOld('a', source, old, now, facts({ judged: new Map([['a', yes]]) }), P), true);
    assert.equal(offFeedTooOld('a', source, old, now, facts({ catchAll: new Set(['a']) }), P), true);
    assert.equal(offFeedTooOld('a', source, old, now, facts(), P), true);
  }
});

test('the off-feed cut keeps For You (frame or scroll), Popular\'s frame, younger posts, undated posts and other sources', () => {
  const now = 100 * 3_600_000;
  const old = now - P.track.offFeedMaxAgeMs - 1;
  assert.equal(offFeedTooOld('a', 'x', old, now, facts({ onForYou: new Set(['a']) }), P), false);
  assert.equal(offFeedTooOld('a', 'x', old, now, facts({ onFeed: new Set(['a']) }), P), false);
  assert.equal(offFeedTooOld('a', 'x', now - P.track.offFeedMaxAgeMs, now, facts(), P), false);
  assert.equal(offFeedTooOld('a', 'tiktok', null, now, facts(), P), false);
  assert.equal(offFeedTooOld('a', 'reddit', old, now, facts(), P), false);
});

test('★ the three-hour cut: a post billed per post, past three hours and off For You, loses its re-reads whatever its answer', () => {
  assert.equal(P.track.offForYouPerPostMaxAgeMs, 3 * 3_600_000);
  const now = 100 * 3_600_000;
  const old = now - P.track.offForYouPerPostMaxAgeMs - 1;
  assert.equal(offForYouPerPostTooOld('a', true, old, now, facts({ judged: new Map([['a', yes]]) }), P), true);
  assert.equal(offForYouPerPostTooOld('a', true, old, now, facts({ catchAll: new Set(['a']) }), P), true);
  assert.equal(offForYouPerPostTooOld('a', true, old, now, facts(), P), true);
});

test('the three-hour cut keeps For You (frame or scroll), Popular\'s frame, younger and undated posts, and sources billed otherwise', () => {
  const now = 100 * 3_600_000;
  const old = now - P.track.offForYouPerPostMaxAgeMs - 1;
  assert.equal(offForYouPerPostTooOld('a', true, old, now, facts({ onForYou: new Set(['a']) }), P), false);
  assert.equal(offForYouPerPostTooOld('a', true, old, now, facts({ onFeed: new Set(['a']) }), P), false);
  assert.equal(offForYouPerPostTooOld('a', true, now - P.track.offForYouPerPostMaxAgeMs, now, facts(), P), false);
  assert.equal(offForYouPerPostTooOld('a', true, null, now, facts(), P), false);
  /* billed by the run: the twelve-hour cut is the one that applies */
  assert.equal(offForYouPerPostTooOld('a', false, old, now, facts(), P), false);
});

test('★ a found yes not on For You is read until it joins, up to its own age limit', () => {
  const now = 1_800_000_000_000;
  const H = 3_600_000;
  const found = facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]) });
  assert.equal(judgedYesUnshown('a', now - 5 * H, now, found, P), true, 'past the three-hour cut, inside six hours');
  assert.equal(judgedYesUnshown('a', now - P.track.judgedYesMaxAgeMs - 1, now, found, P), false, 'aged out');
  assert.equal(judgedYesUnshown('a', null, now, found, P), false, 'no time: not shown to be young');
  assert.equal(judgedYesUnshown('a', now - H, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]), onForYou: new Set(['a']) }), P), false, 'joined: the usual reads');
  assert.equal(judgedYesUnshown('a', now - H, now, facts({ judged: new Map([['a', yes]]) }), P), false, 'no lane found it: For You never reads it');
  assert.equal(judgedYesUnshown('a', now - H, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', nearYes]]) }), P), false, 'a yes under the bar is not a yes');
  assert.equal(judgedYesUnshown('a', now - H, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', firmNo]]) }), P), false);
});

test('★ a short re-read day reads the yeses that fit and nothing else; a full one reads the batch; an unread bill reads none', () => {
  assert.equal(rereadsThatFit(10, 3, 0.0015, 4, 5), 10, 'it all fits');
  assert.equal(rereadsThatFit(10, 3, 0.0015, 4.9995, 5), 3, 'room for three reads: the three yeses');
  assert.equal(rereadsThatFit(10, 3, 0.0015, 4.99975, 5), 1, 'room for one: one yes');
  assert.equal(rereadsThatFit(10, 0, 0.0015, 4.9995, 5), 0, 'no yes: paused as before');
  assert.equal(rereadsThatFit(10, 3, 0.0015, 5.1, 5), 0, 'over: none');
  assert.equal(rereadsThatFit(10, 3, 0.0015, null, 5), 0, 'the bill unread: none');
});
