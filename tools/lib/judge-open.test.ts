/**
 * THE OPEN-MODEL TEST'S PLUMBING, WITH NO KEY AND NO NETWORK: an open model behind a fake host and
 * the live judge as a scripted port, graded end to end by tools/lib/judge-open.ts — the questions,
 * the second ask, the kind question, the holds, the rates, the first pass and the owner's verdict.
 *
 * Not part of `pnpm check` (tools/ is not a workspace package); run it by hand:
 *   node --test --experimental-strip-types tools/lib/judge-open.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import type { JudgeOutcome, JudgePort, JudgeSubject } from '../../contracts/src/ports/judge.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import { openChatClient, openJudge, type HostModel } from '../../adapters/judge/openai-compatible/src/index.ts';
import { PROMPTS } from '../../adapters/judge/anthropic/src/index.ts';
import { agreement, blend, chooseBand, grade, recommend, setRates, speed, timedClient, type Near, type OpenEvalPost, type Row, type Timing } from './judge-open.ts';

const P = DEFAULT_POLICY;
const AT = 1_800_000_000_000;
const budget = () => ({ capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 });
const MODEL: HostModel = { id: 'maker/vision-27b', vision: true, usdPerInputToken: 1e-7, usdPerOutputToken: 4e-7, contextLength: null };

const post = (group: OpenEvalPost['group'], id: string, text = `post ${id}`): OpenEvalPost => ({ group, id, text, media: [{ kind: 'image', uri: `https://pics.invalid/${id}.jpg`, width: null, height: null, durationMs: null }] });

/** A fake host whose model says yes (with `conf`) to ids in `yes`, no to the rest, kind OTHER — and forgets `drop` the first time. */
function fakeHost(yes: ReadonlyMap<string, number>, drop: ReadonlySet<string> = new Set()) {
  const sent: { system: string; ids: string[]; precedents: boolean }[] = [];
  const dropped = new Set<string>();
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://pics.invalid/')) return new Response(new Uint8Array([0xff, 0xd8]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    const body = JSON.parse(String(init?.body)) as { messages: { role: string; content: unknown }[] };
    const system = String(body.messages[0]?.content);
    const parts = body.messages[1]?.content as { type: string; text?: string }[];
    const stories = JSON.parse((parts.find((p) => p.text?.startsWith('Stories to judge'))?.text ?? '').split('\n').slice(1).join('\n')) as { storyId: string }[];
    sent.push({ system, ids: stories.map((s) => s.storyId), precedents: parts.some((p) => p.text?.includes('"ref":"L1"')) });
    const isKind = system === PROMPTS['post-veto-system'].text;
    const answers = stories.flatMap((s) => {
      const id = s.storyId.replace(/^(story_)?rate-/, '').replace(/-/, ':');
      if (drop.has(id) && !dropped.has(id)) { dropped.add(id); return []; }
      const c = yes.get(id);
      return isKind
        ? [{ storyId: s.storyId, coinable: true, proposedName: 'OTHER', confidence: 0.9, alternateNames: [], subjectSpans: [] }]
        : [{ storyId: s.storyId, coinable: c !== undefined, proposedName: c === undefined ? null : 'GERALD', confidence: c ?? 0.2, alternateNames: [], subjectSpans: [] }];
    });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers }) } }], usage: { prompt_tokens: 1000, completion_tokens: 100, cost: 0.001 } }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

function openPorts(host: ReturnType<typeof fakeHost>, timings: Timing[]) {
  const client = openChatClient({ vendor: 'router', apiKey: 'test-key', baseUrl: 'https://router.invalid/v1', model: MODEL.id, vision: true, maxOutputTokens: 1200, timeoutMs: 1000, maxAttempts: 1, backoffMs: 1, maxWaitMs: 1, maxFrameBytes: 1e6, fetch: host.fetch, sleep: async () => {} });
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => AT });
  const deps = { meter, now: () => AT, model: MODEL, vendor: 'router', policy: P.judge, maxBatch: 10 };
  return { post: openJudge({ ...deps, client: timedClient(client, timings, (() => { let t = 0; return () => (t += 500); })()), question: 'post', precedents: true }), kind: openJudge({ ...deps, client, question: 'kind' }), meter };
}

const near = (ids: readonly string[], over: Partial<Near> = {}) => new Map(ids.map((id) => [id, { precedents: [{ ref: 'x:lab', text: 'a labelled post', label: 'meme' as const, why: null }], closestNot: 0.1, similarity: null, ...over }] as const));

