/** The coin model's fit and the owner's table: the fit separates, the table counts only the net's own extras, the threshold keeps to the bars. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { added, averagePrecision, chooseThreshold, fitLogistic, scoreRow, standardisation, tableRow, type FitRow, type TablePost } from './coin-fit.ts';

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

const post = (o: Partial<TablePost>): TablePost => ({ itemId: 'x:1', score: 0.9, coined: false, shown: false, judgeNo: true, gates: true, junk: null, tappedNot: false, ...o });

test('★ only a judged-no post, not already shown, that clears the other gates is an extra', () => {
  assert.equal(added(post({}), 0.8), true);
  assert.equal(added(post({ shown: true }), 0.8), false);
  assert.equal(added(post({ judgeNo: false }), 0.8), false);
  assert.equal(added(post({ gates: false }), 0.8), false);
  assert.equal(added(post({ score: 0.7 }), 0.8), false);
});

test('the table: extras an hour, coined caught alone and combined, and the junk rise in points', () => {
  const posts = [
    post({ itemId: 'a', shown: true, judgeNo: false, coined: true, junk: false }),
    post({ itemId: 'b', shown: true, judgeNo: false, junk: true, tappedNot: true }),
    post({ itemId: 'c', coined: true, junk: false }),
    post({ itemId: 'd', junk: true, score: 0.95 }),
    post({ itemId: 'e', score: 0.2, junk: true }),
  ];
  const r = tableRow(posts, 0.8, 2);
  assert.equal(r.extras, 2);
  assert.equal(r.extrasPerHour, 1);
  assert.equal(r.extrasCoined, 1);
  assert.deepEqual(r.coined, { alone: 1, combined: 2, model: 2, of: 2 });
  assert.equal(r.junkAlone, 0.5);
  assert.equal(r.junkCombined, 0.5);
  assert.equal(r.junkRise, 0);
  assert.deepEqual(r.tapsAlone, { not: 1, shown: 2 });
  assert.equal(chooseThreshold(posts, [0.1, 0.8, 0.99], 2, 0.03, 0.5), 0.99, 'one an hour is over a cap of 0.5');
  assert.equal(chooseThreshold(posts, [0.1, 0.8], 2, 0.03, 5), 0.8, 'at 0.1 the junk rises');
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
