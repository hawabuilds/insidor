/**
 * The scorecard's arithmetic on made-up rows: which reading is "24 h later", when a post counts as
 * shown early, and how a proven coin is judged against coins of its name. The SQL is exercised by
 * running tools/scorecard.ts against the database; these pin the decisions the header states.
 * Run: node --test --experimental-strip-types tools/lib/scorecard.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SeenRow } from '../../store/src/index.ts';
import { finalViews, rightTally, scorecard, type CoverRow, type FypRow, type RightRow } from './scorecard.ts';

const H = 3_600_000;
const post = (over: Partial<FypRow>): FypRow => ({ itemId: 'x:1', shownAtMs: 2 * H, postedAtMs: 0, label: null, evidence: false, atShown: [2 * H, 100], before24: null, after24: null, top: [10 * H, 400], firstCoinAtMs: null, firstCoinClock: null, ...over });

test('the reading nearest 24 h is final when one is near; else the highest, flagged', () => {
  assert.deepEqual(finalViews(post({ before24: [23 * H, 900], after24: [30 * H, 1200] })), { v: 900, at24: true });
  assert.deepEqual(finalViews(post({ before24: [12 * H, 500] })), { v: 400, at24: false });
});

test('earliness: a post shown at a fifth of its final views or less is early; no reading before showing is a dash, not a zero', () => {
  const c = scorecard('t', [post({ atShown: [2 * H, 50], top: [10 * H, 1000] }), post({ atShown: [2 * H, 500], top: [10 * H, 1000] }), post({ atShown: null })], [], [], []);
  assert.equal(c.earliness.measured, 2);
  assert.equal(c.earliness.under20, 1);
  assert.equal(c.earliness.noReadingBefore, 1);
});

test('coverage: shown before the post first read past 20% of the line; never read under it is not early', () => {
  const row = (shownAtMs: number | null, crossedAtMs: number | null): CoverRow => ({ itemId: 'x:1', source: 'x', postedAtMs: 0, why: ['coined'], shownAtMs, top: 600_000, crossedAtMs });
  const c = scorecard('t', [], [row(H, 2 * H), row(3 * H, 2 * H), row(null, 2 * H), { ...row(H, 2 * H), top: 400_000 }], [], []);
  assert.deepEqual([c.coverage.viral, c.coverage.shownEarly, c.coverage.shownLate], [3, 1, 1]);
});

test('before any coin: an uncoined post counts as before; a coin on an unknown clock is never timed', () => {
  const c = scorecard('t', [post({}), post({ firstCoinAtMs: 3 * H, firstCoinClock: 'chain' }), post({ firstCoinAtMs: H, firstCoinClock: 'within' }), post({ firstCoinAtMs: 5 * H, firstCoinClock: 'unknown' })], [], [], []);
  assert.deepEqual([c.beforeCoin.uncoined, c.beforeCoin.coined, c.beforeCoin.coinedFirst, c.beforeCoin.unknownClock], [1, 3, 1, 1]);
  assert.equal(c.beforeCoin.medianAheadMin, 0);
});

test('right coin: biggest at +1 h wins; an unmeasured rival is not zero; ours unmeasured with no measured rival is can\'t tell', () => {
  const r = (mint: string, address: string, cap1h: number | null, namesPost = false): RightRow => ({ itemId: `x:${mint}`, mint, seenAtMs: 0, address, cap1h, namesPost });
  const rows = [
    r('a', 'a', 100), r('a', 'a2', 50),
    r('b', 'b', 100), r('b', 'b2', 200),
    r('c', 'c', null), r('c', 'c2', null),
    r('d', 'd', 10),
    r('e', 'e', 100), r('e', 'e2', 900), r('e', 'e3', 50, true),
  ];
  assert.deepEqual(rightTally(rows), { coins: 5, alone: 1, biggest: 1, beaten: 2, cantTell: 1 });
  assert.deepEqual(rightTally(rows, (x) => x.namesPost), { coins: 5, alone: 4, biggest: 1, beaten: 0, cantTell: 0 });
});

test('★ seen and kept: only posts the owner saw count, his "Not a meme" against, waiting out of both sides', () => {
  const c = scorecard('t', [post({ seen: 'kept' }), post({ seen: 'kept' }), post({ seen: 'meme' }), post({ seen: 'not', label: 'not' }), post({ seen: 'waiting' }), post({ seen: null })], [], [], []);
  assert.deepEqual(c.memeable.seen, { kept: 2, meme: 1, not: 1, waiting: 1 });
  const seen = (outcome: SeenRow['outcome'], notInWindow = false): SeenRow => ({ itemId: 'x:1', firstSeenAtMs: 0, call: null, listed: false, onScreen: true, opened: false, notInWindow, outcome });
  const d = scorecard('t', [], [], [], [], undefined, [seen('kept'), seen('kept'), seen('not', true), seen('not'), seen('waiting')]);
  assert.deepEqual(d.screen, { seen: 5, kept: 2, not: 2, notInWindow: 1, meme: 0, waiting: 1 });
});
