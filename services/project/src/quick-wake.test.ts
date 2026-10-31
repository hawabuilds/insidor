/**
 * The launcher's wake, against a stand-in probe and frame: the first read only sets the cursor; a
 * due quick frame is handed the cursor before it and moves it; a failed one puts it back and waits
 * out the gap even when every kind is in; the probe is read at most every `checkEveryMs` and is
 * asked about the yeses past the cursor; a probe outage is said once.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { QuickCursor, QuickProbe } from './quick-frame.ts';
import { quickWake } from './quick-wake.ts';

const P = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, quickFrame: { on: true, checkEveryMs: 5_000, minGapMs: 20_000, settleMs: 10_000, kindsInSkipsWait: true, barCross: { on: true, maxPosts: 40 }, pickChange: true } } };

function setup(ok = true) {
  const clock = { now: 1_000_000 };
  const state: { probe: QuickProbe | Error } = { probe: { answerId: 1, answerAtMs: 0, atMs: 1_000_000, linkAtMs: null, callAtMs: null } };
  const runs: QuickCursor[] = [];
  const asked: (QuickCursor | null)[] = [];
  const logs: Record<string, unknown>[] = [];
  let reads = 0;
  const wake = quickWake({
    probe: async (since) => {
      reads += 1;
      asked.push(since);
      if (state.probe instanceof Error) throw state.probe;
      return state.probe;
    },
    run: async (from) => (runs.push(from), ok),
    policy: P,
    now: () => clock.now,
    log: (f) => void logs.push(f),
  });
  /* The first read sets the cursor; the next check is a checkEveryMs later. */
  const start = async () => {
    await wake.maybe();
    clock.now += 6_000;
  };
  return { wake, clock, state, runs, asked, logs, start, reads: () => reads };
}

test('the first read only sets the cursor: what was filed before the lane began is the full frame\'s', async () => {
  const s = setup();
  s.state.probe = { answerId: 5, answerAtMs: 0, atMs: 1_000_000, linkAtMs: null, callAtMs: null };
  await s.wake.maybe();
  assert.deepEqual(s.runs, []);
  assert.deepEqual(s.asked, [null], 'no cursor yet: no kinds asked');
});

test('★ a due quick frame gets the cursor before it, and the next looks past the new one', async () => {
  const s = setup();
  await s.start();
  s.state.probe = { answerId: 7, answerAtMs: 0, atMs: 1_006_000, linkAtMs: null, callAtMs: null };
  await s.wake.maybe();
  assert.deepEqual(s.runs, [{ answerId: 1, atMs: 1_000_000 }]);
  assert.deepEqual(s.asked.at(-1), { answerId: 1, atMs: 1_000_000 }, 'the probe is asked about the yeses past the cursor');
  s.clock.now += 30_000;
  await s.wake.maybe();
  assert.equal(s.runs.length, 1, 'nothing new since: no second frame');
});

test('★ every yes with its kind: the next quick frame runs at once, inside the gap and before the settle', async () => {
  const s = setup();
  await s.start();
  s.state.probe = { answerId: 7, answerAtMs: 0, atMs: 1_006_000, linkAtMs: null, callAtMs: null };
  await s.wake.maybe();
  s.clock.now += 6_000;
  s.state.probe = { answerId: 9, answerAtMs: s.clock.now - 1_000, atMs: s.clock.now, linkAtMs: null, callAtMs: null, kinds: { yeses: 1, awaitingKind: 0 } };
  await s.wake.maybe();
  assert.equal(s.runs.length, 2);
});

test('a failed quick frame puts the cursor back, and is tried again after the gap — kinds in or not', async () => {
  const s = setup(false);
  await s.start();
  s.state.probe = { answerId: 7, answerAtMs: 0, atMs: 1_000_000, linkAtMs: null, callAtMs: null, kinds: { yeses: 1, awaitingKind: 0 } };
  await s.wake.maybe();
  s.clock.now += 6_000;
  await s.wake.maybe();
  assert.equal(s.runs.length, 1, 'inside the gap');
  s.clock.now += 20_000;
  await s.wake.maybe();
  assert.deepEqual(s.runs, [{ answerId: 1, atMs: 1_000_000 }, { answerId: 1, atMs: 1_000_000 }]);
});

test('the probe is read at most every checkEveryMs', async () => {
  const s = setup();
  await s.start();
  const before = s.reads();
  await s.wake.maybe();
  await s.wake.maybe();
  await s.wake.maybe();
  assert.equal(s.reads() - before, 1);
});

test('a probe that fails is said once, and the wake carries on when it answers again', async () => {
  const s = setup();
  await s.start();
  s.state.probe = new Error('connection refused');
  await s.wake.maybe();
  s.clock.now += 6_000;
  await s.wake.maybe();
  assert.equal(s.logs.filter((l) => l['level'] === 'warn').length, 1);
  s.state.probe = { answerId: 9, answerAtMs: 0, atMs: 1_000_000, linkAtMs: null, callAtMs: null };
  s.clock.now += 6_000;
  await s.wake.maybe();
  assert.equal(s.runs.length, 1);
});
