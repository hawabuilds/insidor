/**
 * Early judging: which never-judged posts are asked before the reach bar, fastest first and capped
 * per pass; that a post over the bar is left to score-posts; that the day's cap and an unreadable
 * ledger ask nothing; and that what a pass spent, judge and embeddings, is charged to its lane.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, type ItemId } from '@insidor/contracts/ids.ts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import type { Logger } from '../log.ts';
import { EARLY_LANE, earlyJudge, earlySpeed } from './early-judge.ts';
import { memoryLaneLedger } from './lane-ledger.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const P = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, early: { ...DEFAULT_POLICY.judge.early, on: true } } };
const E = P.judge.early;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function post(n: number, over: { ageMin?: number; likes?: number; source?: string } = {}): Item {
  const source = sourceId(over.source ?? 'x');
  return {
    itemId: itemId(source, `${n}`),
    source,
    sourceItemId: `${n}`,
    origin: 'observed',
    authorKey: authorKey(source, `a${n}`),
    postedAt: NOW - (over.ageMin ?? 10) * MIN,
    firstSeenAt: NOW - MIN,
    lang: 'en',
    text: `the baby hippo yawned again, take ${n}`,
    media: [],
    counters: { approval: { value: over.likes ?? 500, observedAt: NOW, fidelity: { kind: 'exact' } } } as never,
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `x/${n}`,
  };
}

const answer: Judgement = {
  judgeId: 'judge:test', promptId: 'post@1', judgedAt: NOW, coinable: false, confidence: 0.9, lookedAt: 'text',
  proposedName: null, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.0002,
};

function fakeJudge() {
  const sent: JudgeSubject[][] = [];
  const judge: JudgePort = {
    id: 'judge:test',
    promptId: 'post@1',
    maxBatch: 5,
    estimate: (s) => ({ vendor: 'test', usd: s.length * 0.0002 }) as never,
    judge: async (subjects) => {
      sent.push([...subjects]);
      return { value: subjects.map(() => ({ kind: 'judged' as const, judgement: answer })), spend: { usd: subjects.length * 0.0002 } as never };
    },
  };
  return { judge, sent };
}

const meter = { record: () => undefined, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }) } as unknown as Meter;

/** Each post's one reading: `reach` views, read now. */
function deps(posts: readonly Item[], reach: (id: string) => number, over: { ledger?: ReturnType<typeof memoryLaneLedger> | null; embedUsd?: number; policy?: typeof P } = {}) {
  const j = fakeJudge();
  const recorded = new Map<ItemId, Judgement>();
  const lanesAsked: (string | null)[] = [];
  const ledger = over.ledger === undefined ? memoryLaneLedger() : over.ledger;
  let embed = 0;
  return {
    j,
    recorded,
    lanesAsked,
    ledger,
    run: earlyJudge({
      judge: j.judge,
      items: {
        catchAllUnscored: async (_at: Millis, _limit: number, _floor: number | null = null, lane: string | null = null) => (lanesAsked.push(lane), posts),
        reachReadings: async (ids: readonly ItemId[]) => new Map(ids.map((id) => [String(id), [{ atMs: NOW, reach: reach(String(id)) }]])),
      },
      scores: {
        record: async (id: ItemId, jj: Judgement) => void recorded.set(id, jj),
        recordCopy: async () => undefined,
        reusable: async () => ({ byItem: new Map(), byImage: new Map() }),
      },
      precedents: { refresh: async () => assert.fail('the early pass never refreshes the labels'), forPosts: async () => ((embed += over.embedUsd ?? 0), new Map()) } as never,
      ledger: ledger ?? { spent: async () => null, add: async () => undefined },
      embedSpentUsd: () => embed,
      meter,
      mode: 'live',
      policy: over.policy ?? P,
      log: quiet,
      now: () => NOW,
    }),
  };
}

