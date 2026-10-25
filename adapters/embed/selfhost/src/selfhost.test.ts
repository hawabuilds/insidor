/**
 * The self-hosted embedding adapter against recorded replies: vectors padded to the stored width
 * without changing a cosine, a reply in another space refused, $0 calls still recorded, the secret
 * sent only in its header, and a restarting service retried while a bad request is not.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import type { Meter, Spend } from '@insidor/contracts/ports/meter.ts';
import type { MediaRef } from '@insidor/contracts/vocabulary.ts';
import { VendorShapeError, VendorUnavailable } from '@insidor/vendor-kit';

import { DIMENSIONS, E5_POST_DIMENSIONS, E5_POST_SPACE, httpClient, MODEL_DIMENSIONS, padded, POST_SPACE, readReply, selfEmbed, SPACE, type SelfEmbedClient } from './index.ts';

const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: 1_800_000_060_000 };
const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });

function meter(): Meter & { spends: Spend[] } {
  const spends: Spend[] = [];
  return {
    spends,
    record: (s: Spend) => void spends.push(s),
    spentUsd: () => 0,
    mayspend: () => true,
    line: () => ({ capUsd: 1, spentUsd: 0, stopAtUsd: 1, remainingUsd: 1, unrecordedUsd: 0 }),
  } as unknown as Meter & { spends: Spend[] };
}

const vec = (first: number): number[] => {
  const v = new Array<number>(MODEL_DIMENSIONS).fill(0);
  v[0] = first;
  v[1] = Math.sqrt(1 - first * first);
  return v;
};
const reply = (vectors: (number[] | null)[], space = SPACE) => ({ model: 'm', space, postSpace: `${space}.post`, dimensions: MODEL_DIMENSIONS, vectors, pictures: vectors.map(() => 'read') });

const client = (raw: unknown, sent: unknown[] = [], asked: (string | undefined)[] = []): SelfEmbedClient => ({
  embed: async (inputs, postSpace) => (sent.push(inputs), asked.push(postSpace), readReply(raw, inputs.length)),
});

const wideVec = (first: number): number[] => {
  const v = new Array<number>(E5_POST_DIMENSIONS).fill(0);
  v[0] = first;
  v[E5_POST_DIMENSIONS - 1] = Math.sqrt(1 - first * first);
  return v;
};
const wideReply = (vectors: (number[] | null)[], postSpace = E5_POST_SPACE, dimensions = E5_POST_DIMENSIONS) => ({ model: 'm', space: SPACE, postSpace, dimensions, vectors, pictures: vectors.map(() => 'read') });

test('★ padded to 1,024 with zeros: same length, same cosine', () => {
  const a = Float32Array.from(vec(0.6));
  const b = Float32Array.from(vec(0.8));
  const pa = padded(a)!;
  const pb = padded(b)!;
  assert.equal(pa.length, DIMENSIONS);
  const dot = (x: Float32Array, y: Float32Array): number => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
  assert.ok(Math.abs(dot(pa, pb) - dot(a, b)) < 1e-9);
  assert.equal(padded(new Float32Array(5)), null);
});

test('★ pictures and posts are tagged with their own spaces; $0, but every call recorded', async () => {
  const m = meter();
  const port = selfEmbed({ client: client(reply([vec(0.6), vec(1)])), meter: m, now: () => 1_800_000_000_000 });
  const pictures = await port.embedMedia!([image('https://img.example/a.jpg'), image('https://img.example/b.jpg')], budget);
  assert.equal(pictures.value[0]?.space, SPACE);
  assert.equal(pictures.value[0]?.dimensions, DIMENSIONS);
  const posts = await port.embedPosts!([{ text: 'deer', picture: 'https://img.example/a.jpg' }, { text: 'goats', picture: null }], budget);
  assert.equal(posts.value[1]?.space, POST_SPACE);
  assert.equal(m.spends.length, 2);
  assert.equal(m.spends[0]?.usd, 0);
  assert.equal(m.spends[0]?.units, 2);
  assert.equal(port.space, SPACE);
  assert.equal(port.postSpace, POST_SPACE);
});

test('★ a reply in another space is refused, never stored as ours', async () => {
  const port = selfEmbed({ client: client(reply([vec(0.6)], 'some-other-model.768')), meter: meter(), now: () => 1_800_000_000_000 });
  await assert.rejects(port.embedMedia!([image('https://img.example/a.jpg')], budget), VendorUnavailable);
});

test('nothing is sent for a video, an empty text or a post with neither words nor picture', async () => {
  const sent: unknown[] = [];
  const port = selfEmbed({ client: client(reply([vec(1)]), sent), meter: meter(), now: () => 1_800_000_000_000 });
  const out = await port.embedPosts!([{ text: ' ', picture: null }, { text: '', picture: 'https://img.example/a.jpg' }], budget);
  assert.equal(out.value[0], null);
  assert.ok(out.value[1] !== null);
  assert.deepEqual(sent, [[{ imageUrl: 'https://img.example/a.jpg' }]]);
  const media = await port.embedMedia!([{ kind: 'video', uri: 'https://v.example/a.mp4', width: null, height: null, durationMs: null }], budget);
  assert.equal(media.value[0], null);
  assert.equal(sent.length, 1);
});

test('a reply with the wrong count or width is a shape error', () => {
  assert.throws(() => readReply(reply([vec(1)]), 2), VendorShapeError);
  assert.throws(() => readReply({ ...reply([[1, 2]]) }, 1), VendorShapeError);
});

test('★ the key travels in its header only; a restart is retried, a bad request is not', async () => {
  const calls: { url: string; key: string | null }[] = [];
  const answers = [() => new Response('loading', { status: 503 }), () => Response.json(reply([vec(1)]))];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, key: new Headers(init.headers).get('x-embed-key') });
    return (answers.shift() ?? (() => new Response('', { status: 400 })))();
  }) as unknown as typeof globalThis.fetch;
  const c = httpClient({ baseUrl: 'http://embed.example/', secret: 'k'.repeat(30), fetch: fetchFn, retryDelaysMs: [0, 0], sleep: async () => undefined });
  const got = await c.embed([{ text: 'hi' }]);
  assert.equal(got.vectors.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url === 'http://embed.example/embed' && call.key === 'k'.repeat(30)));
  await assert.rejects(c.embed([{ text: 'hi' }]), (e: unknown) => e instanceof VendorUnavailable && e.status === 400 && !e.message.includes('kkkk'));
  assert.equal(calls.length, 3, 'a 4xx is not retried');
});

test('★ a port built for the second post space asks for it by name and keeps its 1,536 values as they are', async () => {
  const asked: (string | undefined)[] = [];
  const port = selfEmbed({ client: client(wideReply([wideVec(0.6), null]), [], asked), meter: meter(), now: () => 1_800_000_000_000, postSpace: E5_POST_SPACE });
  assert.equal(port.postSpace, E5_POST_SPACE);
  assert.equal(port.space, SPACE, 'pictures stay in the picture space');
  const got = await port.embedPosts!([{ text: 'deer', picture: 'https://img.example/a.jpg' }, { text: 'goats', picture: null }], budget);
  assert.deepEqual(asked, [E5_POST_SPACE]);
  assert.equal(got.value[0]?.space, E5_POST_SPACE);
  assert.equal(got.value[0]?.dimensions, E5_POST_DIMENSIONS);
  assert.equal(got.value[0]?.values.length, E5_POST_DIMENSIONS);
  assert.ok(Math.abs((got.value[0]?.values[E5_POST_DIMENSIONS - 1] ?? 0) - 0.8) < 1e-6, 'not padded, not cut');
  assert.equal(got.value[1], null);
});

test('★ the second space\'s port still embeds pictures in the picture space, asking for no post space', async () => {
  const asked: (string | undefined)[] = [];
  const port = selfEmbed({ client: client(reply([vec(0.6)]), [], asked), meter: meter(), now: () => 1_800_000_000_000, postSpace: E5_POST_SPACE });
  const got = await port.embedMedia!([image('https://img.example/a.jpg')], budget);
  assert.deepEqual(asked, [undefined]);
  assert.equal(got.value[0]?.space, SPACE);
  assert.equal(got.value[0]?.dimensions, DIMENSIONS);
});

test('★ a reply in the old post space, or the old width, is refused when the second was asked for', async () => {
  const old = selfEmbed({ client: client(wideReply([wideVec(1)], POST_SPACE)), meter: meter(), now: () => 1_800_000_000_000, postSpace: E5_POST_SPACE });
  await assert.rejects(old.embedPosts!([{ text: 'deer', picture: null }], budget), VendorUnavailable);
  const narrow = selfEmbed({ client: client(reply([vec(1)])), meter: meter(), now: () => 1_800_000_000_000, postSpace: E5_POST_SPACE });
  await assert.rejects(narrow.embedPosts!([{ text: 'deer', picture: null }], budget), VendorUnavailable);
  assert.throws(() => selfEmbed({ client: client(reply([])), meter: meter(), now: () => 1_800_000_000_000, postSpace: 'made-up.post' }));
});

test('the client names the post space in the body only when one is asked for', async () => {
  const bodies: unknown[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json(wideReply([wideVec(1)]));
  }) as unknown as typeof globalThis.fetch;
  const c = httpClient({ baseUrl: 'http://embed.example', secret: 'k'.repeat(30), fetch: fetchFn });
  await c.embed([{ text: 'hi' }], E5_POST_SPACE);
  await c.embed([{ text: 'hi' }]);
  assert.deepEqual(bodies, [{ inputs: [{ text: 'hi' }], postSpace: E5_POST_SPACE }, { inputs: [{ text: 'hi' }] }]);
});
