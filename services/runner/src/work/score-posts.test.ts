/**
 * The per-post score, through the real judge adapter with a recorded reply standing in for
 * the network: posts are judged alone in one batch, each answer is filed under its own post,
 * every way of not getting an answer leaves the post waiting, and a post that shows the judge
 * nothing new (a repost, a bare quote, the same picture) is given the earlier answer for free.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Item, Judgement, Millis } from '@insidor/contracts';
import { authorKey, itemId, sourceId, type ItemId } from '@insidor/contracts/ids.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import { DEFAULT_POLICY as LIVE_POLICY } from '@insidor/contracts/policy.ts';
import { anthropicJudge, httpClient } from '@insidor/judge-anthropic';

import type { ReusableAnswer } from '@insidor/store';

import type { Logger } from '../log.ts';
import { reusableFor, scorePosts } from './score-posts.ts';

/* The fresh bands and the stale cut as they were before they were switched on, so these tests keep
   pinning the switch-off behaviour whatever the live policy says; a test that wants them on says so. */
const DEFAULT_POLICY = { ...LIVE_POLICY, feed: { ...LIVE_POLICY.feed, fresh: { ...LIVE_POLICY.feed.fresh, enabled: false, cutStale: false } } };

const NOW = 1_800_000_000_000 as Millis;
/* Every kind label held, so the kind-question cases read the same whichever set the owner picks for live. */
const P = { ...DEFAULT_POLICY, judge: { ...DEFAULT_POLICY.judge, heldKinds: ['AD', 'SPORT', 'FANDOM', 'SHOWBIZ', 'POLITICS', 'TRAGEDY', 'CORP_NEWS', 'MEDIA_NEWS'] } };
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
function recordedJudge(confidence: number | 'garbled' | 'no credit', precedents = false) {
  const calls: unknown[] = [];
  const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: { type: string; text?: string }[] }[] };
    calls.push(body);
    /* The vendor's recorded answer for an empty account (2026-10-15). */
    if (confidence === 'no credit') {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the API. Please go to Plans & Billing to upgrade or purchase credits.' } }), { status: 400 });
    }
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
  const judge = anthropicJudge({ client, meter, now: () => NOW, model: 'claude-haiku-4-5', policy: P.judge, maxBatch: P.qualify.batchSize, precedents, ...(precedents ? { question: 'post' as const } : {}) });
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

interface Found {
  readonly byItem: ReadonlyMap<string, ReusableAnswer>;
  readonly byImage: ReadonlyMap<string, ReusableAnswer>;
}
const nothingFound: Found = { byItem: new Map(), byImage: new Map() };

