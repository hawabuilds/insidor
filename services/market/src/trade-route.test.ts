/**
 * The pass's trade routes against stand-ins for the chain and the aggregator: an open curve
 * never reaches the aggregator, a failed curve read asks nobody, answers are reused inside their
 * window, and the probe bound and a struggling aggregator both stop the asking.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { routesFor, type RoutePorts } from './trade-route.ts';

const WINDOW = 900_000;
const NOW = 20 * WINDOW + 5_000;
const OPTS = { nowMs: NOW, reuseMs: WINDOW, maxProbes: 2 };
const keyOf = (a: string): string => `solana:${a}`;

function ports(states: Record<string, 'open' | 'complete' | 'none'>, answers: Record<string, 'route' | 'no route' | 'rate limited'>): RoutePorts & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    curveStates: async (mints) => new Map(mints.map((m) => [m, states[m] ?? 'none'])),
    probe: async (mint) => {
      asked.push(mint);
      const a = answers[mint] ?? 'no route';
      if (a === 'route') return {};
      throw new Error(`aggregator unavailable at quote: ${a}`);
    },
  };
}

test('an open curve is the curve route and the aggregator is never asked about it', async () => {
  const p = ports({ A: 'open', B: 'complete' }, { B: 'route' });
  const { routes, counts } = await routesFor(['A', 'B'], new Map(), keyOf, p, OPTS);
  assert.equal(routes.get('A'), 'curve');
  assert.equal(routes.get('B'), 'pool');
  assert.deepEqual(p.asked, ['B']);
  assert.equal(counts.curve, 1);
  assert.equal(counts.pool, 1);
});

test('★ a failed curve read asks nobody: every coin is not asked, never "no route"', async () => {
  const p = ports({}, {});
  const failing: RoutePorts = { curveStates: async () => { throw new Error('rpc down'); }, probe: p.probe };
  const { routes, counts } = await routesFor(['A', 'B'], new Map(), keyOf, failing, OPTS);
  assert.equal(routes.get('A'), null);
  assert.equal(routes.get('B'), null);
  assert.equal(counts.notAsked, 2);
  assert.deepEqual(p.asked, []);
});

test('no chain access asks nobody', async () => {
  const p = ports({}, {});
  const { routes } = await routesFor(['A'], new Map(), keyOf, { curveStates: null, probe: p.probe }, OPTS);
  assert.equal(routes.get('A'), null);
  assert.deepEqual(p.asked, []);
});

test('an answer from this window is reused instead of asking again', async () => {
  const p = ports({ A: 'complete', B: 'none' }, {});
  const last = new Map([
    ['solana:A', { takenAt: NOW - 1_000, tradable: true, quotedBy: 'solana:pool' }],
    ['solana:B', { takenAt: NOW - 2_000, tradable: false, quotedBy: 'solana:pool' }],
  ]);
  const { routes, counts } = await routesFor(['A', 'B'], last, keyOf, p, OPTS);
  assert.equal(routes.get('A'), 'pool');
  assert.equal(routes.get('B'), 'none');
  assert.equal(counts.reused, 2);
  assert.deepEqual(p.asked, []);
});

test('the probe bound leaves the rest not asked, in the order given', async () => {
  const p = ports({ A: 'none', B: 'none', C: 'none' }, { A: 'route', B: 'no route', C: 'route' });
  const { routes } = await routesFor(['A', 'B', 'C'], new Map(), keyOf, p, OPTS);
  assert.equal(routes.get('A'), 'pool');
  assert.equal(routes.get('B'), 'none');
  assert.equal(routes.get('C'), null);
  assert.deepEqual(p.asked, ['A', 'B']);
});

test('a rate limit is not "no route", and stops the asking for this pass', async () => {
  const p = ports({ A: 'none', B: 'none' }, { A: 'rate limited', B: 'route' });
  const { routes, counts } = await routesFor(['A', 'B'], new Map(), keyOf, p, { ...OPTS, maxProbes: 10 });
  assert.equal(routes.get('A'), null);
  assert.equal(routes.get('B'), null);
  assert.equal(counts.unavailable, 1);
  assert.deepEqual(p.asked, ['A']);
});
