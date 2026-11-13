/** The coin model's fit and the owner's table: the fit separates, the table counts only the net's own extras, the threshold keeps to the bars. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { added, averagePrecision, chooseThreshold, fitLogistic, matchedThreshold, scoreRow, standardisation, tableRow, type FitRow, type TablePost } from './coin-fit.ts';

test('the fit is deterministic and ranks a separating feature', () => {
  const rows: FitRow[] = [];
  for (let i = 0; i < 40; i++) rows.push({ x: Float64Array.from([i % 2 === 0 ? 1 : -1, (i % 5) / 5]), y: i % 2 === 0 ? 1 : 0 });
  const a = fitLogistic(rows, 1);
  const b = fitLogistic(rows, 1);
  assert.deepEqual(a, b);
  assert.ok((a.weights[0] as number) > 0);
  assert.ok(scoreRow([1, 0], a) > 0.5 && scoreRow([-1, 0], a) < 0.5);
});

test('standardisation ignores missing values and gives a constant feature spread 0', () => {
  const s = standardisation([{ a: 1, b: 2 }, { a: 3, b: 2 }, { a: null, b: 2 }], ['a', 'b']);
  assert.deepEqual(s.means, [2, 2]);
  assert.equal(s.spreads[0], Math.SQRT2);
  assert.equal(s.spreads[1], 0);
});

test('average precision is 1 when every coined post ranks first', () => {
  assert.equal(averagePrecision([{ score: 0.9, y: 1 }, { score: 0.1, y: 0 }]), 1);
  assert.equal(averagePrecision([{ score: 0.9, y: 0 }]), null);
});

const post = (o: Partial<TablePost>): TablePost => ({ itemId: 'x:1', score: 0.9, hit: false, shown: false, judgeNo: true, gates: true, junk: null, tappedNot: false, memeViral: false, earlyAtMs: null, shownAtMs: null, addAtMs: null, viewsShown: null, viewsAdd: null, views24: null, ...o });

test('★ only a judged-no post, not already shown, that clears the other gates is an extra', () => {
  assert.equal(added(post({}), 0.8), true);
  assert.equal(added(post({ shown: true }), 0.8), false);
  assert.equal(added(post({ judgeNo: false }), 0.8), false);
  assert.equal(added(post({ gates: false }), 0.8), false);
  assert.equal(added(post({ score: 0.7 }), 0.8), false);
});

test('the table: extras an hour, coined caught alone and combined, and the junk rise in points', () => {
  const posts = [
    post({ itemId: 'a', shown: true, judgeNo: false, hit: true, junk: false }),
    post({ itemId: 'b', shown: true, judgeNo: false, junk: true, tappedNot: true }),
    post({ itemId: 'c', hit: true, junk: false }),
    post({ itemId: 'd', junk: true, score: 0.95 }),
    post({ itemId: 'e', score: 0.2, junk: true }),
  ];
  const r = tableRow(posts, 0.8, 2);
  assert.equal(r.extras, 2);
  assert.equal(r.extrasPerHour, 1);
  assert.equal(r.extrasHit, 1);
  assert.deepEqual(r.hits, { alone: 1, combined: 2, model: 2, of: 2 });
  assert.equal(r.junkAlone, 0.5);
  assert.equal(r.junkCombined, 0.5);
  assert.equal(r.junkRise, 0);
  assert.deepEqual(r.tapsAlone, { not: 1, shown: 2 });
  assert.equal(chooseThreshold(posts, [0.1, 0.8, 0.99], 2, 0.03, 0.5), 0.99, 'one an hour is over a cap of 0.5');
  assert.equal(chooseThreshold(posts, [0.1, 0.8], 2, 0.03, 5), 0.8, 'at 0.1 the junk rises');
});

test('★ coverage counts a memeable viral post only when it was on For You before the early share of the line; earliness leaves out a post with no day\'s views', () => {
  const posts = [
    /* shown by the judge before 20% of the line */
    post({ itemId: 'a', shown: true, judgeNo: false, memeViral: true, shownAtMs: 10, earlyAtMs: 20, viewsShown: 100, views24: 1000 }),
    /* shown by the judge after it */
    post({ itemId: 'b', shown: true, judgeNo: false, memeViral: true, shownAtMs: 30, earlyAtMs: 20, viewsShown: 900, views24: 1000 }),
    /* the net adds it in time */
    post({ itemId: 'c', memeViral: true, addAtMs: 5, earlyAtMs: 20, viewsAdd: 50, views24: 1000 }),
    /* the net adds it too late */
    post({ itemId: 'd', memeViral: true, addAtMs: 25, earlyAtMs: 20, viewsAdd: 300, views24: null }),
    /* never clears the reach bar */
    post({ itemId: 'e', memeViral: true, gates: false, addAtMs: null, earlyAtMs: 20 }),
  ];
  const r = tableRow(posts, 0.5, 1);
  assert.deepEqual(r.coverage, { alone: 1, combined: 2, model: 1, of: 5 });
  assert.equal(r.extrasMemeViral, 2);
  assert.deepEqual(r.earliness.alone, { n: 2, medianShare: 0.5, medianViewsAt: 500, median24: 1000 });
  assert.equal(r.earliness.extras.n, 1, 'the post with no day\'s views is left out, never a zero');
  assert.equal(r.earliness.extras.medianShare, 0.05);
  assert.equal(r.earliness.combined.n, 3);
});

test('★ a row\'s weight: all ones is the unweighted fit, a zero-weight row is no row, a half-weight yes pulls less than a full one', () => {
  const row = (v: number, y: 0 | 1, w?: number): FitRow => ({ x: Float64Array.from([v]), y, ...(w === undefined ? {} : { w }) });
  const base = [row(-1, 0), row(-0.5, 0), row(0, 0), row(0.5, 1), row(1, 1), row(0.2, 0)];
  const plain = fitLogistic(base, 1);
  assert.deepEqual(fitLogistic(base.map((r) => ({ ...r, w: 1 })), 1), plain);
  const withZero = fitLogistic([...base, row(-2, 1, 0)], 1);
  assert.ok(Math.abs(withZero.intercept - plain.intercept) < 1e-9 && Math.abs((withZero.weights[0] ?? 0) - (plain.weights[0] ?? 0)) < 1e-9);
  const half = fitLogistic([...base, row(-0.8, 1, 0.5)], 1);
  const full = fitLogistic([...base, row(-0.8, 1, 1)], 1);
  const at = (f: typeof plain) => scoreRow([-0.8], f);
  assert.ok(at(plain) < at(half) && at(half) < at(full), `${at(plain)} < ${at(half)} < ${at(full)}`);
});

test('★ the matched threshold passes exactly as many posts as the judge did', () => {
  const scores = [0.9, 0.1, 0.7, 0.4, 0.8, 0.2];
  const t = matchedThreshold(scores, 3);
  assert.equal(t, 0.7);
  assert.equal(scores.filter((s) => s >= (t as number)).length, 3);
});

test('no matched threshold when the judge passed none or every post', () => {
  assert.equal(matchedThreshold([0.5, 0.6], 0), null);
  assert.equal(matchedThreshold([0.5, 0.6], 2), null);
  assert.equal(matchedThreshold([], 1), null);
});

test('a matched threshold stays strictly inside (0, 1)', () => {
  const t = matchedThreshold([1, 1, 0], 1) as number;
  assert.ok(t > 0 && t < 1);
  const z = matchedThreshold([0, 0, 0], 1) as number;
  assert.ok(z > 0 && z < 1);
});