function deps(
  queue: readonly Item[],
  judge: ReturnType<typeof recordedJudge> | null,
  mode: 'dry' | 'live' = 'live',
  meter?: Meter,
  reach: (id: string) => number | null = () => 1_000_000,
  found: Found = nothingFound,
  stale: readonly Item[] = [],
) {
  const recorded = new Map<ItemId, Judgement>();
  const copies = new Map<ItemId, { judgement: Judgement; from: ItemId }>();
  const asked: { judgeId: string; promptId: string }[] = [];
  return {
    recorded,
    copies,
    asked,
    deps: {
      judge: judge?.judge ?? null,
      items: {
        catchAllUnscored: async () => queue,
        catchAllStale: async (_at: Millis, limit: number) => stale.slice(0, limit),
        reachReadings: async (ids: readonly ItemId[]) => new Map(ids.map((id) => [String(id), [{ atMs: NOW, reach: reach(String(id)) }]])),
        backfilled: async () => new Set<string>(),
      },
      scores: {
        record: async (id: ItemId, j: Judgement) => void recorded.set(id, j),
        recordCopy: async (id: ItemId, j: Judgement, from: ItemId) => void copies.set(id, { judgement: j, from }),
        reusable: async (q: { judgeId: string; promptId: string }) => (asked.push({ judgeId: q.judgeId, promptId: q.promptId }), found),
      },
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

test('★ a judge that answers none of the posts sent is an error line, not a quiet "scored=0" (2026-10-15)', async () => {
  const judge = recordedJudge('no credit');
  const lines: { level: string; msg: string; fields: Record<string, unknown> | undefined }[] = [];
  const log: Logger = {
    info: (msg, fields) => void lines.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => void lines.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => void lines.push({ level: 'error', msg, fields }),
    child: () => log,
  };
  const { deps: d, recorded } = deps([post(1), post(2), post(3)], judge);
  const result = await scorePosts({ ...d, log });
  assert.equal(recorded.size, 0);
  assert.equal(result.waiting, 3);
  const loud = lines.find((l) => l.level === 'error' && l.msg.startsWith('posts scored: the judge answered none'));
  assert.ok(loud, 'an error-level line');
  assert.equal(loud.fields?.['sent'], 3);
  assert.equal(loud.fields?.['unanswered'], 3);
  assert.match(String(loud.fields?.['reason']), /credit balance too low/);
  assert.ok(!lines.some((l) => l.msg === 'posts scored'), 'and not the quiet info line');

  /* A pass that answered posts keeps the quiet line. */
  const ok: typeof lines = [];
  const okLog: Logger = { ...log, info: (msg, fields) => void ok.push({ level: 'info', msg, fields }), error: (msg, fields) => void ok.push({ level: 'error', msg, fields }), child: () => okLog };
  const fine = deps([post(4)], recordedJudge(0.82));
  await scorePosts({ ...fine.deps, log: okLog });
  assert.deepEqual(ok.filter((l) => l.level === 'error'), []);
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
  assert.deepEqual(await scorePosts(d), { queued: 2, scored: 0, copied: 0, waiting: 2, wouldSpendUsd: 0, spentUsd: 0 });
});

test('★ free check first: a post below For You\'s reach bar is not sent to the judge; it waits', async () => {
  const judge = recordedJudge(0.82);
  const small = String(post(2).itemId);
  const { deps: d, recorded } = deps([post(1), post(2)], judge, 'live', undefined, (id) => (id === small ? 900 : 1_000_000));
  await scorePosts(d);
  assert.ok(recorded.has(post(1).itemId));
  assert.ok(!recorded.has(post(2).itemId), 'under the bar: waits, unscored');
});

/* ── no double scoring ─────────────────────────────────────────────────── */

const earlier: Judgement = {
  judgeId: 'judge:earlier',
  promptId: 'post@1',
  judgedAt: NOW - 600_000,
  coinable: true,
  confidence: 0.9,
  lookedAt: 'picture',
  proposedName: 'HIPPO',
  alternateNames: [],
  subjectSpans: [],
  rationaleRef: null,
  costUsd: 0.003,
};
const original = post(100);
const answer: ReusableAnswer = { sourceId: original.itemId, judgement: earlier };
const picture = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });

test('★ a plain repost of a judged post is given its answer: a copy at no cost, and no call', async () => {
  const judge = recordedJudge(0.5);
  const repost = { ...post(1), text: `RT ${original.text}`, rebroadcastOf: original.itemId };
  const { deps: d, recorded, copies, asked } = deps([repost], judge, 'live', undefined, undefined, { byItem: new Map([[String(original.itemId), answer]]), byImage: new Map() });
  const result = await scorePosts(d);
  assert.equal(judge.calls.length, 0, 'nothing sent');
  assert.equal(recorded.size, 0);
  const copy = copies.get(repost.itemId);
  assert.ok(copy);
  assert.equal(copy.from, original.itemId);
  assert.equal(copy.judgement.costUsd, 0);
  assert.equal(copy.judgement.judgedAt, NOW);
  assert.deepEqual([copy.judgement.judgeId, copy.judgement.promptId, copy.judgement.confidence], [earlier.judgeId, earlier.promptId, earlier.confidence]);
  assert.deepEqual(result, { queued: 1, scored: 1, copied: 1, waiting: 0, wouldSpendUsd: 0, spentUsd: 0 });
  assert.deepEqual(asked, [{ judgeId: judge.judge.id, promptId: judge.judge.promptId }], 'only this judge and prompt\'s answers are reused');
});

test('★ a quote is reused only when it says nothing of its own: empty or links only, and no picture', () => {
  const found: Found = { byItem: new Map([[String(original.itemId), answer]]), byImage: new Map() };
  const quote = (text: string, media: Item['media'] = []): Item => ({ ...post(2), text, media, reproductionOf: original.itemId });
  assert.equal(reusableFor(quote(''), found), answer);
  assert.equal(reusableFor(quote('  https://t.co/abc123 '), found), answer);
  assert.equal(reusableFor(quote('this is the funniest thing all week'), found), null, 'its own words: judged');
  assert.equal(reusableFor(quote('', [picture('https://example.invalid/own.jpg')]), found), null, 'its own picture: judged');
});

test('★ a post whose first picture is a judged post\'s picture is given that answer', async () => {
  const judge = recordedJudge(0.5);
  const uri = 'https://example.invalid/hippo.jpg';
  const same = { ...post(3), media: [picture(uri)] };
  const other = { ...post(4), media: [picture('https://example.invalid/other.jpg')] };
  const { deps: d, recorded, copies } = deps([same, other], judge, 'live', undefined, undefined, { byItem: new Map(), byImage: new Map([[uri, answer]]) });
  await scorePosts(d);
  assert.equal(copies.get(same.itemId)?.from, original.itemId);
  assert.ok(recorded.has(other.itemId), 'a different picture is judged');
  assert.ok(!recorded.has(same.itemId));
});

test('a dry run copies nothing either', async () => {
  const judge = recordedJudge(0.5);
  const repost = { ...post(5), rebroadcastOf: original.itemId };
  const { deps: d, copies } = deps([repost], judge, 'dry', undefined, undefined, { byItem: new Map([[String(original.itemId), answer]]), byImage: new Map() });
  await scorePosts(d);
  assert.equal(copies.size, 0);
});

test('★ when earlier answers cannot be read, every post is judged — reuse never costs a post its score', async () => {
  const judge = recordedJudge(0.82);
  const repost = { ...post(6), rebroadcastOf: original.itemId };
  const { deps: d, recorded } = deps([repost], judge);
  const broken = { ...d, scores: { ...d.scores, reusable: async () => Promise.reject(new Error('column "copied_from" does not exist')) } };
  await scorePosts(broken);
  assert.equal(judge.calls.length, 1);
  assert.ok(recorded.has(repost.itemId));
});

test('★ the second question holds back a post the first passed when its kind is not OTHER; OTHER files nothing more', async () => {
  const judge = recordedJudge(0.82);
  const filed: { id: string; coinable: boolean; name: string | null }[] = [];
  const { deps: d } = deps([post(1), post(2)], judge);
  const kindOf = (id: string) => (id.endsWith('1') ? 'AD' : 'OTHER');
  const kindJudge = {
    ...judge.judge,
    judge: async (subjects: readonly { storyId: unknown }[]) => ({
      value: subjects.map((s) => {
        const kind = kindOf(String(s.storyId));
        return { kind: 'judged' as const, judgement: { judgeId: 'judge:kind@1', promptId: 'post-kind@1', judgedAt: NOW, coinable: kind === 'OTHER', confidence: 0.9, lookedAt: 'text' as const, proposedName: kind, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0 } };
      }),
      spend: { vendor: 'anthropic', endpoint: 'judge', unit: 'per-call' as const, units: 1, usd: 0, at: NOW },
    }),
  };
  const scores = { ...d.scores, record: async (id: ItemId, j: Judgement) => void filed.push({ id: String(id), coinable: j.coinable, name: j.proposedName }) };
  await scorePosts({ ...d, scores, kindJudge: kindJudge as never });
  const held = filed.filter((f) => !f.coinable);
  assert.equal(held.length, 1, 'only the AD post gets a second, holding answer');
  assert.equal(held[0]?.name, 'AD');
});

/** A kind judge answering each subject with the kind `kindOf` names for it; `asked` lists the subjects it saw. */
function kindJudgeAnswering(base: ReturnType<typeof recordedJudge>, kindOf: (id: string) => string) {
  const asked: string[] = [];
  const kindJudge = {
    ...base.judge,
    promptId: 'post-kind@1',
    judge: async (subjects: readonly { storyId: unknown }[]) => ({
      value: subjects.map((s) => {
        asked.push(String(s.storyId));
        const kind = kindOf(String(s.storyId));
        return { kind: 'judged' as const, judgement: { judgeId: 'judge:kind@1', promptId: 'post-kind@1', judgedAt: NOW, coinable: false, confidence: 0.9, lookedAt: 'text' as const, proposedName: kind, alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0 } };
      }),
      spend: { vendor: 'anthropic', endpoint: 'judge', unit: 'per-call' as const, units: 1, usd: 0, at: NOW },
    }),
  };
  return { kindJudge: kindJudge as never, asked };
}

test('★ a "yes" just under the bar — one the picture boost could lift — is asked the kind question too', async () => {
  const near = P.qualify.minJudgeConfidence.text - P.rising.boostBarMargin;
  const judge = recordedJudge(near);
  const { deps: d } = deps([post(1)], judge);
  const k = kindJudgeAnswering(judge, () => 'TRAGEDY');
  const filed: string[] = [];
  await scorePosts({ ...d, kindJudge: k.kindJudge, scores: { ...d.scores, record: async (_id: ItemId, j: Judgement) => void filed.push(String(j.proposedName)) } });
  assert.equal(k.asked.length, 1, 'the boostable post met the kind question');
  assert.deepEqual(filed, ['baby hippo', 'TRAGEDY'], 'and its tragedy answer was filed to hold it');
});

test('a "yes" far under the bar can never show, and is not asked the kind', async () => {
  const judge = recordedJudge(0.4);
  const { deps: d } = deps([post(1)], judge);
  const k = kindJudgeAnswering(judge, () => 'AD');
  await scorePosts({ ...d, kindJudge: k.kindJudge });
  assert.equal(k.asked.length, 0);
});

test('★ only a held kind label is filed: OTHER and an unknown label file nothing, whatever yes/no came with them', async () => {
  const judge = recordedJudge(0.82);
  const { deps: d } = deps([post(1), post(2), post(3), post(4)], judge);
  const labels: Record<string, string> = { '1': 'TRAGEDY', '2': 'OTHER', '3': 'CORP_NEWS', '4': 'NEWS' };
  const k = kindJudgeAnswering(judge, (id) => labels[id.slice(-1)] ?? 'OTHER');
  const filed: string[] = [];
  await scorePosts({ ...d, kindJudge: k.kindJudge, scores: { ...d.scores, record: async (_id: ItemId, j: Judgement) => void (j.promptId.startsWith('post-kind') && filed.push(String(j.proposedName))) } });
  assert.deepEqual(filed.sort(), ['CORP_NEWS', 'TRAGEDY']);
});

test('★ posts answered under an older prompt are re-judged after the new ones, at most rescorePerPass a pass', async () => {
  const judge = recordedJudge(0.82);
  const stale = Array.from({ length: P.rising.rescorePerPass + 5 }, (_, i) => post(100 + i));
  const { deps: d, recorded } = deps([post(1)], judge, 'live', undefined, undefined, nothingFound, stale);
  const result = await scorePosts(d);
  assert.equal(result.queued, 1 + P.rising.rescorePerPass);
  assert.ok(recorded.has(post(1).itemId), 'the never-judged post first');
  assert.ok(recorded.has(post(100).itemId), 'then the newest stale one');
  assert.ok(!recorded.has(post(100 + P.rising.rescorePerPass).itemId), 'and no more than the cap');
});

test('the stale cut, on, re-judges no post over six hours old after a prompt change; off, it does', async () => {
  const old = { ...post(200), postedAt: (NOW - P.feed.fresh.staleAfterMs - 60_000) as Millis };
  const young = { ...post(201), postedAt: (NOW - 60_000) as Millis };
  const on = { ...P, feed: { ...P.feed, fresh: { ...P.feed.fresh, cutStale: true } } };
  const a = deps([], recordedJudge(0.82), 'live', undefined, undefined, nothingFound, [old, young]);
  await scorePosts({ ...a.deps, policy: on });
  assert.ok(a.recorded.has(young.itemId));
  assert.ok(!a.recorded.has(old.itemId), 'its first answer stands');
  const b = deps([], recordedJudge(0.82), 'live', undefined, undefined, nothingFound, [old, young]);
  await scorePosts(b.deps);
  assert.ok(b.recorded.has(old.itemId), 'off: as today');
});

test('★ the owner\'s closest labels ride along with each post, and a post very close to a "not a meme" label is held, not asked its kind', async () => {
  const judge = recordedJudge(0.82, true);
  const filed: { id: string; name: string | null; promptId: string }[] = [];
  const { deps: d } = deps([post(1), post(2)], judge);
  const { kindJudge, asked } = kindJudgeAnswering(judge, () => 'OTHER');
  const bar = P.judge.precedents.holdNotSimilarity;
  const near = new Map([
    [String(post(1).itemId), { precedents: [{ ref: 'x:900', text: 'a team scored a goal', label: 'not' as const, why: 'sport' }], closestNot: bar + 0.01, closestNotId: 'x:900' }],
    [String(post(2).itemId), { precedents: [{ ref: 'x:900', text: 'a team scored a goal', label: 'not' as const, why: 'sport' }, { ref: 'x:901', text: 'a hippo yawning', label: 'meme' as const, why: null }], closestNot: bar - 0.2, closestNotId: 'x:900' }],
  ]);
  const precedents = { refresh: async () => ({ embedded: 0, relabelled: 0 }), forPosts: async () => near };
  const scores = { ...d.scores, record: async (id: ItemId, j: Judgement) => void filed.push({ id: String(id), name: j.proposedName, promptId: j.promptId }) };
  await scorePosts({ ...d, scores, kindJudge, precedents });
  const body = JSON.stringify(judge.calls[0]);
  assert.match(body, /a team scored a goal/);
  assert.equal((body.match(/a team scored a goal/g) ?? []).length, 1, 'a label near two posts is sent once a call');
  assert.match(body, /labelledLike/);
  const held = filed.filter((f) => f.name === 'NOT_MEME_MATCH');
  assert.deepEqual(held.map((h) => h.id), [String(post(1).itemId)]);
  assert.match(held[0]!.promptId, /^post-kind@/, 'filed as a kind answer, so every held-kind reader holds it');
  assert.equal(asked.length, 1, 'the held post is not asked its kind');
});

test('with no precedents found, posts are judged as before and nothing is held', async () => {
  const judge = recordedJudge(0.82, true);
  const { deps: d, recorded } = deps([post(1)], judge);
  await scorePosts({ ...d, precedents: { refresh: async () => ({ embedded: 0, relabelled: 0 }), forPosts: async () => new Map() } });
  assert.doesNotMatch(JSON.stringify(judge.calls[0]), /labelledLike/);
  assert.equal(recorded.size, 1);
  assert.notEqual(recorded.get(post(1).itemId)?.proposedName, 'NOT_MEME_MATCH');
});
