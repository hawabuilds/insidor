/** The junk filter's fit is deterministic and separates what it can; its threshold never drops a held-out protected post. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { junkProbability } from '@insidor/core';

import { chooseThreshold, crossJunk, droppedAt, fitJunk, foldKey, foldOf, junkScore, withMargin, type JunkExample, type JunkGroup } from './junk-fit.ts';

/* Two dimensions: junk leans to +x, keep to -x, with a little spread in y. */
const ex = (itemId: string, group: JunkGroup, x: number, y: number, text = `post ${itemId}`): JunkExample => ({ itemId, group, text, values: [x, y] });
const rows: JunkExample[] = [
  ...Array.from({ length: 12 }, (_, i) => ex(`n${i}`, 'not', 0.6 + (i % 4) * 0.1, (i % 3) * 0.1 - 0.1)),
  ...Array.from({ length: 6 }, (_, i) => ex(`g${i}`, 'gold', -0.6 - (i % 3) * 0.1, (i % 2) * 0.1)),
  ex('m0', 'missed', -0.2, 0.05),
  ex('c0', 'coined', -0.5, 0),
];

test('the fit is deterministic and puts junk above keep', () => {
  const a = fitJunk(rows, 0.1);
  const b = fitJunk(rows, 0.1);
  assert.deepEqual(a, b);
  assert.ok(junkScore([0.8, 0], a) > 0.5);
  assert.ok(junkScore([-0.8, 0], a) < 0.5);
});

test("core's probability is the fit's own arithmetic", () => {
  const w = fitJunk(rows, 0.1);
  const fit = { id: 1, space: 's', intercept: w.intercept, weights: w.weights, threshold: 0.9 };
  for (const v of [[0.3, 0.1], [-0.4, 0.2], [0, 0]]) assert.ok(Math.abs((junkProbability(v, 's', fit) as number) - junkScore(v, w)) < 1e-12);
});

test('every label gets a held-out score; copies with the same words share a fold', () => {
  const s = crossJunk(rows, 0.1, 3);
  assert.equal(s.size, rows.length);
  assert.equal(foldKey({ itemId: 'a', text: 'Same  WORDS https://t.co/x' }), foldKey({ itemId: 'b', text: 'same words' }));
  assert.equal(foldOf({ itemId: 'a', text: 'same words' }, 5), foldOf({ itemId: 'b', text: 'Same words https://t.co/y' }, 5));
  assert.notEqual(foldKey({ itemId: 'a', text: '' }), foldKey({ itemId: 'b', text: '' }), 'no words: the id decides');
});

test('★ the threshold sits above every protected post, so none is dropped, and the margin is in log-odds', () => {
  const score = new Map(rows.map((r) => [r.itemId, r.group === 'not' ? 0.95 : r.group === 'missed' ? 0.7 : r.group === 'coined' ? 0.96 : 0.2]));
  const pick = chooseThreshold(rows, score, 0.25);
  assert.equal(pick.highestProtected, 0.7);
  assert.equal(pick.highestProtectedId, 'm0');
  assert.ok(pick.threshold !== null && pick.threshold > 0.7);
  assert.equal(pick.threshold, withMargin(0.7, 0.25));
  const d = droppedAt(rows, score, pick.threshold!);
  assert.equal(d.gold.dropped, 0);
  assert.equal(d.missed.dropped, 0);
  assert.equal(d.not.dropped, 12);
  assert.equal(d.coined.dropped, 1, 'coined posts are reported, not gated');
});

test('no protected post, or one scored so high no threshold is left under 1: no threshold', () => {
  const onlyJunk = rows.filter((r) => r.group === 'not');
  assert.equal(chooseThreshold(onlyJunk, new Map(onlyJunk.map((r) => [r.itemId, 0.9])), 0.25).threshold, null);
  assert.equal(chooseThreshold(rows, new Map(rows.map((r) => [r.itemId, 1])), 0.25).threshold, null);
  assert.equal(chooseThreshold(rows, new Map(rows.map((r) => [r.itemId, 0.5])), 0).threshold, null, 'a zero margin would drop the protected post at the threshold');
});
