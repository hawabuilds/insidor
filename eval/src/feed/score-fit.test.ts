/** The order model's fit is deterministic, handles missing values by indicator, and its gate never applies a worse fit. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { SCORE_SIGNALS, postRankScore, type PostSignals, type ScoreFit } from '@insidor/core';

import { crossScores, fitLogistic, foldOf, gateFit, isHeldOut, ordering, signalWeights, termsFor, tradeOff, type Example, type LabelGroup } from './score-fit.ts';

const EMPTY = Object.fromEntries(SCORE_SIGNALS.map((s) => [s, null])) as Record<(typeof SCORE_SIGNALS)[number], number | null>;
const sig = (over: Partial<PostSignals>): PostSignals => ({ ...EMPTY, judge_yes: 0, judge_held_kind: 0, judge_unjudged: 0, looked_picture: 0, looked_frame: 0, name_test: 0, ...over });
const ex = (itemId: string, group: LabelGroup, signals: PostSignals, rulesPass = true, heldOut = false): Example => ({ itemId, group, y: group === 'not' ? 0 : 1, heldOut, signals, rulesPass });

/* Memes have more reach and a picture match; non-memes less. Some pictures are missing. */
const ROWS: Example[] = Array.from({ length: 40 }, (_, i) => {
  const meme = i % 4 === 0;
  return ex(`x:${i}`, meme ? 'meme' : 'not', sig({ judge_yes: 1, reach: (meme ? 5 : 4) + (i % 7) / 10, picture: i % 5 === 0 ? null : (meme ? 0.6 : 0.3) + (i % 3) / 20 }));
});

test('★ the fit is deterministic: the same labels give the same weights to the last bit', () => {
  assert.deepEqual(fitLogistic(ROWS, 1), fitLogistic(ROWS, 1));
});

test('the fit learns the direction in the labels, and the ridge pulls weights in', () => {
  const fit = fitLogistic(ROWS, 1);
  const reach = fit.terms.find((t) => t.signal === 'reach' && t.kind === 'value');
  assert.ok(reach !== undefined && reach.weight > 0);
  const strong = fitLogistic(ROWS, 100).terms.find((t) => t.signal === 'reach' && t.kind === 'value');
  assert.ok(strong !== undefined && Math.abs(strong.weight) < Math.abs(reach.weight));
  const meme = ROWS.find((r) => r.group === 'meme');
  const not = ROWS.find((r) => r.group === 'not');
  assert.ok(meme !== undefined && not !== undefined && postRankScore(meme.signals, fit) > postRankScore(not.signals, fit));
});

test('★ a missing value gets an indicator term; a signal missing everywhere, or never varying, offers nothing', () => {
  const terms = termsFor(ROWS);
  assert.ok(terms.some((t) => t.signal === 'picture' && t.kind === 'missing'), 'pictures are sometimes missing');
  assert.ok(!terms.some((t) => t.signal === 'reach' && t.kind === 'missing'), 'reach is never missing here');
  assert.ok(!terms.some((t) => t.signal === 'attention'), 'attention is missing for every post');
  assert.ok(!terms.some((t) => t.signal === 'judge_yes'), 'every post is a yes: nothing to weigh');
  /* standardised on the fitted posts' present values */
  const reach = terms.find((t) => t.signal === 'reach' && t.kind === 'value');
  assert.ok(reach !== undefined && reach.spread > 0);
});

test('the held-out split and the folds are a pure function of the id', () => {
  assert.equal(isHeldOut('x:1', 0.3), isHeldOut('x:1', 0.3));
  assert.equal(isHeldOut('x:1', 0), false);
  assert.equal(isHeldOut('x:1', 1), true);
  const share = Array.from({ length: 1000 }, (_, i) => isHeldOut(`x:${i}`, 0.3)).filter(Boolean).length / 1000;
  assert.ok(share > 0.25 && share < 0.35, `about 30% held out, got ${share}`);
  assert.equal(foldOf('x:9', 5), foldOf('x:9', 5));
  assert.equal(crossScores(ROWS, 1).size, ROWS.length, 'every row is scored by a fit that never saw it');
});

const FIT = (w: number): ScoreFit => ({ intercept: 0, terms: [{ signal: 'reach', kind: 'value', centre: 4.5, spread: 1, weight: w }] });
const HELD = [
  ex('a', 'gold', sig({ reach: 6 })),
  ex('b', 'missed', sig({ reach: 5.5 })),
  ex('c', 'not', sig({ reach: 3 })),
  ex('d', 'not', sig({ reach: 5 })),
  ex('e', 'not', sig({ reach: 2 }), false),
];

test('★ with no bar the rates cannot move, and the order decides: a better order is applied, a worse one is not', () => {
  const good = gateFit(HELD, FIT(1), null, null);
  assert.equal(good.apply, true, good.why ?? '');
  assert.deepEqual(good.next.hand, good.ref.hand);
  const bad = gateFit(HELD, FIT(-1), null, null);
  assert.equal(bad.apply, false);
  assert.match(bad.why ?? '', /above a non-meme/);
  /* against the fit in use, not today's rules */
  assert.equal(gateFit(HELD, FIT(-1), FIT(1), null).apply, false);
});

test('★ at a bar, a fit that passes less hand gold or more non-memes is not applied', () => {
  /* reach weight 1, bar 0.7: gold a (6 → 0.82) and missed b (5.5 → 0.73) pass; at weight 0.5 both fall under (0.68, 0.62) */
  const r = gateFit(HELD, FIT(0.5), FIT(1), 0.7);
  assert.equal(r.apply, false);
  assert.match(r.why ?? '', /hand gold 0\/2, against 2\/2/);
  const noisy = gateFit(HELD, { intercept: 2, terms: [] }, FIT(1), 0.7);
  assert.equal(noisy.apply, false, 'passes every non-meme the rules pass');
});

test('nothing to test on is not a pass', () => {
  const r = gateFit(HELD.filter((h) => h.group === 'not'), FIT(1), null, null);
  assert.equal(r.apply, false);
  assert.match(r.why ?? '', /nothing to test/);
});

test('the order counts ties as half, and the trade-off table lists each bar with and without the rules', () => {
  assert.equal(ordering(HELD, () => 1), 0.5);
  const t = tradeOff(HELD, (r) => postRankScore(r.signals, FIT(1)), [0.5]);
  assert.equal(t[0]?.withRules.negatives.passed, 1, 'd (5.0) passes; e is held by the rules');
  assert.equal(t[0]?.alone.negatives.passed, 1);
});

test('weights are listed largest first, each with its missing term', () => {
  const w = signalWeights({ intercept: 0, terms: [
    { signal: 'reach', kind: 'value', centre: 0, spread: 1, weight: 0.2 },
    { signal: 'picture', kind: 'value', centre: 0, spread: 1, weight: -0.9 },
    { signal: 'picture', kind: 'missing', centre: 0, spread: 1, weight: 0.3 },
  ] });
  assert.deepEqual(w, [{ signal: 'picture', weight: -0.9, missing: 0.3 }, { signal: 'reach', weight: 0.2, missing: null }]);
});
