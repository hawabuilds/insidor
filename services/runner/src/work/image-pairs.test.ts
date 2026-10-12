/** One question per pair, inside a daily cap, never in a dry run, and only a real answer stored. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import type { JudgePort, SameSubjectAnswer } from '@insidor/contracts/ports/judge.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { checkPair } from './image-pairs.ts';

const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function setup(reply: SameSubjectAnswer | null, stored: SameSubjectAnswer | null = null, askedToday = 0) {
  let asked = 0;
  const recorded: SameSubjectAnswer[] = [];
  const judge = {
    id: 'judge:test', promptId: 'p', maxBatch: 10, sameSubjectPromptId: 'same-subject@1',
    estimate: () => ({ vendor: 'v', endpoint: 'e', unit: 'per-call', estUnits: 1, usd: 0.001 }),
    judge: async () => ({ value: [], spend: { vendor: 'v', endpoint: 'e', unit: 'per-call', units: 1, usd: 0, at: 0 } }),
    sameSubject: async () => ((asked += 1), { value: reply, spend: { vendor: 'v', endpoint: 'same-subject', unit: 'per-call', units: 1, usd: 0.004, at: 0 } }),
  } as unknown as JudgePort;
  const pairs = {
    answer: async () => stored,
    record: async (_a: string, _b: string, _p: string, answer: SameSubjectAnswer) => void recorded.push(answer),
    countSince: async () => askedToday,
  };
  return { judge, pairs, recorded, asked: () => asked };
}

const deps = (s: ReturnType<typeof setup>, mode: 'dry' | 'live' = 'live') => ({
  judge: s.judge, pairs: s.pairs, mode, policy: DEFAULT_POLICY, log: quiet, now: () => 1_800_000_000_000 as Millis,
});

test('★ a stored answer is used, and the judge is not asked again', async () => {
  const s = setup('no', 'yes');
  assert.equal(await checkPair(deps(s), 'a', 'b'), 'yes');
  assert.equal(s.asked(), 0);
});

test('a new pair is asked once and its answer stored', async () => {
  const s = setup('yes');
  assert.equal(await checkPair(deps(s), 'a', 'b'), 'yes');
  assert.equal(s.asked(), 1);
  assert.deepEqual(s.recorded, ['yes']);
});

test('★ a dry run asks nothing', async () => {
  const s = setup('yes');
  assert.equal(await checkPair(deps(s, 'dry'), 'a', 'b'), null);
  assert.equal(s.asked(), 0);
});

test('★ past the day\'s cap nothing is asked, and the pair carries no evidence', async () => {
  const s = setup('yes', null, DEFAULT_POLICY.group.image.pairChecksPerDay);
  assert.equal(await checkPair(deps(s), 'a', 'b'), null);
  assert.equal(s.asked(), 0);
});

test('no answer is stored when the judge gave none', async () => {
  const s = setup(null);
  assert.equal(await checkPair(deps(s), 'a', 'b'), null);
  assert.deepEqual(s.recorded, []);
});
