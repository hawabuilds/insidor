/**
 * THE JUDGING STEP, against fakes: a judgement record that survives a "restart", a judge
 * that counts what it was asked, and the real in-memory meter. Nothing reaches a network.
 *
 * What these hold: a story worth asking is judged exactly once; a story QUALIFY would drop
 * anyway is never sent; a restart reads the record instead of paying again; a seeded story
 * is never sent; growth re-asks; and a dry run and a reached cap each send nothing.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement } from '@insidor/contracts';
import { authorKey, itemId, sourceId, storyId } from '@insidor/contracts/ids.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { JudgementRepo, RecordedJudgement } from '@insidor/contracts/ports/store.ts';
import type { Story, StoryMember } from '@insidor/contracts/story.ts';
import { inMemoryMeter } from '@insidor/meter';
import { BudgetRefused } from '@insidor/vendor-kit';

import type { Logger } from '../log.ts';
import { judgeStories, needsRejudge, type JudgingDeps, type StoryToJudge } from './judge.ts';

const NOW = 1_800_000_000_000;
const SRC = sourceId('srca');
const SRC_B = sourceId('srcb');

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => silent };

function story(token: string, over: Partial<Story> = {}): Story {
  return {
    storyId: storyId(token),
    state: 'promoted',
    origin: 'observed',
    createdAt: NOW - 3_600_000,
    promotedAt: NOW - 1_800_000,
    earliestPostAt: NOW - 4_000_000,
    lastMemberAt: NOW - 60_000,
    memberCount: 4,
    distinctAuthors: 4,
    distinctSources: 2,
    carriers: [],
    mergedInto: null,
    ...over,
  };
}

/** `authors` distinct accounts. One author means one account on one source — author keys are source-qualified. */
function members(token: string, n: number, authors = n): StoryMember[] {
  const src = (i: number) => (authors === 1 || i % 2 === 0 ? SRC : SRC_B);
  return Array.from({ length: n }, (_, i) => ({
    storyId: storyId(token),
    itemId: itemId(src(i), `${token}-i${i}`),
    authorKey: authorKey(src(i), `a${i % authors}`),
    source: src(i),
    postedAt: NOW - 3_000_000,
    joinedAt: NOW - 2_000_000,
    evidence: { kind: 'carrier', carrier: 'imageHash', key: 'k', distance: 1, weight: 1 },
  }));
}

const entry = (token: string, n = 4, authors = n, over: Partial<Story> = {}): StoryToJudge => ({
  story: story(token, over),
  members: members(token, n, authors),
});

/** A judgement record held in a map, so a second "process" can be handed the same one. */
function memoryRecord(): JudgementRepo & { rows: Map<string, RecordedJudgement> } {
  const rows = new Map<string, RecordedJudgement>();
  return {
    rows,
    record: async (id, memberCount, judgement) => void rows.set(String(id), { memberCount, judgement }),
    latest: async (ids) => new Map(ids.flatMap((id) => { const r = rows.get(String(id)); return r ? [[id, r] as const] : []; })),
  };
}

function fakeJudge(behaviour: 'answer' | 'fail' | 'refuse' = 'answer'): JudgePort & { asked: string[][] } {
  const asked: string[][] = [];
  const judgement = (): Judgement => ({
    judgeId: 'judge:fake@1', promptId: 'p@1', judgedAt: NOW, coinable: true, confidence: 0.9, lookedAt: 'text',
    proposedName: 'gerald', alternateNames: [], subjectSpans: ['gerald'], rationaleRef: null, costUsd: 0.001,
  });
  return {
    id: 'judge:fake@1',
    promptId: 'p@1',
    maxBatch: DEFAULT_POLICY.qualify.batchSize,
    asked,
    estimate: (subjects: readonly JudgeSubject[]) => ({ vendor: 'fake', endpoint: 'judge', unit: 'per-call', estUnits: 1, usd: 0.002 * subjects.length }),
    judge: async (subjects) => {
      asked.push(subjects.map((s) => String(s.storyId)));
      if (behaviour === 'refuse') throw new BudgetRefused('fake', 'judge', 'soft stop reached');
      if (behaviour === 'fail') throw new Error('vendor down');
      return {
        value: subjects.map(() => ({ kind: 'judged' as const, judgement: judgement() })),
        spend: { vendor: 'fake', endpoint: 'judge', unit: 'per-call', units: 1, usd: 0.001 * subjects.length, at: NOW },
      };
    },
  };
}

const items = async (stories: readonly StoryToJudge[]): Promise<ReadonlyMap<string, Item>> =>
  new Map(stories.flatMap((s) => s.members.map((m) => [String(m.itemId), { itemId: m.itemId, text: 'gerald is back', media: [] } as unknown as Item] as const)));