test('★ graded as live: precedents sent, ten a call, a dropped answer asked again, kind asked only of passes, held kinds and the not-a-meme hold applied', async () => {
  const posts = [...Array.from({ length: 12 }, (_, i) => post('gold', `x:${i}`)), post('live-not', 'x:n1'), post('live-not', 'x:n2'), post('missed', 'x:m1')];
  const yes = new Map([['x:0', 0.95], ['x:1', 0.9], ['x:2', 0.5], ['x:n1', 0.9], ['x:n2', 0.95], ['x:m1', 0.99]]);
  const host = fakeHost(yes, new Set(['x:1']));
  const timings: Timing[] = [];
  const ports = openPorts(host, timings);
  const nearMap = new Map([...near(posts.map((p) => p.id)), ['x:n2', { precedents: [], closestNot: 0.99, similarity: null }]]);
  const rows = await grade(posts, ports, { policy: P, near: nearMap, signals: new Map(), maxBatch: 10, budget });
  assert.equal(host.sent.filter((s) => s.precedents).length >= 2, true, 'the precedents ride along');
  const firstQ = host.sent.filter((s) => s.system === PROMPTS['post-system'].text);
  assert.ok(firstQ.every((s) => s.ids.length <= 10), 'ten a call');
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get('x:1')?.coinable, true, 'the dropped answer was asked again');
  assert.equal(by.get('x:2')?.onFeed, false, 'a yes under the bar does not pass');
  assert.equal(by.get('x:0')?.onFeed, true);
  assert.equal(by.get('x:0')?.kind, 'OTHER', 'the kind question was asked of a pass');
  assert.equal(by.get('x:2')?.kind, null, 'and not of a post below the bar');
  assert.equal(by.get('x:n2')?.kind, 'NOT_MEME_MATCH', 'held when very close to a "not a meme" label');
  assert.equal(by.get('x:n2')?.onFeed, false);
  const r = setRates(rows);
  assert.deepEqual(r.hand, { passed: 3, tested: 13, unanswered: 0 }, 'hand gold is gold and missed together');
  assert.deepEqual(r.negatives, { passed: 1, tested: 2, unanswered: 0 });
  assert.deepEqual(r.missed, { passed: 1, tested: 1, unanswered: 0 });
  assert.deepEqual(speed(timings), { median: 0.1, p90: 0.5, calls: 3 }, 'each call timed, over the posts it carried: 10, 5 and the one asked again');
  assert.ok(ports.meter.spentUsd('router') > 0, 'what the host billed is on the meter');
});

const row = (id: string, group: Row['group'], onFeed: boolean | null, confidence: number | null): Row => ({ id, group, coinable: onFeed, confidence, lookedAt: 'picture', name: null, firstPass: onFeed === true, kind: null, onFeed });

test('★ the owner\'s rule: all three sets matched or beaten AND cheaper; anything less is no', () => {
  const live = setRates([row('a', 'gold', true, 0.9), row('b', 'gold', false, 0.3), row('n', 'live-not', true, 0.9), row('m', 'missed', true, 0.9)]);
  const same = setRates([row('a', 'gold', true, 0.9), row('b', 'gold', false, 0.3), row('n', 'live-not', true, 0.9), row('m', 'missed', true, 0.9)]);
  assert.equal(recommend(same, live, 1, 2).switch, true, 'matches on all three and costs less');
  assert.equal(recommend(same, live, 2, 2).switch, false, 'the same cost is not less');
  const worseNeg = setRates([row('a', 'gold', true, 0.9), row('b', 'gold', true, 0.9), row('n', 'live-not', true, 0.9), row('n2', 'live-not', true, 0.9), row('m', 'missed', true, 0.9)]);
  const v = recommend(worseNeg, setRates([row('a', 'gold', true, 0.9), row('n', 'live-not', false, 0.2), row('m', 'missed', true, 0.9)]), 1, 2);
  assert.equal(v.switch, false);
  assert.match(v.why.join(), /non-memes/);
});

test('the first pass: borderline and unanswered posts go to the live judge, and the band is chosen from the data', () => {
  const open = [row('a', 'gold', false, 0.6), row('b', 'gold', true, 0.95), row('n', 'live-not', true, 0.9), row('m', 'missed', null, null)];
  const live = new Map([row('a', 'gold', true, 0.8), row('b', 'gold', true, 0.9), row('n', 'live-not', false, 0.3), row('m', 'missed', true, 0.9)].map((r) => [r.id, r] as const));
  const b = blend(open, live, [0.5, 0.85]);
  assert.equal(b.handed, 2, 'the borderline one and the unanswered one');
  assert.deepEqual(setRates(b.rows).hand, { passed: 3, tested: 3, unanswered: 0 });
  const chosen = chooseBand(open, live, setRates([...live.values()]));
  assert.equal(chosen.matches, true);
  assert.deepEqual(setRates(blend(open, live, chosen.band).rows).negatives.passed, 0, 'the chosen band sends the non-meme to the live judge');
  const a = agreement(open, live);
  assert.deepEqual(a.coinable, { same: 1, of: 3 });
  assert.equal(a.liveShown, 2);
});

test('a port can be any judge: the live one is graded by the same function', async () => {
  const scripted: JudgePort = {
    id: 'live', promptId: 'p', maxBatch: 10,
    estimate: () => ({ vendor: 'v', endpoint: 'e', unit: 'per-call', estUnits: 1, usd: 0 }),
    async judge(subjects: readonly JudgeSubject[]) {
      return { value: subjects.map((s): JudgeOutcome => ({ kind: 'judged', judgement: { judgeId: 'live', promptId: 'p', judgedAt: AT, coinable: true, confidence: 0.9, lookedAt: 'picture', proposedName: 'GERALD', alternateNames: [], subjectSpans: [], rationaleRef: null, costUsd: 0 } })), spend: { vendor: 'v', endpoint: 'e', unit: 'per-call', units: 1, usd: 0, at: AT } };
    },
  };
  const rows = await grade([post('gold', 'x:1')], { post: scripted, kind: scripted }, { policy: P, near: new Map(), signals: new Map(), maxBatch: 10, budget });
  assert.equal(rows[0]?.firstPass, true);
  assert.equal(rows[0]?.kind, 'GERALD', 'the kind port answered; not a held kind, so it shows');
  assert.equal(rows[0]?.onFeed, true);
});
