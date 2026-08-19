/**
 * THE ORDERING THE WHOLE LEARNING SUBSTRATE RESTS ON, ASSERTED.
 *
 * Until this file existed the runner had `config.test.ts`, `hash.test.ts` and
 * `supervisor.test.ts` — and nothing at all covering the write path. The single most
 * important sequence in the system, log → act → mark, was a comment and a code
 * ordering, both of which survive a refactor that reverses them.
 *
 * Every test here is a property the store, the migration or a stage doc states in
 * prose somewhere, turned into something that fails.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Decision, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts';

import { commitDecision, type DecisionLog, type DecisionReceipt } from './commit.ts';
import { createLogger } from './log.ts';
import { makeStageLoop, type LoopContext, type LoopDeps, type StageWork } from './loop.ts';

const silent = createLogger({ svc: 'test' });

/* ── fixtures ─────────────────────────────────────────────────────────── */

interface Subject {
  readonly id: string;
  readonly verdict: Decision['verdict'];
}

function decisionFor(subject: Subject, now: Millis): Decision {
  return {
    stage: 'admit',
    subjectKind: 'item',
    subjectId: subject.id,
    featureAsOf: now,
    decidedAt: now,
    subjectOrigin: null,
    horizonS: null,
    verdict: subject.verdict,
    reason: subject.verdict === 'pass' ? 'A0_admitted' : 'A4_score_below_bar',
    score: null,
    features: { one: 1, absent: null },
    featureSet: 'item.admit.v1',
    policyHash: 'hash',
    decider: 'rule:test@1',
    propensity: 1,
    explore: false,
    exploreArm: null,
    logSampleRate: 1,
    shadowOf: null,
    costUsd: 0,
  };
}

/** Everything the fake log and the fake work saw, in the order they saw it. */
interface Trace {
  readonly events: string[];
  readonly written: Decision[];
  readonly marked: string[];
}

function fakeLog(trace: Trace, opts: { writeThrows?: boolean } = {}): DecisionLog {
  let next = 0;
  return {
    write(decision) {
      if (opts.writeThrows === true) {
        trace.events.push(`write-threw:${decision.subjectId}`);
        return Promise.reject(new Error('the log is down'));
      }
      next += 1;
      const rowId = `row-${next}`;
      trace.events.push(`write:${decision.subjectId}:${rowId}`);
      trace.written.push(decision);
      return Promise.resolve(rowId);
    },
    markApplied(rowId) {
      trace.events.push(`mark:${rowId}`);
      trace.marked.push(rowId);
      return Promise.resolve();
    },
  };
}

function fakeWork(
  trace: Trace,
  subjects: readonly Subject[],
  opts: { applyThrowsFor?: string; subjectIdThrowsFor?: string } = {},
): StageWork<Subject> {
  return {
    pull: () => Promise.resolve(subjects),
    subjectId: (s) => {
      // `rankWork.subjectId` throws NotImplemented in the real wiring, so this is
      // not a hypothetical shape — it is one that ships.
      if (opts.subjectIdThrowsFor === s.id) throw new Error('this subject has no id');
      return s.id;
    },
    apply(subject, receipt) {
      if (opts.applyThrowsFor === subject.id) {
        trace.events.push(`apply-threw:${subject.id}`);
        return Promise.reject(new Error('the side effect failed'));
      }
      // The receipt carries the row id, so `apply` can only ever act against a
      // decision that reached the table. Recorded so the test can prove it.
      trace.events.push(`apply:${subject.id}:${receipt.rowId}`);
      return Promise.resolve();
    },
  };
}

function depsFor(log: DecisionLog): LoopDeps {
  const unused = {
    pull: () => Promise.resolve([]),
    subjectId: () => '',
    apply: () => Promise.resolve(),
  };
  return {
    policy: DEFAULT_POLICY,
    policyHash: 'hash',
    decisions: log,
    log: silent,
    admit: unused,
    track: unused,
    detect: unused,
    group: unused,
    qualify: unused,
    resolve: unused,
    rank: unused,
  } as unknown as LoopDeps;
}

function ctxFor(): LoopContext {
  return { signal: new AbortController().signal, now: () => 1_000 as Millis };
}

