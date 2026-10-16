/**
 * The instant judge, against stand-ins: only posts the coin rule picks are judged, at most
 * `perMinute` a minute; its queue hands the scoring pass exactly those posts, past the view bar;
 * switched off it reads nothing.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Item, ItemId, Millis } from '@insidor/contracts';
import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import type { CoinVouchRow } from '@insidor/store';

import type { Logger } from '../log.ts';
import { instantItems, instantJudge, picked } from './coin-instant.ts';
import { scorePosts, type ScoringResult } from './score-posts.ts';

const NOW = 1_800_000_000_000 as Millis;
const MIN = 60_000;
const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {}, child: () => quiet } as unknown as Logger;
const P: Policy = {
  ...DEFAULT_POLICY,
  rising: { ...DEFAULT_POLICY.rising, coinLinked: { on: true, maxPostAgeAtLaunchMs: 6 * 60 * MIN, minApprovals: 5_000 } },
  finders: { ...DEFAULT_POLICY.finders, coinLinks: { ...DEFAULT_POLICY.finders.coinLinks, on: true, instant: { on: true, perMinute: 2, lookbackMs: 10 * MIN } } },
};

const row = (id: string, approvals: number | null, launchAfterMin = 5): CoinVouchRow => ({
  itemId: id,
  postedAtMs: (NOW - 10 * MIN) as Millis,
  firstCoinAtMs: (NOW - 10 * MIN + launchAfterMin * MIN) as Millis,
  approvals,
});
const item = (id: string): Item => ({ itemId: id as ItemId }) as unknown as Item;
const scored = (n: number): ScoringResult => ({ queued: n, scored: n, copied: 0, waiting: 0, wouldSpendUsd: 0, spentUsd: 0.0003 });

function judgeOver(rows: readonly CoinVouchRow[], policy = P, clock = { at: NOW }) {
  const queues: string[][] = [];
  let reads = 0;
  const run = instantJudge({
    finders: { coinNamedUnjudged: async () => ((reads += 1), rows) },
    items: { byIds: async (ids) => new Map(ids.map((id) => [id, item(String(id))] as const)) },
    score: async (queue) => (queues.push(queue.map((i) => String(i.itemId))), scored(queue.length)),
    policy,
    log: quiet,
    now: () => clock.at as Millis,
  });
  return { run, queues, reads: () => reads };
}

test('only posts the coin rule picks are judged: young, approved, named by a coin', async () => {
  const j = judgeOver([row('x:low', 4_000), row('x:old', 9_000, 400), row('x:yes', 9_000), row('x:unread', null)]);
  const r = await j.run();
  assert.deepEqual(j.queues, [['x:yes']]);
  assert.equal(r.scored, 1);
});

test('★ at most perMinute posts in any minute; the rest wait for the next pass', async () => {
  const clock = { at: NOW };
  const j = judgeOver([row('x:a', 9_000), row('x:b', 9_000), row('x:c', 9_000)], P, clock);
  await j.run();
  await j.run();
  assert.deepEqual(j.queues, [['x:a', 'x:b']], 'the minute is full: the second pass judges nothing');
  clock.at = NOW + MIN;
  await j.run();
  assert.equal(j.queues.length, 2, 'a minute later there is room again');
});

test('switched off, it reads nothing', async () => {
  const off = { ...P, finders: { ...P.finders, coinLinks: { ...P.finders.coinLinks, instant: { ...P.finders.coinLinks.instant, on: false } } } };
  const j = judgeOver([row('x:yes', 9_000)], off);
  assert.deepEqual(await j.run(), { queued: 0, scored: 0, usd: 0 });
  assert.equal(j.reads(), 0);
});

test('the scoring pass is handed only the queue, every post past the view bar, nothing to re-score', async () => {
  const queue = [item('x:1'), item('x:2')];
  const src = instantItems(queue, { reachReadings: async () => new Map() });
  assert.deepEqual(await src.catchAllUnscored(NOW, 10, 0, null, false), queue);
  assert.deepEqual(await src.catchAllUnscored(NOW, 10, 0, 'watch', false), [], 'no lane adds a post');
  assert.deepEqual(await src.catchAllStale(NOW, 10, 'p', 'k', 0), []);
  assert.deepEqual([...(await src.backfilled([]))].sort(), ['x:1', 'x:2']);
});

test('picked keeps the newest links first, up to the room left', () => {
  assert.deepEqual(picked([row('x:1', 9_000), row('x:2', 9_000)], 1, P), ['x:1']);
  assert.deepEqual(picked([row('x:1', 9_000)], 0, P), []);
});

test('★ end to end with the scoring pass: a coin-named post under the view bar is judged, and its kind is asked', async () => {
  const asked: string[] = [];
  const port = (name: string) => ({
    id: `judge:${name}`,
    promptId: `${name}@1`,
    maxBatch: 5,
    estimate: () => ({ vendor: 'open', endpoint: 'judge', usd: 0.0001 }),
    judge: async (subjects: readonly { storyId: string }[]) => {
      asked.push(name);
      return {
        value: subjects.map(() => ({ kind: 'judged' as const, judgement: { judgeId: `judge:${name}`, promptId: `${name}@1`, judgedAt: NOW, coinable: true, confidence: 0.95, lookedAt: 'text' as const, proposedName: 'HIPPO', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0.0001 } })),
        spend: { vendor: 'open', endpoint: 'judge', unit: 'per-call', units: 1, usd: 0.0001, at: NOW },
      };
    },
  });
  const recorded: string[] = [];
  const post = { itemId: 'x:9', source: 'x', sourceItemId: '9', text: 'a hippo', media: [], postedAt: NOW - MIN, rebroadcastOf: null, reproductionOf: null } as unknown as Item;
  const result = await scorePosts({
    judge: port('post') as never,
    kindJudge: port('post-kind') as never,
    items: instantItems([post], { reachReadings: async () => new Map([['x:9', [{ atMs: NOW, reach: 900 }]]]) }),
    scores: { record: async (id) => void recorded.push(String(id)), recordCopy: async () => {}, reusable: async () => ({ byItem: new Map(), byImage: new Map() }) },
    meter: { record: () => {}, spentUsd: () => 0, mayspend: () => true, line: () => ({ capUsd: 1, spentUsd: 0 }) } as never,
    mode: 'live',
    policy: P,
    log: quiet,
    now: () => NOW,
  });
  assert.equal(result.scored, 1, '900 views is far under the bar, and it is judged anyway');
  assert.deepEqual(asked, ['post', 'post-kind'], 'the yes is followed by the kind question');
});
