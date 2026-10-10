/**
 * The judgement record, against a fake connection. What matters: the newest answer per
 * story comes back whole, and a row holding a value the code does not know is refused.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Judgement } from '@insidor/contracts';
import { storyId } from '@insidor/contracts/ids.ts';

import type { Db } from '../client.ts';
import { PgJudgementRepo } from './judgements.ts';

const AT = 1_800_000_000_000;

const judgement: Judgement = {
  judgeId: 'judge:test/model@abcd1234',
  promptId: 'coinability@abcd1234',
  judgedAt: AT,
  coinable: true,
  confidence: 0.8,
  lookedAt: 'videoFrame',
  proposedName: 'gerald',
  alternateNames: ['porch frog'],
  subjectSpans: ['gerald is back'],
  rationaleRef: null,
  costUsd: 0.0002,
};

function fakeDb(rows: readonly Record<string, unknown>[]): { db: Db; sent: { sql: string; params: readonly unknown[] }[] } {
  const sent: { sql: string; params: readonly unknown[] }[] = [];
  const db = {
    query: async (sql: string, params: readonly unknown[] = []) => {
      sent.push({ sql, params });
      return sql.trimStart().startsWith('select') ? rows : [];
    },
  } as unknown as Db;
  return { db, sent };
}

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  story_id: String(storyId('s1')),
  judged_at: new Date(AT),
  member_count: 4,
  judge_id: judgement.judgeId,
  prompt_id: judgement.promptId,
  looked_at: 'videoFrame',
  coinable: true,
  confidence: 0.8,
  proposed_name: 'gerald',
  alternate_names: ['porch frog'],
  subject_spans: ['gerald is back'],
  cost_usd: '0.00020000',
  ...over,
});

test('a judgement is written with the story size it was given at, and no prose', async () => {
  const { db, sent } = fakeDb([]);
  await new PgJudgementRepo(db).record(storyId('s1'), 4, judgement);
  assert.match(sent[0]?.sql ?? '', /insert into internal\.judgement/);
  assert.equal(sent[0]?.params[2], 4);
  assert.equal(JSON.stringify(sent[0]?.params).includes('rationale'), false);
});

test('the newest judgement per story reads back whole', async () => {
  const { db } = fakeDb([row()]);
  const got = await new PgJudgementRepo(db).latest([storyId('s1'), storyId('s2')]);
  assert.equal(got.size, 1);
  assert.deepEqual(got.get(storyId('s1')), { memberCount: 4, judgement });
});

test('asking about no stories asks the database nothing', async () => {
  const { db, sent } = fakeDb([row()]);
  assert.equal((await new PgJudgementRepo(db).latest([])).size, 0);
  assert.equal(sent.length, 0);
});

test('a row whose evidence kind the code does not know is refused, not guessed', async () => {
  const { db } = fakeDb([row({ looked_at: 'audio' })]);
  await assert.rejects(new PgJudgementRepo(db).latest([storyId('s1')]), /not a JudgeEvidence/);
});
