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
import type { Encoder } from './model.ts';
import { fetchPicture, privateAddress } from './picture.ts';
import { embed, handler, readInputs, SECRET_HEADER, type ServiceDeps } from './server.ts';
import { POST_SPACE, POST_TEXT_WEIGHT, SPACE } from './space.ts';
import { combine, unit } from './vectors.ts';

const SECRET = 'a-test-secret-of-24-chars-or-more';
const TEXT = Float32Array.from([1, 0, 0]);
const PICTURE = Float32Array.from([0, 1, 0]);

const encoder: Encoder = {
  embedTexts: async (texts) => texts.map(() => TEXT),
  embedPicture: async (bytes) => (bytes[0] === 0xff ? PICTURE : null),
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
