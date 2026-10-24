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

function ports(states: Record<string, 'open' | 'paired' | 'complete' | 'none'>, answers: Record<string, 'route' | 'no route' | 'rate limited'>): RoutePorts & { asked: string[] } {
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

test('★ a curve priced in another token (a stock pair) is asked of the aggregator, so the card agrees with the Buy sheet', async () => {
  const p = ports({ S: 'paired', T: 'paired' }, { S: 'route' });
  const { routes } = await routesFor(['S', 'T'], new Map(), keyOf, p, OPTS);
  assert.equal(routes.get('S'), 'pool');
  assert.equal(routes.get('T'), 'none');
  assert.deepEqual(p.asked, ['S', 'T']);
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

test('a rate limit is not "no route"; asked once more after a wait, a second refusal stops the asking for this pass', async () => {
  const p = ports({ A: 'none', B: 'none' }, { A: 'rate limited', B: 'route' });
  const waits: number[] = [];
  const paced: RoutePorts = { curveStates: p.curveStates, probe: p.probe, pause: async (ms) => { waits.push(ms); } };
  const { routes, counts } = await routesFor(['A', 'B'], new Map(), keyOf, paced, { ...OPTS, maxProbes: 10, probeGapMs: 1_000, retryAfterMs: 5_000 });
  assert.equal(routes.get('A'), null);
  assert.equal(routes.get('B'), null);
  assert.equal(counts.unavailable, 1);
  assert.deepEqual(p.asked, ['A', 'A']);
  assert.deepEqual(waits, [5_000]);
});

test('★ the probes are spaced, and a rate limit that clears is waited out: the pass asks its whole bound (2026-10-21: five answered, the sixth refused, the rest never asked)', async () => {
  const asked: string[] = [];
  const waits: number[] = [];
  let unpaced = 0;
  /* An aggregator that refuses a sixth request in a row sent without a long wait, like the live one. */
  const p: RoutePorts = {
    curveStates: async (mints) => new Map(mints.map((m) => [m, 'complete' as const])),
    probe: async (mint) => {
      asked.push(mint);
      unpaced += 1;
      if (unpaced > 5) throw new Error('aggregator unavailable at quote: rate limited; try again in a moment');
      return {};
    },
    pause: async (ms) => {
      waits.push(ms);
      if (ms >= 5_000) unpaced = 0;
    },
  };
  const coins = Array.from({ length: 12 }, (_, i) => `C${i}`);
  const { routes, counts } = await routesFor(coins, new Map(), keyOf, p, { ...OPTS, maxProbes: 40, probeGapMs: 1_000, retryAfterMs: 5_000 });
  assert.equal(counts.pool, 12, 'every coin answered');
  assert.equal(counts.notAsked, 0);
  assert.equal(routes.get('C11'), 'pool');
  assert.equal(waits.filter((w) => w === 1_000).length, 11, 'a gap before every probe after the first');
  assert.equal(asked.length, 14, 'two refusals, each asked again once');
});

test('★ a coin over the probe bound keeps the route the aggregator gave it within the hour, written as kept', async () => {
  const p = ports({ A: 'complete', B: 'complete', C: 'complete', D: 'complete' }, { A: 'route', B: 'route' });
  const last = new Map([
    /* Routed 40 minutes ago, in an earlier window: kept. */
    ['solana:C', { takenAt: NOW - 40 * 60_000, tradable: true, quotedBy: 'solana:pool' }],
    /* Routed two hours ago: too old to keep, so not asked. */
    ['solana:D', { takenAt: NOW - 120 * 60_000, tradable: true, quotedBy: 'solana:pool' }],
  ]);
  const { routes, counts } = await routesFor(['A', 'B', 'C', 'D'], last, keyOf, p, { ...OPTS, keepMs: 3_600_000 });
  assert.deepEqual(p.asked, ['A', 'B']);
  assert.equal(routes.get('C'), 'kept');
  assert.equal(routes.get('D'), null);
  assert.equal(counts.kept, 1);
  assert.equal(counts.notAsked, 1);
});

test('a "no route" answer is never kept as a route', async () => {
  const p = ports({ A: 'complete', B: 'complete', C: 'complete' }, { A: 'route', B: 'route' });
  const last = new Map([['solana:C', { takenAt: NOW - 40 * 60_000, tradable: false, quotedBy: 'solana:pool' }]]);
  const { routes } = await routesFor(['A', 'B', 'C'], last, keyOf, p, { ...OPTS, keepMs: 3_600_000 });
  assert.equal(routes.get('C'), null);
});