function loopOver(
  trace: Trace,
  subjects: readonly Subject[],
  opts: {
    applyThrowsFor?: string;
    writeThrows?: boolean;
    decideThrowsFor?: string;
    subjectIdThrowsFor?: string;
  } = {},
) {
  const log = fakeLog(trace, opts);
  return makeStageLoop<Subject>(
    {
      stage: 'admit',
      everyMs: 1,
      offsetMs: 0,
      batchSize: 10,
      decide: (subject, _policy, stageCtx) => {
        if (opts.decideThrowsFor === subject.id) {
          trace.events.push(`decide-threw:${subject.id}`);
          throw new Error('the decider blew up');
        }
        trace.events.push(`decide:${subject.id}`);
        return decisionFor(subject, stageCtx.now);
      },
      work: fakeWork(trace, subjects, opts),
    },
    depsFor(log),
  );
}

const emptyTrace = (): Trace => ({ events: [], written: [], marked: [] });

/* ── the ordering ─────────────────────────────────────────────────────── */

test('the order is decide, log, act, mark — for every subject', async () => {
  const trace = emptyTrace();
  const loop = loopOver(trace, [
    { id: 'a', verdict: 'pass' },
    { id: 'b', verdict: 'drop' },
  ]);

  await loop.run(ctxFor());

  assert.deepEqual(trace.events, [
    'decide:a',
    'write:a:row-1',
    'apply:a:row-1',
    'mark:row-1',
    'decide:b',
    'write:b:row-2',
    'apply:b:row-2',
    'mark:row-2',
  ]);
});

test('every verdict is written, not only the passes', async () => {
  // The population that makes a model possible is the drops. A pipeline that logs
  // only what it admitted has no negatives at all, and a classifier with no
  // negatives is not a classifier.
  const trace = emptyTrace();
  const loop = loopOver(trace, [
    { id: 'a', verdict: 'pass' },
    { id: 'b', verdict: 'drop' },
    { id: 'c', verdict: 'hold' },
    { id: 'd', verdict: 'abstain' },
  ]);

  const counts = await loop.run(ctxFor());

  assert.equal(trace.written.length, 4);
  assert.deepEqual(
    trace.written.map((d) => d.verdict),
    ['pass', 'drop', 'hold', 'abstain'],
  );
  // `out` counts passes; `in` counts rows. They are different numbers and the
  // second one is the one that matters to the log.
  assert.equal(counts.in, 4);
  assert.equal(counts.out, 1);
});

test('the side effect runs against the row that was written, never another', async () => {
  const trace = emptyTrace();
  const loop = loopOver(trace, [
    { id: 'a', verdict: 'pass' },
    { id: 'b', verdict: 'pass' },
  ]);

  await loop.run(ctxFor());

  // Each apply saw its own subject's row id. A receipt cannot be reused across
  // subjects because there is no way to construct one except from a write.
  assert.ok(trace.events.includes('apply:a:row-1'));
  assert.ok(trace.events.includes('apply:b:row-2'));
});

/* ── what happens when a step fails ───────────────────────────────────── */

test('a failed side effect leaves the row logged and unmarked', async () => {
  // THE PROPERTY THE WHOLE ASYMMETRY BUYS. `applied_at IS NULL` is queryable and
  // repairable; a side effect with no log is invisible AND correlated with
  // failures, so it biases the record exactly where bias hurts most.
  const trace = emptyTrace();
  const loop = loopOver(
    trace,
    [
      { id: 'a', verdict: 'pass' },
      { id: 'b', verdict: 'pass' },
    ],
    { applyThrowsFor: 'a' },
  );

  const counts = await loop.run(ctxFor());

  // The decision for 'a' was written …
  assert.equal(trace.written.length, 2);
  assert.ok(trace.written.some((d) => d.subjectId === 'a'));
  // … and never marked applied.
  assert.deepEqual(trace.marked, ['row-2']);

  // One poison subject is counted and does not stall the batch.
  assert.equal(counts.failed, 1);
  assert.equal(counts.in, 2);
  assert.match(counts.firstError ?? '', /^a: /);
});

test('a decider that throws writes nothing at all', async () => {
  // An exception is not a judgement. A row claiming otherwise would be a decision
  // nobody made, in a table whose entire value is that it holds only decisions
  // that were actually taken.
  const trace = emptyTrace();
  const loop = loopOver(
    trace,
    [
      { id: 'a', verdict: 'pass' },
      { id: 'b', verdict: 'pass' },
    ],
    { decideThrowsFor: 'a' },
  );

  const counts = await loop.run(ctxFor());

  assert.deepEqual(
    trace.written.map((d) => d.subjectId),
    ['b'],
  );
  assert.equal(counts.failed, 1);
});

