/**
 * The launch profile decoder: moments decode whole and in order, an absence decodes to its reason, a share
 * that is not a number in 0..1 is a dash rather than a zero bar, and an internal word on the wire is refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WireLeakError } from './decode.ts';
import { decodeCoinOdds } from './odds.ts';

const SHARES = { launches: 400, hit: [{ x: 2, share: 0.31 }, { x: 3, share: 0.18 }, { x: 5, share: 'lots' }, { x: 10, share: 0.004 }], rugged: 0.12, neverMoved: null, halfPeakS: 240 };
const MOMENT = {
  at: 'second_1',
  look: 'runner',
  group: '8 or more buyers in the first second',
  held: true,
  like: SHARES,
  normal: { ...SHARES, launches: 20_000, halfPeakS: -1 },
  signals: [
    { tone: 'red', label: 'Developer buy', value: '$250', context: 'Launches like it were rugged 30%, avg 10%', qualifier: 'Rug sign', explain: 'Of 900 launches…' },
    { tone: 'purple', label: 'x', qualifier: 'Strong' },
  ],
};

test('moments decode whole; a share that is not a number in 0..1 is dropped, never drawn as zero', () => {
  const o = decodeCoinOdds({ kind: 'odds', at: 'minute_1', days: 30, moments: [MOMENT, { ...MOMENT, at: 'minute_1' }, { at: 'hour_6' }] });
  assert.ok(o.kind === 'odds');
  if (o.kind !== 'odds') return;
  assert.deepEqual(o.moments.map((m) => m.at), ['second_1', 'minute_1']);
  assert.equal(o.at, 'minute_1');
  const m = o.moments[0];
  assert.deepEqual(m?.like.hit.map((h) => h.x), [2, 3, 10]);
  assert.equal(m?.like.neverMoved, null);
  assert.equal(m?.like.halfPeakS, 240);
  assert.equal(m?.normal.halfPeakS, null);
  assert.deepEqual(m?.signals.map((s) => s.qualifier), ['Rug sign']);
});

test('an absence decodes to its reason; a profile with no moment that decodes is not built', () => {
  assert.deepEqual(decodeCoinOdds({ kind: 'none', why: 'not_seen' }), { kind: 'none', why: 'not_seen' });
  assert.deepEqual(decodeCoinOdds({ kind: 'none', why: 'something else' }), { kind: 'none', why: 'not_built' });
  assert.deepEqual(decodeCoinOdds({ kind: 'odds', at: 'second_1', days: 30, moments: [] }), { kind: 'none', why: 'not_built' });
});

test('an internal word on the wire is refused', () => {
  assert.throws(() => decodeCoinOdds({ kind: 'odds', score: 3 }), WireLeakError);
});
