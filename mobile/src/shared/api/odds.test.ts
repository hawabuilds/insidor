/**
 * The launch odds decoder: history decodes whole, an absence decodes to its reason, a share that is not a
 * number in 0..1 is a dash rather than a zero bar, and an internal word on the wire is refused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WireLeakError } from './decode.ts';
import { decodeCoinOdds } from './odds.ts';

const SHARES = { launches: 400, hit: [{ x: 2, share: 0.31 }, { x: 3, share: 0.18 }, { x: 5, share: 'lots' }, { x: 10, share: 0.004 }], rugged: 0.12, neverMoved: null };

test('history decodes whole; a share that is not a number in 0..1 is dropped, never drawn as zero', () => {
  const o = decodeCoinOdds({
    kind: 'odds',
    at: 'second_1',
    look: 'runner',
    headline: 'Launches that opened like this one, last 30 days',
    group: '8 or more buyers in the first second',
    held: true,
    like: SHARES,
    normal: { ...SHARES, launches: 20_000 },
    badges: [{ tone: 'red', fact: 'Creator bought $250 at launch', compare: 'rugged 30% vs 10%', explain: 'Of 900 launches…' }, { tone: 'purple', fact: 'x' }],
    days: 30,
  });
  assert.ok(o.kind === 'odds');
  if (o.kind !== 'odds') return;
  assert.deepEqual(o.like.hit.map((h) => h.x), [2, 3, 10]);
  assert.equal(o.like.neverMoved, null);
  assert.equal(o.badges.length, 1);
});

test('an absence decodes to its reason', () => {
  assert.deepEqual(decodeCoinOdds({ kind: 'none', why: 'not_seen' }), { kind: 'none', why: 'not_seen' });
  assert.deepEqual(decodeCoinOdds({ kind: 'none', why: 'something else' }), { kind: 'none', why: 'not_built' });
});

test('an internal word on the wire is refused', () => {
  assert.throws(() => decodeCoinOdds({ kind: 'odds', score: 3 }), WireLeakError);
});
