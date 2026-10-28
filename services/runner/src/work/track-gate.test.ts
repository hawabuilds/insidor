/**
 * The re-read gate: a post that can never be shown loses its paid re-reads; a post that is
 * on screen, could still pass, or is waiting on its reach to be judged keeps them.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
import type { TrackingFacts, TrackingJudgement } from '@insidor/store';

import { climbingNoPace, fastestClimbers, judgedYesUnshown, mayClimb, offFeedTooOld, rereadTier, rereadsThatFit, offForYouPerPostTooOld, staleUnpassed, worthRereading, type RereadTier } from './track-gate.ts';

/* The fresh bands and the stale cut as they were before they were switched on, so these tests keep
   pinning the switch-off behaviour whatever the live policy says; a test that wants them on says so. */
const DEFAULT_POLICY = { ...LIVE_POLICY, judge: { ...LIVE_POLICY.judge, heldKinds: ['AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'NOT_MEME_MATCH'] }, feed: { ...LIVE_POLICY.feed, fresh: { ...LIVE_POLICY.feed.fresh, enabled: false, cutStale: false } } };
/* The held kinds these cases were written against (policy.v196); v197 holds only SPORT, a choice of the policy's. */

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
  return { onFeed: new Set(), onForYou: new Set(), catchAll: new Set(), storiesOf: new Map(), membersOf: new Map(), judged: new Map(), kindOf: new Map(), ownerCall: new Map(), ...over };
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

test('★ the re-read day: the tiers in order while the day has room, the rest only within its share; an unread bill reads none', () => {
  const share = P.track.rereadOrder.restShare;
  assert.equal(share, 0.8);
  const batch: RereadTier[] = [0, 0, 1, 2, 3, 3, 3, 3, 3, 3];
  const usd = 0.0015; // 10 reads at $0.00015
  assert.equal(rereadsThatFit(batch, usd, 3, 5, P), 10, 'it all fits, the rest under its share too');
  assert.equal(rereadsThatFit(batch, usd, 4.9995, 5, P), 3, 'room for three reads: the first three in tier order');
  assert.equal(rereadsThatFit(batch, usd, 4.99975, 5, P), 1, 'room for one: one yes');
  assert.equal(rereadsThatFit(batch, usd, 4, 5, P), 4, 'the day at its share: the four tiers above the rest, and no rest');
  assert.equal(rereadsThatFit([3, 3, 3], 0.00045, 3.9997, 5, P), 2, 'the rest up to its share, no further');
  assert.equal(rereadsThatFit([3, 3, 3], 0.00045, 4.1, 5, P), 0, 'the rest past its share: paused, with a fifth of the day still open to the yeses');
  assert.equal(rereadsThatFit(batch, usd, 5.1, 5, P), 0, 'over: none');
  assert.equal(rereadsThatFit(batch, usd, null, 5, P), 0, 'the bill unread: none');
  assert.equal(rereadsThatFit([], 0, 0, 5, P), 0);
  const old = { ...P, track: { ...P.track, rereadOrder: { ...P.track.rereadOrder, restShare: 1 } } };
  assert.equal(rereadsThatFit(batch, usd, 4, 5, old), 10, 'a share of 1 is the old day: the rest as free as the yeses');
});

test('★ the tiers: a found yes, then a feed or a found post waiting on its answer, then a big account, then the rest', () => {
  const big = P.track.rereadOrder.bigAccountFollowers;
  assert.equal(big, 100_000);
  assert.equal(rereadTier('a', true, null, facts(), P), 0);
  assert.equal(rereadTier('a', false, null, facts({ onFeed: new Set(['a']) }), P), 1);
  assert.equal(rereadTier('a', false, null, facts({ onForYou: new Set(['a']) }), P), 1);
  assert.equal(rereadTier('a', false, null, facts({ catchAll: new Set(['a']) }), P), 1, 'found, no answer yet');
  assert.equal(rereadTier('a', false, big, facts({ catchAll: new Set(['a']), judged: new Map([['a', nearYes]]) }), P), 2, 'answered: not waiting any more');
  assert.equal(rereadTier('a', false, big, facts(), P), 2, 'a narrative member by a big account');
  assert.equal(rereadTier('a', false, big - 1, facts(), P), 3);
  assert.equal(rereadTier('a', false, null, facts({ storiesOf: new Map([['a', ['s']]]) }), P), 3, 'an unknown follower count is not a big account');
});

test('★ the gate reads the post question\'s answer, the held kind and the owner\'s call apart, as the projector does', () => {
  const now = 1_800_000_000_000;
  const H = 3_600_000;
  /* A yes, then the close-match hold filed after it (the two @twaniimals posts, 25–26 Oct): held, not re-read. */
  const held = facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]), kindOf: new Map([['a', 'NOT_MEME_MATCH']]) });
  assert.equal(worthRereading('a', held, P), false);
  assert.equal(judgedYesUnshown('a', now - H, now, held, P), false);
  /* A kind label policy does not hold holds nothing: the yes stands. */
  const unheld = facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]), kindOf: new Map([['a', 'TRAGEDY']]) });
  assert.equal(P.judge.heldKinds.includes('TRAGEDY'), false);
  assert.equal(worthRereading('a', unheld, P), true);
  assert.equal(judgedYesUnshown('a', now - H, now, unheld, P), true);
  /* The owner's "meme" outranks a no and a hold; his "not" outranks a yes. */
  const meme = facts({ catchAll: new Set(['a']), judged: new Map([['a', firmNo]]), ownerCall: new Map([['a', 'meme' as const]]) });
  assert.equal(worthRereading('a', meme, P), true);
  assert.equal(judgedYesUnshown('a', now - H, now, meme, P), true);
  assert.equal(worthRereading('a', facts({ judged: new Map([['a', yes]]), kindOf: new Map([['a', 'AD']]), ownerCall: new Map([['a', 'meme' as const]]) }), P), true);
  const not = facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]), ownerCall: new Map([['a', 'not' as const]]) });
  assert.equal(worthRereading('a', not, P), false);
  assert.equal(judgedYesUnshown('a', now - H, now, not, P), false);
  /* An unjudged catch-all post called by nobody keeps its reads: not judged is never a no. */
  assert.equal(worthRereading('a', facts({ catchAll: new Set(['a']) }), P), true);
  /* On a feed, whatever was said. */
  assert.equal(worthRereading('a', facts({ onFeed: new Set(['a']), ownerCall: new Map([['a', 'not' as const]]) }), P), true);
});

