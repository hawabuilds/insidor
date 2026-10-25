/**
 * The routes against a stand-in encoder and a stand-in picture host: the secret, the caps, a dead
 * picture costing one null (or the words alone), the weighted words-and-picture vector, and a
 * private address never fetched.
 */

import { strict as assert } from 'node:assert';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { loadEmbedConfig } from './config.ts';
import { meanPool, type Encoder } from './model.ts';
import { fetchPicture, privateAddress } from './picture.ts';
import { embed, handler, readInputs, readPostSpace, SECRET_HEADER, type ServiceDeps } from './server.ts';
import { E5_POST_DIMENSIONS, E5_POST_SPACE, E5_POST_TEXT_WEIGHT, MODEL_DIMENSIONS, POST_SPACE, POST_TEXT_WEIGHT, probeDistance, SPACE, WORDS_DIMENSIONS, WORDS_PROBE } from './space.ts';
import { beside, combine, unit } from './vectors.ts';

const SECRET = 'a-test-secret-of-24-chars-or-more';
const TEXT = Float32Array.from([1, 0, 0]);
const PICTURE = Float32Array.from([0, 1, 0]);

/* The second space's halves are the real widths, so `beside` is exercised as the service runs it. */
const WORDS = (() => {
  const v = new Float32Array(WORDS_DIMENSIONS);
  v[0] = 1;
  return v;
})();
const WIDE_PICTURE = (() => {
  const v = new Float32Array(MODEL_DIMENSIONS);
  v[1] = 1;
  return v;
})();
let wide = false;
const encoder: Encoder = {
  embedTexts: async (texts) => texts.map(() => TEXT),
  embedPicture: async (bytes) => (bytes[0] === 0xff ? (wide ? WIDE_PICTURE : PICTURE) : null),
  embedWords: async (texts) => texts.map(() => WORDS),
};

/* Every host resolves to a public address except one; every fetch answers from this table. */
const lookup = async (host: string): Promise<string[]> => (host === 'sneaky.example' ? ['10.0.0.5'] : ['93.184.216.34']);
const pictures: Record<string, () => Response> = {
  'https://img.example/ok.jpg': () => new Response(new Uint8Array([0xff, 1, 2])),
  'https://img.example/notimage.jpg': () => new Response(new Uint8Array([1, 2, 3])),
  'https://img.example/gone.jpg': () => new Response('gone', { status: 404 }),
  'https://img.example/big.jpg': () => new Response(new Uint8Array(2_000)),
  'https://img.example/hop': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
};
const fetched: string[] = [];
const fakeFetch = (async (input: URL | string) => {
  const key = String(input);
  fetched.push(key);
  return (pictures[key] ?? (() => new Response('', { status: 404 })))();
}) as typeof globalThis.fetch;

const deps = (over: Partial<ServiceDeps> = {}): ServiceDeps => ({
  encoder: () => encoder,
  wordsAgree: () => true,
  secret: SECRET,
  pictures: { timeoutMs: 1_000, maxBytes: 1_000, maxRedirects: 3 },
  maxInputs: 4,
  maxBodyBytes: 10_000,
  maxTextChars: 100,
  fetchConcurrency: 2,
  fetch: fakeFetch,
  lookup,
  log: () => undefined,
  rssBytes: () => 0,
  ...over,
});

async function serve(d: ServiceDeps): Promise<{ url: string; server: Server }> {
  const server = createServer(handler(d));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

test('★ words and a picture are one vector, words weighted, unit length', async () => {
  const reply = await embed([{ text: 'a deer bows', imageUrl: 'https://img.example/ok.jpg' }], encoder, deps());
  const expected = combine(TEXT, PICTURE, POST_TEXT_WEIGHT)!;
  const v = reply.vectors[0]!;
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6);
  assert.ok(Math.abs((v[0] ?? 0) - (expected[0] ?? 0)) < 1e-6 && (v[0] ?? 0) > (v[1] ?? 0), 'words carry more of the vector');
  assert.equal(reply.space, SPACE);
  assert.equal(reply.postSpace, POST_SPACE);
  assert.deepEqual(reply.pictures, ['read']);
});