function deps(over: Partial<JudgingDeps> = {}): JudgingDeps {
  return {
    judge: fakeJudge(),
    judgements: memoryRecord(),
    meter: inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => NOW }),
    mode: 'live',
    policy: DEFAULT_POLICY,
    log: silent,
    ...over,
  };
}

test('a promoted story that passes the cheap gates is judged exactly once', async () => {
  const judge = fakeJudge();
  const d = deps({ judge });
  const first = await judgeStories([entry('a')], items, d, NOW);
  const second = await judgeStories([entry('a')], items, d, NOW + 120_000);
  assert.deepEqual(judge.asked, [[String(storyId('a'))]]);
  assert.equal(first.get(storyId('a'))?.judgement?.proposedName, 'gerald');
  assert.equal(second.get(storyId('a'))?.judgement?.proposedName, 'gerald', 'read back from the record');
  assert.equal(second.get(storyId('a'))?.judgeCostUsd, 0, 'and it cost nothing the second time');
});

test('a story that fails the cheap gates is never sent', async () => {
  const judge = fakeJudge();
  const out = await judgeStories(
    [entry('one-author', 4, 1), entry('thin', 2), entry('candidate', 4, 4, { state: 'candidate', promotedAt: null })],
    items,
    deps({ judge }),
    NOW,
  );
  assert.deepEqual(judge.asked, []);
  for (const v of out.values()) assert.equal(v.unjudged, 'not_asked');
});

test('a restart does not re-judge: a new process reads the record and asks nothing', async () => {
  const record = memoryRecord();
  await judgeStories([entry('a'), entry('b')], items, deps({ judgements: record }), NOW);
  const restarted = fakeJudge();
  const out = await judgeStories([entry('a'), entry('b')], items, deps({ judgements: record, judge: restarted }), NOW + 60_000);
  assert.deepEqual(restarted.asked, []);
  assert.equal(out.get(storyId('b'))?.judgement?.coinable, true);
});

test('a seeded story is never sent, however good it looks', async () => {
  const judge = fakeJudge();
  const out = await judgeStories([entry('seed', 4, 4, { origin: 'fixture' })], items, deps({ judge }), NOW);
  assert.deepEqual(judge.asked, []);
  assert.equal(out.get(storyId('seed'))?.unjudged, 'not_asked');
});

test('a story is asked again only once it has grown by the policy share', async () => {
  const growth = DEFAULT_POLICY.judge.rejudgeGrowth;
  assert.equal(needsRejudge(4, 5, growth), false);
  assert.equal(needsRejudge(4, Math.ceil(4 * (1 + growth)), growth), true);
  const record = memoryRecord();
  await judgeStories([entry('g', 4)], items, deps({ judgements: record }), NOW);
  const judge = fakeJudge();
  await judgeStories([entry('g', 5)], items, deps({ judgements: record, judge }), NOW);
  assert.deepEqual(judge.asked, []);
  await judgeStories([entry('g', 6)], items, deps({ judgements: record, judge }), NOW);
  assert.deepEqual(judge.asked, [[String(storyId('g'))]]);
});

test('a dry run prices and sends nothing, and writes nothing to the record', async () => {
  const judge = fakeJudge();
  const record = memoryRecord();
  const out = await judgeStories([entry('a')], items, deps({ judge, judgements: record, mode: 'dry' }), NOW);
  assert.deepEqual(judge.asked, []);
  assert.equal(out.get(storyId('a'))?.unjudged, 'dry_run');
  assert.equal(record.rows.size, 0);
});

test('when the cap is reached the call is not made, and the story is recorded as paused, not dropped', async () => {
  const judge = fakeJudge();
  const out = await judgeStories([entry('a')], items, deps({ judge, meter: inMemoryMeter({ dailyCapUsd: 0.000_001, softStop: 1, now: () => NOW }) }), NOW);
  assert.deepEqual(judge.asked, []);
  assert.equal(out.get(storyId('a'))?.unjudged, 'budget');
});

test('a refusal at the vendor edge is a pause, and a vendor failure is unavailable, never a no', async () => {
  const refused = await judgeStories([entry('a')], items, deps({ judge: fakeJudge('refuse') }), NOW);
  assert.equal(refused.get(storyId('a'))?.unjudged, 'budget');
  const failed = await judgeStories([entry('a')], items, deps({ judge: fakeJudge('fail') }), NOW);
  assert.equal(failed.get(storyId('a'))?.unjudged, 'unavailable');
  assert.equal(failed.get(storyId('a'))?.judgement, null);
});

test('with the judge dormant nothing is asked and every story is not_asked', async () => {
  const out = await judgeStories([entry('a')], items, deps({ judge: null }), NOW);
  assert.equal(out.get(storyId('a'))?.unjudged, 'not_asked');
});
