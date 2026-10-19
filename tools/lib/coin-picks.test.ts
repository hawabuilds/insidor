/**
 * The "Coin picks" section's arithmetic on made-up rows: a pick against the owner's call, and the
 * line between "no pick" (his coin was weighed) and "never weighed" (the matcher missed it).
 * Run: node --test --experimental-strip-types tools/lib/coin-picks.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PostCoinCalls } from '../../core/src/index.ts';
import { coinPickLines, verdictOf, type PickRow } from './coin-picks.ts';

const pick = (id: string, address: string | null, outcome: PickRow['outcome'], basis: PickRow['basis'] = 'market_readings', kind: PickRow['kind'] = 'post'): PickRow => ({ kind, id, address, outcome, basis });
const own = (address: string): PostCoinCalls => ({ own: { address, atMs: 0 }, wrong: new Map(), none: false });

test('a pick against the owner\'s call: right, wrong, no pick with his coin weighed, his coin never weighed', () => {
  assert.equal(verdictOf(pick('a', 'ESAB', 'picked'), own('ESAB'), new Set(['ESAB'])), 'right');
  assert.equal(verdictOf(pick('a', '5pwu', 'picked'), own('ESAB'), new Set(['5pwu'])), 'wrong');
  assert.equal(verdictOf(pick('a', null, 'waiting'), own('ESAB'), new Set(['ESAB', '5pwu'])), 'no_pick');
  assert.equal(verdictOf(pick('a', null, 'waiting'), own('ESAB'), new Set(['5pwu'])), 'never_weighed');
  /* "No coin is from this": no pick is right, any pick is wrong. */
  const none: PostCoinCalls = { own: null, wrong: new Map(), none: true };
  assert.equal(verdictOf(pick('a', null, 'none'), none, new Set()), 'right');
  assert.equal(verdictOf(pick('a', 'X', 'picked'), none, new Set(['X'])), 'wrong');
  /* Only "wrong coin" with no coin given: wrong when the pick is that coin, else nothing to compare. */
  const wrongOnly: PostCoinCalls = { own: null, wrong: new Map([['5pwu', 0]]), none: false };
  assert.equal(verdictOf(pick('a', '5pwu', 'picked'), wrongOnly, new Set()), 'wrong');
  assert.equal(verdictOf(pick('a', 'ESAB', 'picked'), wrongOnly, new Set()), null);
  assert.equal(verdictOf(pick('a', 'ESAB', 'picked'), undefined, new Set()), null);
});

test('the section counts posts and narratives by where they stand, split by what they were judged on', () => {
  const lines = coinPickLines(
    [pick('p1', 'ESAB', 'picked', 'trades'), pick('p2', null, 'waiting'), pick('p3', null, 'none', null), pick('n1', 'HI', 'picked', 'market_readings', 'narrative')],
    new Map([['p1', own('ESAB')], ['p2', own('KIM')]]),
    new Map([['p1', new Set(['ESAB'])], ['p2', new Set(['OTHER'])]]),
  );
  assert.equal(lines[0], 'Posts: 3 judged — got a coin 1 (1 on trades); waited, no clear leader yet 1 (1 on market readings); showed Create, no coin of the name 1');
  assert.equal(lines[1], 'Narratives: 1 judged — got a coin 1 (1 on market readings); waited, no clear leader yet 0; showed Create, no coin of the name 0');
  assert.ok(lines.includes('Against my coin calls (2 posts):'));
  assert.ok(lines.includes('- right: 1 (1 on trades)'));
  assert.ok(lines.includes('- my coin was never among those weighed: 1'));
});