test('★ a dead or unreadable picture is one null — or the words alone — never a failed batch', async () => {
  const reply = await embed(
    [
      { imageUrl: 'https://img.example/gone.jpg' },
      { imageUrl: 'https://img.example/notimage.jpg' },
      { text: 'words survive', imageUrl: 'https://img.example/big.jpg' },
      { imageUrl: 'https://img.example/ok.jpg' },
    ],
    encoder,
    deps(),
  );
  assert.equal(reply.vectors[0], null);
  assert.equal(reply.vectors[1], null);
  assert.deepEqual(reply.vectors[2], [1, 0, 0]);
  assert.deepEqual(reply.vectors[3], [0, 1, 0]);
  assert.deepEqual(reply.pictures, ['unread', 'unread', 'unread', 'read']);
});

test('★ a private address is never fetched, by its spelling, its name or a redirect', async () => {
  fetched.length = 0;
  for (const address of ['http://localhost/x.jpg', 'http://runner.railway.internal/x', 'http://10.1.2.3/x', 'http://[::1]/x', 'https://sneaky.example/x', 'file:///etc/passwd']) {
    const got = await fetchPicture(address, deps().pictures, fakeFetch, lookup);
    assert.ok('unread' in got, address);
  }
  assert.deepEqual(fetched, []);
  const hop = await fetchPicture('https://img.example/hop', deps().pictures, fakeFetch, lookup);
  assert.deepEqual(hop, { unread: 'private' });
  assert.deepEqual(fetched, ['https://img.example/hop']);
  assert.ok(privateAddress('100.64.0.1') && privateAddress('fd00::1') && !privateAddress('8.8.8.8'));
});

test('the body is checked: an object with inputs, at most maxInputs, strings only, text cut', () => {
  assert.throws(() => readInputs({}, 4, 10));
  assert.throws(() => readInputs({ inputs: [{}, {}, {}, {}, {}] }, 4, 10));
  assert.throws(() => readInputs({ inputs: [{ text: 3 }] }, 4, 10));
  assert.deepEqual(readInputs({ inputs: [{ text: '  0123456789abc ' }, { text: ' ', imageUrl: '' }] }, 4, 10), [{ text: '0123456789' }, {}]);
});