test('off: nothing is read or asked', async () => {
  const d = deps([post(1)], () => 10_000, { policy: DEFAULT_POLICY.judge.early.on ? { ...P, judge: { ...P.judge, early: { ...E, on: false } } } : DEFAULT_POLICY });
  const r = await d.run();
  assert.equal(r.held, 'off');
  assert.deepEqual(d.lanesAsked, []);
  assert.equal(d.j.sent.length, 0);
});

test('each of the policy\'s lanes is read on its own', async () => {
  const d = deps([], () => 0);
  await d.run();
  assert.deepEqual(d.lanesAsked, [...E.lanes]);
});

test('a fast young post under the bar is judged and filed; a slow one, an old one, a little-liked one and one over the bar are not', async () => {
  const fast = post(1, { ageMin: 10 }); // 6,000 views in 10 minutes: 600 a minute
  const slow = post(2, { ageMin: 60 }); // 6,000 in an hour: 100 a minute
  const old = post(3, { ageMin: E.maxAgeMs / MIN + 1 });
  const unliked = post(4, { ageMin: 10, likes: E.minApprovals - 1 });
  const over = post(5, { ageMin: 10 });
  const reach = (id: string) => (id === String(over.itemId) ? P.rising.fypMinReach : 6_000);
  const d = deps([fast, slow, old, unliked, over], reach);
  const r = await d.run();
  assert.deepEqual([...d.recorded.keys()].map(String), [String(fast.itemId)]);
  assert.equal(r.eligible, 1);
  assert.equal(r.scored, 1);
});

test('fastest first, at most maxPerPass a pass', async () => {
  const posts = Array.from({ length: E.maxPerPass + 5 }, (_, n) => post(n + 1, { ageMin: 5 + n }));
  const d = deps(posts, () => 9_000); // 1,800 to 470 a minute: under the fast path, over the early bar
  const r = await d.run();
  assert.equal(r.eligible, posts.length);
  assert.equal(d.recorded.size, E.maxPerPass);
  /* The youngest at the same views are the fastest: the first maxPerPass posts. */
  assert.deepEqual([...d.recorded.keys()].map(String).sort(), posts.slice(0, E.maxPerPass).map((p) => String(p.itemId)).sort());
});

test('the short-video source is held to its scaled bars', async () => {
  const video = post(1, { ageMin: 10, source: 'tiktok' });
  const d = deps([video], () => 6_000); // 600 a minute: under 400 × the scale
  await d.run();
  assert.equal(d.recorded.size, 0);
});

test('★ the day\'s cap asks nothing, and an unreadable ledger asks nothing', async () => {
  const capped = deps([post(1)], () => 6_000, { ledger: memoryLaneLedger({ judge_early: E.dailyUsd }) });
  assert.equal((await capped.run()).held, 'cap');
  assert.equal(capped.j.sent.length, 0);
  const unreadable = deps([post(1)], () => 6_000, { ledger: null });
  assert.equal((await unreadable.run()).held, 'ledger');
  assert.equal(unreadable.j.sent.length, 0);
});

test('what a pass spent, the judge and the embeddings, is charged to its lane', async () => {
  const d = deps([post(1), post(2)], () => 6_000, { embedUsd: 0.001 });
  await d.run();
  const charged = await d.ledger!.spent(EARLY_LANE, NOW);
  assert.ok(charged !== null && Math.abs(charged - (2 * 0.0002 + 0.001)) < 1e-9, `charged ${charged}`);
});

test('earlySpeed: the fastest qualifying reading inside the window, null when none', () => {
  const posted = NOW - 30 * MIN;
  assert.equal(earlySpeed([{ atMs: NOW - 20 * MIN, reach: 5_000 }, { atMs: NOW, reach: 9_000 }], posted, 2_000, E.maxAgeMs), 500);
  assert.equal(earlySpeed([{ atMs: NOW, reach: 1_000 }], posted, 2_000, E.maxAgeMs), null);
  assert.equal(earlySpeed([{ atMs: NOW, reach: null }], posted, 2_000, E.maxAgeMs), null);
  assert.equal(earlySpeed([{ atMs: posted, reach: 9_000 }], posted, 2_000, E.maxAgeMs), null);
});
