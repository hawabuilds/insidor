/**
 * The re-tune's grading asks the open judge and nothing else (the owner, 2026-10-16: no Anthropic
 * API at all), with its own 40 precedents a post. The network is a fake: every request is recorded
 * and answered here, so the test proves where the requests go and what they carry.
 * Run: node --test --experimental-strip-types tools/lib/pass-rates.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import type { LabelledVector } from '../../core/src/qualify/precedents.ts';
import { LineTooShort, gradePosts, type EvalPost } from './pass-rates.ts';

const P = DEFAULT_POLICY;
const unit = (i: number): Float32Array => {
  const v = new Float32Array([1, i / 100, 0]);
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
/* Three test posts, each also a label (so its vector is reused and nothing is embedded), and 60 more labels. */
const posts: EvalPost<'gold'>[] = [0, 1, 2].map((i) => ({ group: 'gold', id: `x:t${i}`, kind: 'test', text: `test post ${i}`, imageUri: null }));
const labels: LabelledVector[] = [
  ...posts.map((p, i) => ({ itemId: p.id, label: 'meme' as const, kind: 'tap' as const, text: p.text, why: null, picture: null, values: unit(i) })),
  ...Array.from({ length: 60 }, (_, i) => ({ itemId: `x:l${i}`, label: (i % 2 === 0 ? 'meme' : 'not') as 'meme' | 'not', kind: 'tap' as const, text: `label ${i}`, why: null, picture: null, values: unit(i + 3) })),
];

function fakeHost() {
  const asked: { url: string; body: Record<string, unknown> | null }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    asked.push({ url, body });
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'google/gemma-3-27b-it', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.00000008', completion: '0.00000045' }, context_length: 131072 }] }), { status: 200 });
    }
    const user = ((body?.['messages'] as { content: { type: string; text?: string }[] }[])[1]?.content ?? []).map((c) => c.text ?? '').join('\n');
    const ids = [...user.matchAll(/"storyId":"([^"]+)"/g)].map((m) => m[1]);
    const answers = ids.map((storyId) => ({ storyId, coinable: true, proposedName: 'OTHER', confidence: 0.9, alternateNames: [], subjectSpans: [] }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answers }) } }], usage: { prompt_tokens: 1000, completion_tokens: 50, cost: 0.0001 } }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { asked, fetch };
}

const env = { OPENROUTER_API_KEY: 'test-key', OPEN_JUDGE_PROVIDERS: '' };

test('★ graded by the open judge only, each post with its own 40 closest labels', async () => {
  const host = fakeHost();
  const real = globalThis.fetch;
  globalThis.fetch = host.fetch;
  try {
    const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now });
    const out = await gradePosts(posts, { env, meter, examples: 'EXAMPLES', coined: null, precedents: { labels }, mustFit: true });
    assert.equal(out.model, 'google/gemma-3-27b-it');
    assert.ok(host.asked.length >= 2, 'the model list, then the post question (and the kind question)');
    assert.ok(host.asked.every((a) => a.url.startsWith('https://openrouter.ai/')), `only the open host is asked: ${host.asked.map((a) => a.url).join(', ')}`);
    const post = host.asked.find((a) => JSON.stringify(a.body ?? {}).includes('labelledLike'));
    const stories = JSON.parse(/Stories to judge, as JSON\. Answer once for each storyId\.\n(.*)$/s.exec(JSON.stringify(((post?.body?.['messages'] as { content: { text?: string }[] }[])[1]?.content ?? []).map((c) => c.text ?? '').join('\n')).replace(/^"|"$/g, '').replaceAll('\\n', '\n').replaceAll('\\"', '"'))?.[1] ?? '[]') as { labelledLike: string[] }[];
    assert.equal(stories.length, 3);
    for (const s of stories) assert.equal(s.labelledLike.length, P.judge.precedents.openK, 'the open judge reads openK precedents, not the main judge\'s k');
    assert.ok(out.rows.every((r) => r.coinable === true && r.confidence === 0.9), 'every post answered');
    assert.ok(meter.spentUsd('openrouter') > 0, 'billed to the open host on the meter');
  } finally {
    globalThis.fetch = real;
  }
});

test('a test the line cannot cover is not started', async () => {
  const host = fakeHost();
  const real = globalThis.fetch;
  globalThis.fetch = host.fetch;
  try {
    const meter = inMemoryMeter({ dailyCapUsd: 0.000_001, softStop: 1, now: Date.now });
    await assert.rejects(gradePosts(posts, { env, meter, examples: null, coined: null, precedents: { labels }, mustFit: true }), LineTooShort);
    assert.ok(host.asked.every((a) => a.url.endsWith('/models')), 'nothing was judged');
  } finally {
    globalThis.fetch = real;
  }
});

test('no key, no grading', async () => {
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now });
  await assert.rejects(gradePosts(posts, { env: {}, meter, examples: null, coined: null }), /OPENROUTER_API_KEY/);
});
