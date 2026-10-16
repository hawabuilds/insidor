/** The shadow judge: answers each live batch beside it and stores both, never in the live judge's way, stops at its day's cap (read from the ledger, so a restart does not refill it), and does not shadow an answer its own model gave. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { storyId, type ItemId } from '@insidor/contracts/ids.ts';
import type { Judgement } from '@insidor/contracts/judgement.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { ShadowPair } from '@insidor/store';

import { judgeShadow, type Offered } from './judge-shadow.ts';
import type { Logger } from './log.ts';
import { memoryLaneLedger } from './work/lane-ledger.ts';

const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => log };
const meter = { mayspend: () => true, line: () => ({ capUsd: 40, spentUsd: 0, remainingUsd: 40 }) } as unknown as Meter;
const answer = (judgeId: string, coinable: boolean): JudgeOutcome => ({
  kind: 'judged',
  judgement: { judgeId, promptId: 'post-coinability@p', judgedAt: 0, coinable, confidence: 0.8, lookedAt: 'text', proposedName: 'CAT', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.0002 } as unknown as Judgement,
});
const subject = (n: number): JudgeSubject => ({ storyId: storyId(`post-x-${n}`), texts: [`post ${n}`], media: [], distinctAuthors: 1, distinctSources: 1 });
const offered = (n: number, liveJudge = 'judge:anthropic/m@p'): Offered => ({ itemId: `x:${n}` as ItemId, subject: subject(n), live: answer(liveJudge, true) });

function shadowPort(calls: number[], usd = 0.01, hold?: Promise<void>): JudgePort {
  return {
    id: 'judge:openrouter/g@p',
    promptId: 'post-coinability@p',
    maxBatch: 10,
    estimate: (s) => ({ vendor: 'openrouter', endpoint: 'judge-shadow', unit: 'per-call', estUnits: 1, usd: 0.005 * s.length }),
    async judge(subjects) {
      calls.push(subjects.length);
      if (hold !== undefined) await hold;
      return { value: subjects.map(() => answer('judge:openrouter/g@p', false)), spend: { vendor: 'openrouter', endpoint: 'judge-shadow', unit: 'per-call', units: 1, usd, at: 0 as never } };
    },
  };
}

const policyWith = (shadow: Partial<typeof DEFAULT_POLICY.judge.shadow>) => ({ ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, shadow: { ...DEFAULT_POLICY.judge.shadow, on: true, ...shadow } } });

test('each answered live batch is asked of the shadow and both answers are stored; its spend goes in the ledger', async () => {
  const stored: ShadowPair[] = [];
  const calls: number[] = [];
  const ledger = memoryLaneLedger();
  const s = judgeShadow({ port: () => shadowPort(calls), ownAnswer: (id) => id.startsWith('judge:openrouter/'), ledger, pairs: { record: async (p) => void stored.push(...p), ready: async () => true }, meter, policy: policyWith({}), log, now: () => 0 as never });
  s.offer([offered(1), offered(2), offered(3, 'judge:openrouter/g@p')], 0.7);
  await s.idle();
  assert.deepEqual(calls, [2]);
  assert.equal(stored.length, 2);
  assert.equal(stored[0]?.live.coinable, true);
  assert.equal(stored[0]?.shadow?.coinable, false);
  assert.equal(stored[0]?.live.sPerPost, 0.7);
  assert.equal(await ledger.spent('judge_shadow', 0 as never), 0.01);
});

test('it stops at the day\'s cap as the ledger reads it, and an unreadable ledger asks nothing', async () => {
  const calls: number[] = [];
  const full = judgeShadow({ port: () => shadowPort(calls), ownAnswer: () => false, ledger: memoryLaneLedger({ judge_shadow: 1.499 }), pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({ dailyUsd: 1.5 }), log, now: () => 0 as never });
  full.offer([offered(1)], null);
  await full.idle();
  assert.deepEqual(calls, []);
  assert.equal(full.stats.skippedCap, 1);
  const blind = judgeShadow({ port: () => shadowPort(calls), ownAnswer: () => false, ledger: { spent: async () => null, add: async () => undefined }, pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({}), log, now: () => 0 as never });
  blind.offer([offered(1)], null);
  await blind.idle();
  assert.deepEqual(calls, []);
});

test('past maxInFlight a batch is skipped and counted, never queued; off means nothing is asked', async () => {
  const calls: number[] = [];
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  const s = judgeShadow({ port: () => shadowPort(calls, 0.01, hold), ownAnswer: () => false, ledger: memoryLaneLedger(), pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({ maxInFlight: 1 }), log, now: () => 0 as never });
  s.offer([offered(1)], null);
  s.offer([offered(2)], null);
  release();
  await s.idle();
  assert.deepEqual(calls, [1]);
  assert.equal(s.stats.skippedBusy, 1);
  const off = judgeShadow({ port: () => shadowPort(calls), ownAnswer: () => false, ledger: memoryLaneLedger(), pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({ on: false }), log, now: () => 0 as never });
  off.offer([offered(3)], null);
  await off.idle();
  assert.deepEqual(calls, [1]);
});

test('without its table (0089) nothing is asked', async () => {
  const calls: number[] = [];
  const s = judgeShadow({ port: () => shadowPort(calls), ownAnswer: () => false, ledger: memoryLaneLedger(), pairs: { record: async () => undefined, ready: async () => false }, meter, policy: policyWith({}), log, now: () => 0 as never });
  s.offer([offered(1)], null);
  await s.idle();
  assert.deepEqual(calls, []);
});

test('each reason it asks nothing is said once at warn, and the first stored batch once at info', async () => {
  const warns: string[] = [];
  const infos: string[] = [];
  const said: Logger = { info: (m) => void infos.push(m), warn: (m) => void warns.push(m), error: () => undefined, child: () => said };
  const blind = judgeShadow({ port: () => shadowPort([]), ownAnswer: () => false, ledger: { spent: async () => null, add: async () => undefined }, pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({}), log: said, now: () => 0 as never });
  blind.offer([offered(1)], null);
  await blind.idle();
  blind.offer([offered(2)], null);
  await blind.idle();
  assert.equal(warns.filter((w) => w.includes('cannot be read')).length, 1);
  const ok = judgeShadow({ port: () => shadowPort([]), ownAnswer: () => false, ledger: memoryLaneLedger(), pairs: { record: async () => undefined, ready: async () => true }, meter, policy: policyWith({}), log: said, now: () => 0 as never });
  ok.offer([offered(3)], null);
  await ok.idle();
  ok.offer([offered(4)], null);
  await ok.idle();
  assert.equal(infos.filter((m) => m.includes('first batch stored')).length, 1);
});
