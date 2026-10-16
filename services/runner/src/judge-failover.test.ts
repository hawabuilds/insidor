/** The feed judge with a second supplier behind it: a failed, refused or silent batch goes to the other judge at once, the primary rests and is tried again, partial answers and frameless videos are not failures, and a budget refusal is not swallowed. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { storyId } from '@insidor/contracts/ids.ts';
import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import { NO_FRAME } from '@insidor/judge-anthropic';
import { BudgetRefused } from '@insidor/vendor-kit';

import { batchFailure, failoverJudge, failoverState } from './judge-failover.ts';
import type { Logger } from './log.ts';

const lines: string[] = [];
const log: Logger = { info: (m) => void lines.push(m), warn: (m) => void lines.push(m), error: (m) => void lines.push(m), child: () => log };
const policy = { on: true, deadlineMs: 1_000, coolDownMs: 60_000, creditCoolDownMs: 600_000 };
const budget = { capUsd: 10, spentUsd: 0, maxCalls: null, deadline: 0 } as never;

const subject = (n: number): JudgeSubject => ({ storyId: storyId(`post-x-${n}`), texts: [`post ${n}`], media: [], distinctAuthors: 1, distinctSources: 1 });
const judged = (s: JudgeSubject, judgeId: string): JudgeOutcome => ({
  kind: 'judged',
  judgement: { judgeId, promptId: 'post-coinability@p', judgedAt: 0, coinable: true, confidence: 0.9, lookedAt: 'text', proposedName: 'CAT', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.001 } as unknown as Judgement,
});
const unavailable = (s: JudgeSubject, detail: string): JudgeOutcome => ({ kind: 'unavailable', storyId: s.storyId, detail });

type Behaviour = 'answer' | 'refuse' | 'credit' | 'throw' | 'hang' | 'budget' | ((subjects: readonly JudgeSubject[]) => readonly JudgeOutcome[]);

function port(name: string, behave: () => Behaviour, asked: string[][]): JudgePort {
  return {
    id: `judge:${name}`,
    promptId: 'post-coinability@p',
    maxBatch: 10,
    estimate: () => ({ vendor: name, endpoint: 'judge', unit: 'per-call', estUnits: 1, usd: 0.01 }),
    async judge(subjects) {
      asked.push(subjects.map((s) => String(s.storyId)));
      const b = behave();
      const spend = { vendor: name, endpoint: 'judge', unit: 'per-call' as const, units: 1, usd: 0.01, at: 0 as never };
      if (b === 'throw') throw new Error(`${name} socket hang up`);
      if (b === 'budget') throw new BudgetRefused(name, 'judge', 'the day is spent' as never);
      if (b === 'hang') return new Promise(() => undefined);
      const value =
        typeof b === 'function'
          ? b(subjects)
          : subjects.map((s) => (b === 'answer' ? judged(s, `judge:${name}`) : unavailable(s, b === 'credit' ? `${name} unavailable at judge: refused for billing: credit balance too low` : `${name} unavailable at judge: answered 529`)));
      return { value, spend };
    },
  };
}

/** A wait that fires at once when `fire` is true, else never: the deadline without real time. */
const instant = (fire: () => boolean) => (_ms: number) => ({ done: fire() ? Promise.resolve() : new Promise<void>(() => undefined), cancel: () => undefined });

test('a refused batch goes to the other judge at once; the primary rests, then answers again', async () => {
  let clock = 0;
  let primaryDoes: Behaviour = 'refuse';
  const pAsked: string[][] = [];
  const fAsked: string[][] = [];
  const state = failoverState();
  const j = failoverJudge({ primary: port('main', () => primaryDoes, pAsked), fallback: port('open', () => 'answer', fAsked), state, policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => clock, wait: instant(() => false) });
  const r1 = await j.judge([subject(1), subject(2)], budget);
  assert.deepEqual(r1.value.map((o) => (o.kind === 'judged' ? o.judgement.judgeId : o.kind)), ['judge:open', 'judge:open']);
  assert.equal(state.outages, 1);
  assert.equal(state.restingUntil, policy.coolDownMs);
  /* While it rests the primary is not asked. */
  clock = 30_000;
  await j.judge([subject(3)], budget);
  assert.equal(pAsked.length, 1);
  assert.equal(fAsked.length, 2);
  /* After the rest it is asked again and, answering, carries the feed. */
  clock = 61_000;
  primaryDoes = 'answer';
  const r3 = await j.judge([subject(4)], budget);
  assert.equal(r3.value[0]?.kind === 'judged' && r3.value[0].judgement.judgeId, 'judge:main');
  assert.equal(pAsked.length, 2);
  assert.equal(state.reason, null);
  assert.equal(state.handedOver, 2);
});