test('★ no key, no vectors; a loading model is a 503; health says which space', async () => {
  let loaded: Encoder | null = null;
  const { url, server } = await serve(deps({ encoder: () => loaded }));
  try {
    const body = JSON.stringify({ inputs: [{ text: 'hi' }] });
    assert.equal((await fetch(`${url}/embed`, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(`${url}/embed`, { method: 'POST', body, headers: { [SECRET_HEADER]: 'wrong' } })).status, 401);
    assert.equal((await fetch(`${url}/embed`, { method: 'POST', body, headers: { [SECRET_HEADER]: SECRET } })).status, 503);
    assert.equal((await fetch(`${url}/health`)).status, 503);
    loaded = encoder;
    const health = (await (await fetch(`${url}/health`)).json()) as { space: string };
    assert.equal(health.space, SPACE);
    const ok = await fetch(`${url}/embed`, { method: 'POST', body, headers: { [SECRET_HEADER]: SECRET } });
    assert.equal(ok.status, 200);
    assert.deepEqual(((await ok.json()) as { vectors: unknown }).vectors, [[1, 0, 0]]);
    assert.equal((await fetch(`${url}/embed`, { method: 'POST', body: 'not json', headers: { [SECRET_HEADER]: SECRET } })).status, 400);
  } finally {
    server.close();
  }
});

test('a vector of zeros is no vector; unit() normalises', () => {
  assert.equal(unit(new Float32Array(3)), null);
  assert.deepEqual(Array.from(unit(Float32Array.from([3, 4]))!), [0.6000000238418579, 0.800000011920929]);
});

test('★ no secret, no service', () => {
  assert.throws(() => loadEmbedConfig({}));
  assert.throws(() => loadEmbedConfig({ EMBED_SECRET: 'short' }));
  assert.equal(loadEmbedConfig({ EMBED_SECRET: SECRET }).maxInputs, 64);
});

test('★ the second post space: the other words model beside the picture, 1,536 wide, cosine = w·words + (1−w)·picture', async () => {
  wide = true;
  try {
    const reply = await embed(
      [{ text: 'a deer bows', imageUrl: 'https://img.example/ok.jpg' }, { text: 'words only' }, { imageUrl: 'https://img.example/ok.jpg' }, { text: 'dead picture', imageUrl: 'https://img.example/gone.jpg' }],
      encoder,
      deps(),
      E5_POST_SPACE,
    );
    assert.equal(reply.postSpace, E5_POST_SPACE);
    assert.equal(reply.space, SPACE);
    assert.equal(reply.dimensions, E5_POST_DIMENSIONS);
    const [both, words, picture, unread] = reply.vectors.map((v) => v!);
    for (const v of [both, words, picture, unread]) assert.equal(v!.length, E5_POST_DIMENSIONS), assert.ok(Math.abs(Math.hypot(...v!) - 1) < 1e-6);
    const dot = (a: readonly number[], b: readonly number[]) => a.reduce((n, x, i) => n + x * (b[i] ?? 0), 0);
    /* Same words and same picture: w·1 + (1−w)·1; words against the pictured post: √w; picture alone against it: √(1−w). */
    assert.ok(Math.abs(dot(both!, both!) - 1) < 1e-6);
    assert.ok(Math.abs(dot(both!, words!) - Math.sqrt(E5_POST_TEXT_WEIGHT)) < 1e-6);
    assert.ok(Math.abs(dot(both!, picture!) - Math.sqrt(1 - E5_POST_TEXT_WEIGHT)) < 1e-6);
    assert.equal(picture![0], 0, 'a picture alone has no words half');
    assert.deepEqual(unread, words, 'a dead picture leaves the words alone');
    assert.deepEqual(reply.pictures, ['read', 'none', 'read', 'unread']);
  } finally {
    wide = false;
  }
});

test('beside: wrong widths and nothing at all are no vector', () => {
  assert.equal(beside(null, null, 2, 2, 0.7), null);
  assert.equal(beside(Float32Array.from([1]), null, 2, 2, 0.7), null);
  assert.deepEqual(Array.from(beside(Float32Array.from([1, 0]), null, 2, 2, 0.7)!), [1, 0, 0, 0]);
});

test('★ a post space is asked for by name; an unknown one is refused, never answered in the default', () => {
  assert.equal(readPostSpace({ inputs: [] }), POST_SPACE);
  assert.equal(readPostSpace({ inputs: [], postSpace: E5_POST_SPACE }), E5_POST_SPACE);
  assert.throws(() => readPostSpace({ inputs: [], postSpace: 'some-other.post' }));
  assert.throws(() => readPostSpace({ inputs: [], postSpace: 3 }));
});

test('★ the second space answers only once its words model reproduced the probe', async () => {
  let agree = false;
  const { url, server } = await serve(deps({ wordsAgree: () => agree }));
  try {
    const headers = { [SECRET_HEADER]: SECRET };
    const ask = (postSpace?: string) => fetch(`${url}/embed`, { method: 'POST', headers, body: JSON.stringify({ inputs: [{ text: 'hi' }], ...(postSpace === undefined ? {} : { postSpace }) }) });
    assert.equal((await ask(E5_POST_SPACE)).status, 503);
    assert.equal((await ask()).status, 200, 'the old space carries on');
    assert.equal((await ask('nope.post')).status, 400);
    assert.deepEqual(((await (await fetch(`${url}/health`)).json()) as { postSpaces: string[] }).postSpaces, [POST_SPACE]);
    agree = true;
    const ok = await ask(E5_POST_SPACE);
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as { dimensions: number }).dimensions, E5_POST_DIMENSIONS);
    assert.deepEqual(((await (await fetch(`${url}/health`)).json()) as { postSpaces: string[] }).postSpaces, [POST_SPACE, E5_POST_SPACE]);
  } finally {
    server.close();
  }
});

test('mean pooling counts only the tokens the mask keeps', () => {
  const states = { dims: [2, 3, 2], data: [1, 1, 3, 3, 100, 100, 2, 0, 50, 50, 50, 50] };
  const mask = { dims: [2, 3], data: [1n, 1n, 0n, 1n, 0n, 0n] };
  assert.deepEqual(meanPool(states, mask).map((v) => Array.from(v)), [[2, 2], [2, 0]]);
});

test('the probe: agreement within the tolerance, and an empty head never agrees', () => {
  assert.ok(probeDistance(WORDS_PROBE.head, WORDS_PROBE.head.map((v) => v + 1e-6)) <= WORDS_PROBE.tolerance);
  assert.ok(probeDistance(WORDS_PROBE.head, WORDS_PROBE.head.map((v) => v + 1e-2)) > WORDS_PROBE.tolerance);
  assert.equal(probeDistance([], [1]), Infinity);
});