test('a subject whose id cannot be built does not take the rest of the batch with it', async () => {
  /*
   * ★ THE FAILURE THAT LOOKED LIKE A CLEAN RUN. `spec.work.subjectId(input)` used to
   * be called ABOVE the try, so a throwing id took the whole remaining page down: the
   * exception escaped `run()`, the supervisor recorded a thrown run, and the subjects
   * after the poison one were never decided and never logged. A stage that wrote three
   * rows out of five hundred reported nothing at all — which is exactly the
   * "a partially-working stage hides" failure `LoopCounts.failed` was added to expose.
   *
   * It is not a hypothetical: `rankWork.subjectId` throws NotImplemented by design.
   */
  const trace = emptyTrace();
  const loop = loopOver(
    trace,
    [
      { id: 'a', verdict: 'pass' },
      { id: 'b', verdict: 'pass' },
      { id: 'c', verdict: 'drop' },
    ],
    { subjectIdThrowsFor: 'b' },
  );

  const counts = await loop.run(ctxFor());

  // The two subjects either side of the poison one were decided and written.
  assert.deepEqual(
    trace.written.map((d) => d.subjectId),
    ['a', 'c'],
  );

  // And the poison one is a counted failure with a nameable error, not a silence.
  assert.equal(counts.in, 3);
  assert.equal(counts.failed, 1);
  assert.match(counts.firstError ?? '', /this subject has no id/);
});

test('a failed write means the side effect is never attempted', async () => {
  // The direction the asymmetry chose. If the log is down we do not act and then
  // hope to write it up afterwards — that is precisely the invisible hole.
  const trace = emptyTrace();
  const loop = loopOver(trace, [{ id: 'a', verdict: 'pass' }], { writeThrows: true });

  const counts = await loop.run(ctxFor());

  assert.deepEqual(trace.events, ['decide:a', 'write-threw:a']);
  assert.equal(counts.failed, 1);
});

/* ── the guarantee, at the helper ─────────────────────────────────────── */

test('commitDecision cannot apply without writing first', async () => {
  // The structural claim, stated directly rather than through a loop: the only
  // path to a DecisionReceipt is a completed write, so an `apply` that ran has a
  // row behind it by construction. This test would still pass if the loop body
  // were rewritten; it is about the helper, which is where the guarantee lives.
  const trace = emptyTrace();
  const seen: DecisionReceipt[] = [];

  await commitDecision(
    {
      input: { id: 'a', verdict: 'pass' } as Subject,
      decide: () => decisionFor({ id: 'a', verdict: 'pass' }, 1_000 as Millis),
      apply: (input, receipt) => {
        seen.push(receipt);
        trace.events.push(`apply:${input.id}:${receipt.rowId}`);
        return Promise.resolve();
      },
    },
    { decisions: fakeLog(trace), now: () => 1_000 as Millis },
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.rowId, 'row-1');
  assert.equal(seen[0]?.decision.subjectId, 'a');
  assert.deepEqual(trace.events, ['write:a:row-1', 'apply:a:row-1', 'mark:row-1']);
});

test('the clock is read once per subject and handed in as a value', async () => {
  // A decider that could read the clock could read a fresher clock than its
  // features were built against, which is how lookahead comes back. The context
  // carries `now`; nothing downstream of it calls one.
  const trace = emptyTrace();
  let reads = 0;

  const loop = makeStageLoop<Subject>(
    {
      stage: 'admit',
      everyMs: 1,
      offsetMs: 0,
      batchSize: 10,
      decide: (subject, _policy, stageCtx) => {
        assert.equal(stageCtx.seed, `admit:${subject.id}`);
        assert.equal(stageCtx.policyHash, 'hash');
        return decisionFor(subject, stageCtx.now);
      },
      work: fakeWork(trace, [{ id: 'a', verdict: 'pass' }]),
    },
    depsFor(fakeLog(trace)),
  );

  await loop.run({
    signal: new AbortController().signal,
    now: () => {
      reads += 1;
      return 1_000 as Millis;
    },
  });

  // Once for the decision's context, once for the applied-at stamp. The stamp is
  // deliberately a second read: it records when the effect landed, not when we chose.
  assert.equal(reads, 2);
});
