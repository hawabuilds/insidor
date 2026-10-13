/** The post judge reads the latest APPLIED learned examples, swaps when a newer one lands, and keeps its block through a failed read. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { JudgePort } from '@insidor/contracts/ports/judge.ts';

import type { Logger } from './log.ts';
import { learnedJudge, type AppliedBlock } from './learned-examples.ts';

const log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => log };

function judgeWith(examples: string | null): JudgePort {
  const id = `judge@${examples ?? 'rules-only'}`;
  return {
    id,
    promptId: `prompt@${examples ?? 'rules-only'}`,
    maxBatch: 1,
    judge: async () => ({ value: [], spend: { usd: 0 } }) as unknown as Awaited<ReturnType<JudgePort['judge']>>,
    estimate: () => ({ usd: 0 }) as unknown as ReturnType<JudgePort['estimate']>,
  };
}

test('no applied block: the judge has no examples, as before there were any', async () => {
  const j = learnedJudge({ latest: async () => null, build: judgeWith, log });
  await j.refresh();
  assert.equal(j.port.id, 'judge@rules-only');
  assert.equal(j.version(), null);
});

test('★ a newer applied block swaps the judge behind the same port; the same one does not rebuild it', async () => {
  let block: AppliedBlock | null = { versionId: 1, text: 'A', sha: 'a' };
  let builds = 0;
  const j = learnedJudge({ latest: async () => block, build: (e) => (builds++, judgeWith(e)), log });
  const port = j.port;
  await j.refresh();
  assert.equal(port.id, 'judge@A');
  await j.refresh();
  assert.equal(builds, 2, 'one at start, one for version 1, none for reading it again');
  block = { versionId: 2, text: 'B', sha: 'b' };
  await j.refresh();
  assert.equal(port.id, 'judge@B');
  assert.equal(port.promptId, 'prompt@B');
  assert.equal(j.version(), 2);
});

test('a failed read keeps the block in use', async () => {
  let fail = false;
  const j = learnedJudge({ latest: async () => (fail ? Promise.reject(new Error('down')) : { versionId: 3, text: 'C', sha: 'c' }), build: judgeWith, log });
  await j.refresh();
  fail = true;
  await j.refresh();
  assert.equal(j.port.id, 'judge@C');
  assert.equal(j.version(), 3);
});
