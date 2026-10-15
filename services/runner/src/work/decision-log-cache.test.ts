/** ADMIT's bar and admission count are read once per hold, per question, and a failure is never held. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';

import { HOLD_MS, heldDecisionReads } from './decision-log-cache.ts';

function setup() {
  let now = 1_000_000;
  const calls = { quantile: 0, count: 0 };
  let fail = false;
  const source = {
    scoreQuantile: async (_stage: string, _since: Millis, q: number) => {
      calls.quantile += 1;
      if (fail) throw new Error('statement timeout');
      return q * 10 + calls.quantile;
    },
    countSince: async () => ((calls.count += 1), calls.count * 100),
  };
  const held = heldDecisionReads(source as never, HOLD_MS, () => now);
  return { held, calls, advance: (ms: number) => (now += ms), setFail: (v: boolean) => (fail = v) };
}

test('a second read inside the hold is answered from memory', async () => {
  const { held, calls, advance } = setup();
  const first = await held.scoreQuantile('admit', 0 as Millis, 0.9);
  advance(HOLD_MS - 1);
  assert.equal(await held.scoreQuantile('admit', 5 as Millis, 0.9), first);
  assert.equal(calls.quantile, 1);
});

test('the hold expires and the next read goes to the log', async () => {
  const { held, calls, advance } = setup();
  await held.countSince('admit', 'pass', 0 as Millis);
  advance(HOLD_MS);
  assert.equal(await held.countSince('admit', 'pass', 0 as Millis), 200);
  assert.equal(calls.count, 2);
});

test('each stage, quantile and verdict is held separately', async () => {
  const { held, calls } = setup();
  await held.scoreQuantile('admit', 0 as Millis, 0.9);
  await held.scoreQuantile('admit', 0 as Millis, 0.5);
  await held.scoreQuantile('track', 0 as Millis, 0.9);
  await held.countSince('admit', 'pass', 0 as Millis);
  await held.countSince('admit', 'drop', 0 as Millis);
  assert.deepEqual(calls, { quantile: 3, count: 2 });
});

test('two passes asking at once share one read', async () => {
  const { held, calls } = setup();
  await Promise.all([held.countSince('admit', 'pass', 0 as Millis), held.countSince('admit', 'pass', 0 as Millis)]);
  assert.equal(calls.count, 1);
});

test('a failed read is not held: the next pass asks again', async () => {
  const { held, calls, setFail } = setup();
  setFail(true);
  await assert.rejects(held.scoreQuantile('admit', 0 as Millis, 0.9));
  setFail(false);
  assert.equal(await held.scoreQuantile('admit', 0 as Millis, 0.9), 11);
  assert.equal(calls.quantile, 2);
});