test('a held member does not count toward its narrative being on the board', () => {
  const members = ['w', 'p1', 'p2'];
  const f = facts({ storiesOf: new Map([['w', ['s']]]), membersOf: new Map([['s', members]]), judged: new Map([['p1', yes], ['p2', yes]]), kindOf: new Map([['p2', 'SPORT']]) });
  assert.equal(r.narrativeMinPassingPosts, 2);
  assert.equal(worthRereading('w', f, P), false);
});

test('★ a "no" climbing fast in its first half hour is read on, as tier 2, to two hours (v188 `track.fastClimb`)', () => {
  const now = 1_800_000_000_000;
  const M = 60_000;
  const posted = now - 20 * M;
  const no = facts({ catchAll: new Set(['a']), judged: new Map([['a', firmNo]]) });
  /* @PopBase's first reading: 18,752 at 3.4 minutes, 5.5k a minute. */
  const fast = [{ atMs: posted + 3.4 * M, reach: 18_752 }];
  const slow = [{ atMs: posted + 3.4 * M, reach: 6_000 }];
  assert.equal(worthRereading('a', no, P), false, 'a no is not re-read on its own');
  assert.ok((climbingNoPace('a', posted, fast, now, no, P) ?? 0) > P.track.fastClimb.minReachPerMinute);
  assert.equal(climbingNoPace('a', posted, slow, now, no, P), null, 'slow: not kept');
  assert.equal(climbingNoPace('a', posted, [], now, no, P), null, 'unread: not shown fast');
  assert.equal(climbingNoPace('a', posted, [{ atMs: posted + 40 * M, reach: 900_000 }], now, no, P), null, 'only a reading in the first half hour counts');
  const old = now - 3 * 60 * M;
  assert.equal(climbingNoPace('a', old, [{ atMs: old + 3.4 * M, reach: 18_752 }], now, no, P), null, 'past two hours: done');
  assert.equal(climbingNoPace('a', null, fast, now, no, P), null, 'no post time');
  /* Politics or showbiz holds are the exception's too; other holds, the owner's not and unfound posts are not. */
  assert.equal(mayClimb('a', posted, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]), kindOf: new Map([['a', 'POLITICS']]) }), P), true);
  assert.equal(mayClimb('a', posted, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', firmNo]]), kindOf: new Map([['a', 'SPORT']]) }), P), false);
  assert.equal(mayClimb('a', posted, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', firmNo]]), ownerCall: new Map([['a', 'not' as const]]) }), P), false);
  assert.equal(mayClimb('a', posted, now, facts({ judged: new Map([['a', firmNo]]) }), P), false, 'not found by a lane');
  assert.equal(mayClimb('a', posted, now, facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]) }), P), false, 'a yes is read as a yes already');
  assert.equal(mayClimb('a', posted, now, facts({ catchAll: new Set(['a']) }), P), false, 'unjudged is read as unjudged already');
  const off = { ...P, track: { ...P.track, fastClimb: { ...P.track.fastClimb, on: false } } };
  assert.equal(mayClimb('a', posted, now, no, off), false, 'off: as v183');
  /* Tier 2, beside the big accounts: under the yeses and the posts on a feed, over the rest. */
  assert.equal(rereadTier('a', false, null, no, P, true), 2);
  assert.equal(rereadTier('a', false, null, no, P), 3);
  /* At most `maxPosts` at once, the fastest. */
  const many = new Map(Array.from({ length: P.track.fastClimb.maxPosts + 5 }, (_, i) => [`p${i}`, 5_000 + i] as const));
  const kept = fastestClimbers(many, P);
  assert.equal(kept.size, P.track.fastClimb.maxPosts);
  assert.equal(kept.has(`p${P.track.fastClimb.maxPosts + 4}`), true);
  assert.equal(kept.has('p0'), false);
});

test('★ a yes no lane found is read beside the climbers, above the narrative pages; a found yes keeps the first tier', () => {
  const uncredited = facts({ judged: new Map([['a', yes]]) });
  assert.equal(rereadTier('a', false, null, uncredited, P), 2);
  /* A "no" no lane found stays with the rest. */
  assert.equal(rereadTier('a', false, null, facts({ judged: new Map([['a', firmNo]]) }), P), 3);
  /* The owner's "not a meme" is never lifted. */
  assert.equal(rereadTier('a', false, null, facts({ judged: new Map([['a', yes]]), ownerCall: new Map([['a', 'not' as const]]) }), P), 3);
  /* A found yes not yet shown is still read first. */
  assert.equal(rereadTier('a', true, null, facts({ catchAll: new Set(['a']), judged: new Map([['a', yes]]) }), P), 0);
});
