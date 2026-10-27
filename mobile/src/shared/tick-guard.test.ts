/**
 * One odd trade never moves a price on screen: a jump waits for a second trade, a real dump shows one
 * trade later, and a glitch that the next trade contradicts is never shown.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIRM_MS, createTickGuard } from './tick-guard.ts';

const tick = (p: number | null, t = 0) => ({ a: 'COIN', p, t });
const prices = (ts: readonly { p: number | null }[]) => ts.map((x) => x.p);

test('★ a one-trade glitch the next trade contradicts is never shown', () => {
  const g = createTickGuard();
  assert.deepEqual(prices(g.pass([tick(1), tick(1.05)], 0)), [1, 1.05]);
  assert.deepEqual(prices(g.pass([tick(0.3)], 1_000)), [], 'held');
  assert.deepEqual(prices(g.pass([tick(1.02)], 1_500)), [1.02], 'the glitch is dropped, the next trade shown');
});

test('★ a real dump shows one trade later, both trades in order', () => {
  const g = createTickGuard();
  g.pass([tick(1)], 0);
  assert.deepEqual(prices(g.pass([tick(0.3)], 1_000)), []);
  assert.deepEqual(prices(g.pass([tick(0.31)], 2_000)), [0.3, 0.31]);
  assert.deepEqual(prices(g.pass([tick(0.29)], 3_000)), [0.29], 'from then on the new level is the reference');
});

test('a held trade with no confirmation in time is dropped; ordinary moves and the first trade pass at once', () => {
  const g = createTickGuard();
  assert.deepEqual(prices(g.pass([tick(5)], 0)), [5], 'nothing to jump from');
  assert.deepEqual(prices(g.pass([tick(6)], 100)), [6], 'a 20% move is ordinary trading');
  g.pass([tick(20)], 200);
  assert.deepEqual(prices(g.pass([tick(19.5)], 200 + CONFIRM_MS + 1)), [], 'too late to confirm the old jump; this one is itself a jump and waits');
  assert.deepEqual(prices(g.pass([tick(null)], 300)), [null], 'a trade without a dollar price is passed on as it is');
});
