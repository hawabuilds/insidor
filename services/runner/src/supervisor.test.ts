/**
 * These tests are the repository's statement of what "dead" means.
 *
 * Every one of them asserts a state that the previous build could not produce:
 * an error that got written down, an empty run that did not look like a crash,
 * a stage that kept running after its own bookkeeping failed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHealthRegistry } from './health.ts';
import { createLogger } from './log.ts';
import type { Loop, LoopCounts } from './loop.ts';
import type { StageRunResult } from './run-record.ts';
import { backoffMs, supervise, type SupervisorDeps } from './supervisor.ts';

interface Recorded {
  readonly opens: { stage: string; startedAt: number }[];
  readonly closes: { runId: string; result: StageRunResult }[];
  readonly sleeps: number[];
  readonly pings: { stage: string; outcome: string }[];
}

const silent = createLogger({ svc: 'test' });

/** Runs `loop` for exactly `iterations` cycles, then aborts. */
async function driveLoop(
  loop: Loop,
  iterations: number,
  opts: { closeThrows?: boolean; openThrows?: boolean } = {},
): Promise<Recorded> {
  const rec: Recorded = { opens: [], closes: [], sleeps: [], pings: [] };
  const ac = new AbortController();

  let clock = 1_000;
  let sleepCalls = 0;
  let nextRunId = 0;

  const deps: SupervisorDeps = {
    host: 'test-host',
    log: silent,
    signal: ac.signal,
    now: () => (clock += 10),
    random: () => 0,
    health: createHealthRegistry('test-host', 0),
    heartbeat: {
      ping: async (stage, outcome) => {
        rec.pings.push({ stage: String(stage), outcome });
      },
    },
    stageRuns: {
      open: async (stage, _host, startedAt) => {
        if (opts.openThrows === true) throw new Error('open exploded');
        rec.opens.push({ stage: String(stage), startedAt });
        return `run-${(nextRunId += 1)}`;
      },
      close: async (runId, result) => {
        if (opts.closeThrows === true) throw new Error('close exploded');
        rec.closes.push({ runId, result });
      },
    },
    sleep: async (ms) => {
      rec.sleeps.push(ms);
      // The first sleep is the startup offset; count only the cycle sleeps.
      sleepCalls += 1;
      if (sleepCalls > iterations) ac.abort();
    },
  };

  await supervise(loop, deps);
  return rec;
}

function loopReturning(counts: LoopCounts, everyMs = 60_000): Loop {
  return { stage: 'admit', everyMs, offsetMs: 0, run: async () => counts };
}

test('a run that throws is still written down, as an error', async () => {
  const loop: Loop = {
    stage: 'admit',
    everyMs: 60_000,
    offsetMs: 0,
    run: async () => {
      throw new Error('the adapter is on fire');
    },
  };

  const rec = await driveLoop(loop, 1);

  assert.equal(rec.opens.length, 1, 'the run row is opened before the work');
  assert.equal(rec.closes.length, 1, 'the finally block closed it anyway');
  assert.equal(rec.closes[0]?.result.outcome, 'error');
  assert.equal(rec.closes[0]?.result.err, 'the adapter is on fire');
  assert.equal(rec.pings[0]?.outcome, 'error', 'a failed run pings /fail rather than staying quiet');
});

test("a run that finds nothing is 'empty', which is not 'error'", async () => {
  const rec = await driveLoop(loopReturning({ in: 0, out: 0, failed: 0, firstError: null }), 1);

  assert.equal(rec.closes[0]?.result.outcome, 'empty');
  assert.equal(rec.closes[0]?.result.err, null);
  assert.equal(rec.closes[0]?.result.compression, null, 'nothing out is a null ratio, not a zero');
});

test('a productive run records compression without anyone computing it', async () => {
  const rec = await driveLoop(loopReturning({ in: 900, out: 300, failed: 0, firstError: null }), 1);

  assert.equal(rec.closes[0]?.result.outcome, 'ok');
  assert.equal(rec.closes[0]?.result.compression, 3);
});

test('per-subject failures force an error outcome WITHOUT losing the counts', async () => {
  const rec = await driveLoop(
    loopReturning({ in: 500, out: 12, failed: 3, firstError: 'x:1 boom' }),
    1,
  );

  const result = rec.closes[0]?.result;
  assert.equal(result?.outcome, 'error');
  assert.equal(result?.err, 'x:1 boom');
  assert.equal(result?.itemsIn, 500, 'a partially working stage must not report zero input');
  assert.equal(result?.itemsOut, 12);
});

test('a failure to close the run row does not kill the loop', async () => {
  const rec = await driveLoop(loopReturning({ in: 1, out: 1, failed: 0, firstError: null }), 3, {
    closeThrows: true,
  });

  assert.ok(rec.opens.length >= 2, 'the loop kept cycling after its bookkeeping failed');
  assert.equal(rec.closes.length, 0, 'and the rows stay open, so it reads as stuck, not as quiet');
});

test('a failure to OPEN the run row is itself an error cycle, not a skipped one', async () => {
  const rec = await driveLoop(loopReturning({ in: 1, out: 1, failed: 0, firstError: null }), 2, {
    openThrows: true,
  });

  assert.equal(rec.closes.length, 0);
  assert.ok(rec.pings.some((p) => p.outcome === 'error'), 'the dead-man switch still hears about it');
});

test('the sleep never drops below the one-second floor', async () => {
  // A cadence smaller than the time the work takes would compute negative.
  const slow: Loop = {
    stage: 'admit',
    everyMs: 1,
    offsetMs: 0,
    run: async () => ({ in: 1, out: 1, failed: 0, firstError: null }),
  };

  const rec = await driveLoop(slow, 3);
  // The first sleep is the startup offset, which is allowed to be zero.
  const cycleSleeps = rec.sleeps.slice(1);
  assert.ok(cycleSleeps.length >= 2);
  for (const ms of cycleSleeps) assert.ok(ms >= 1_000, `slept ${ms}ms, which bills by the second`);
});

test('backoff grows with consecutive failures and is capped', () => {
  assert.equal(backoffMs(60_000, 0), 60_000, 'a healthy loop keeps its cadence');
  assert.equal(backoffMs(60_000, 1), 120_000);
  assert.equal(backoffMs(60_000, 2), 240_000);
  assert.equal(backoffMs(60_000, 99), 300_000, 'capped: past this the watchdog escalates');
  assert.equal(backoffMs(20_000, 1), 40_000);
});