test('a billing refusal rests the primary for the longer time; a thrown error and a silent call fail over too', async () => {
  const state = failoverState();
  const j = failoverJudge({ primary: port('main', () => 'credit', []), fallback: port('open', () => 'answer', []), state, policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => 0, wait: instant(() => false) });
  await j.judge([subject(1)], budget);
  assert.equal(state.restingUntil, policy.creditCoolDownMs);

  const thrown = failoverJudge({ primary: port('main', () => 'throw', []), fallback: port('open', () => 'answer', []), state: failoverState(), policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => 0, wait: instant(() => false) });
  const r = await thrown.judge([subject(1)], budget);
  assert.equal(r.value[0]?.kind, 'judged');

  /* The other way round: the open model first, hanging past the deadline; the main judge answers. */
  const slow = failoverJudge({ primary: port('open', () => 'hang', []), fallback: port('main', () => 'answer', []), state: failoverState(), policy, names: { primary: 'open', fallback: 'main' }, question: 'post', log, now: () => 0, wait: instant(() => true) });
  const s = await slow.judge([subject(1)], budget);
  assert.equal(s.value[0]?.kind === 'judged' && s.value[0].judgement.judgeId, 'judge:main');
});

test('a partly answered batch and a frameless video are not failures; only the unanswered go across', async () => {
  const partial = (subjects: readonly JudgeSubject[]) => subjects.map((s, i) => (i === 0 ? judged(s, 'judge:main') : unavailable(s, 'no answer for this story')));
  assert.equal(batchFailure(partial([subject(1), subject(2)])), null);
  assert.equal(batchFailure([unavailable(subject(1), NO_FRAME)]), null);
  assert.match(batchFailure([unavailable(subject(1), NO_FRAME), unavailable(subject(2), 'answered 500')]) ?? '', /500/);

  const fAsked: string[][] = [];
  const state = failoverState();
  const mixed = (subjects: readonly JudgeSubject[]) => subjects.map((s, i) => unavailable(s, i === 0 ? NO_FRAME : 'answered 500'));
  const j = failoverJudge({ primary: port('main', () => mixed, []), fallback: port('open', () => 'answer', fAsked), state, policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => 0, wait: instant(() => false) });
  const r = await j.judge([subject(1), subject(2)], budget);
  /* The frameless video is not sent across; the failed post is. */
  assert.deepEqual(fAsked, [[String(subject(2).storyId)]]);
  assert.equal(r.value[0]?.kind === 'unavailable' && r.value[0].detail, NO_FRAME);
  assert.equal(r.value[1]?.kind, 'judged');

  const p = failoverJudge({ primary: port('main', () => partial, []), fallback: port('open', () => 'answer', []), state: failoverState(), policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => 0, wait: instant(() => false) });
  const pr = await p.judge([subject(1), subject(2)], budget);
  assert.equal(pr.value[1]?.kind, 'unavailable');
});

test('a budget refusal is rethrown, and with no other judge the primary runs alone', async () => {
  const fAsked: string[][] = [];
  const j = failoverJudge({ primary: port('main', () => 'budget', []), fallback: port('open', () => 'answer', fAsked), state: failoverState(), policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => 0, wait: instant(() => false) });
  await assert.rejects(j.judge([subject(1)], budget), BudgetRefused);
  assert.equal(fAsked.length, 0);
  const alone = port('main', () => 'answer', []);
  assert.equal(failoverJudge({ primary: alone, fallback: null, state: failoverState(), policy, names: { primary: 'main', fallback: 'none' }, question: 'post', log, now: () => 0 }), alone);
});

test('while the primary rests and the other judge fails too, the primary is asked anyway', async () => {
  let clock = 0;
  const state = failoverState();
  let primaryDoes: Behaviour = 'refuse';
  const j = failoverJudge({ primary: port('main', () => primaryDoes, []), fallback: port('open', () => (clock === 0 ? 'answer' : 'refuse'), []), state, policy, names: { primary: 'main', fallback: 'open' }, question: 'post', log, now: () => clock, wait: instant(() => false) });
  await j.judge([subject(1)], budget);
  clock = 10_000;
  primaryDoes = 'answer';
  const r = await j.judge([subject(2)], budget);
  assert.equal(r.value[0]?.kind === 'judged' && r.value[0].judgement.judgeId, 'judge:main');
  assert.equal(state.restingUntil, 0);
});
