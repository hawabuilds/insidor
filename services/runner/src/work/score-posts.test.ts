/**
 * The per-post score, through the real judge adapter with a recorded reply standing in for
 * the network: posts are judged alone in one batch, each answer is filed under its own post,
 * and every way of not getting an answer leaves the post waiting.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, type ItemId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';
import { anthropicJudge, httpClient } from '@insidor/judge-anthropic';

import type { Logger } from '../log.ts';
import { scorePosts } from './score-posts.ts';

const NOW = 1_800_000_000_000 as Millis;
const P = DEFAULT_POLICY;
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => quiet };

function post(n: number): Item {
  return {
    itemId: itemId(sourceId('x'), `${n}`),
    source: sourceId('x'),
    sourceItemId: `${n}`,
    origin: 'observed',
    authorKey: authorKey(sourceId('x'), `a${n}`),
    postedAt: NOW - 60_000,
    firstSeenAt: NOW,
    lang: 'en',
    text: `the baby hippo yawned again, take ${n}`,
    media: [],
    counters: {},
    fingerprints: [],
    rebroadcastOf: null,
    reproductionOf: null,
    formatIds: [],
    rawRef: `x/${n}`,
  };
}

/**
 * The Messages API reply as the judge sends it, recorded shape, answering every subject in
 * the request it is handed with the given confidence. `calls` counts requests.
 */
function recordedJudge(confidence: number | 'garbled') {
  const calls: unknown[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; text?: string }[] }[] };
    calls.push(body);
    const asked = body.messages[0]?.content.find((c) => c.text?.startsWith('Stories to judge'))?.text ?? '';
    const ids = [...asked.matchAll(/"storyId":"([^"]+)"/g)].map((m) => m[1]);
    const answers = ids.map((id) => ({ storyId: id, coinable: true, proposedName: 'baby hippo', confidence, alternateNames: [], subjectSpans: ['baby hippo'] }));
    const text = confidence === 'garbled' ? '{"answers": "yes"}' : JSON.stringify({ answers });
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1_200, output_tokens: 90 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const meter = openMeter();
  const client = httpClient({
    apiKey: 'sk-test-not-a-real-key',
    baseUrl: 'https://judge.invalid',
    model: 'claude-haiku-4-5',
    maxOutputTokens: P.judge.maxOutputTokens,
    effort: null,
    timeoutMs: P.judge.timeoutMs,
    maxAttempts: 1,
    backoffMs: P.judge.backoffMs,
    maxWaitMs: P.judge.maxWaitMs,
    maxFrameBytes: P.judge.maxFrameBytes,
    fetch,
    sleep: async () => {},
  });
  const judge = anthropicJudge({ client, meter, now: () => NOW, model: 'claude-haiku-4-5', policy: P.judge, maxBatch: P.qualify.batchSize });
  return { judge, calls, meter };
}

function openMeter(allow = true): Meter {
  return {
    record: () => undefined,
    spentUsd: () => 0,
    mayspend: () => allow,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter;
}

function deps(queue: readonly Item[], judge: ReturnType<typeof recordedJudge> | null, mode: 'dry' | 'live' = 'live', meter?: Meter, reach: (id: string) => number | null = () => 1_000_000) {
  const recorded = new Map<ItemId, Judgement>();
  return {
    recorded,
    deps: {
      judge: judge?.judge ?? null,
      items: {
        catchAllUnscored: async () => queue,
        reachReadings: async (ids: readonly ItemId[]) => new Map(ids.map((id) => [String(id), [{ atMs: NOW, reach: reach(String(id)) }]])),
        backfilled: async () => new Set<string>(),
      },
      scores: { record: async (id: ItemId, j: Judgement) => void recorded.set(id, j) },
      meter: meter ?? judge?.meter ?? openMeter(),
      mode,
      policy: P,
      log: quiet,
      now: () => NOW,
    },
  };
}

test('★ each post is judged alone, in one batch, and each answer is filed under its own post', async () => {
  const judge = recordedJudge(0.82);
  const { deps: d, recorded } = deps([post(1), post(2), post(3)], judge);
  const result = await scorePosts(d);
  assert.equal(judge.calls.length, 1, 'three posts, one call');
  assert.equal(result.scored, 3);
  assert.deepEqual([...recorded.keys()].sort(), [post(1), post(2), post(3)].map((p) => p.itemId).sort());
  assert.equal(recorded.get(post(2).itemId)?.confidence, 0.82);
});

test('★ a dry run prices the posts and sends nothing; they wait', async () => {
  const judge = recordedJudge(0.82);
  const { deps: d, recorded } = deps([post(1), post(2)], judge, 'dry');
  const result = await scorePosts(d);
  assert.equal(judge.calls.length, 0);
  assert.equal(recorded.size, 0);
  assert.equal(result.waiting, 2);
  assert.ok(result.wouldSpendUsd > 0, 'and the price is reported');
});

test('a reply that does not parse records nothing: the posts wait, they do not fail', async () => {
  const judge = recordedJudge('garbled');
  const { deps: d, recorded } = deps([post(1)], judge);
  const result = await scorePosts(d);
  assert.equal(recorded.size, 0);
  assert.equal(result.waiting, 1);
});

test('a budget that refuses means no call and no score', async () => {
  const judge = recordedJudge(0.82);
  const { deps: d, recorded } = deps([post(1)], judge, 'live', openMeter(false));
  await scorePosts(d);
  assert.equal(judge.calls.length, 0);
  assert.equal(recorded.size, 0);
});

test('with no judge configured every post waits', async () => {
  const { deps: d } = deps([post(1), post(2)], null);
  assert.deepEqual(await scorePosts(d), { queued: 2, scored: 0, waiting: 2, wouldSpendUsd: 0, spentUsd: 0 });
});

test('★ free check first: a post below For You\'s reach bar is not sent to the judge; it waits', async () => {
  const judge = recordedJudge(0.82);
  const small = String(post(2).itemId);
  const { deps: d, recorded } = deps([post(1), post(2)], judge, 'live', undefined, (id) => (id === small ? 900 : 1_000_000));
  await scorePosts(d);
  assert.ok(recorded.has(post(1).itemId));
  assert.ok(!recorded.has(post(2).itemId), 'under the bar: waits, unscored');
});
