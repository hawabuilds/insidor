/**
 * The creator-host reader: what it refuses before any request (scheme, IP literal, local name,
 * private address) and what it keeps of a document it may read. Plain functions; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchDeclaredMetadata, fetchableUrl, isPublicAddress } from './declared-metadata.ts';

const serving = (body: string, asked: string[] = []) =>
  (async (url: string) => {
    asked.push(url);
    return new Response(body, { status: 200 });
  }) as unknown as typeof globalThis.fetch;
const config = (fetch: typeof globalThis.fetch, addresses: readonly string[] = ['93.184.216.34']) => ({ fetch, timeoutMs: 1_000, maxBytes: 10_000, resolve: async () => addresses });

test('★ a private, loopback or link-local address is never fetched', async () => {
  for (const addr of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    const asked: string[] = [];
    const read = await fetchDeclaredMetadata('https://meta.example.com/a.json', config(serving('{}', asked), [addr]));
    assert.equal(read.kind, 'refused', addr);
    assert.deepEqual(asked, []);
  }
  assert.equal(isPublicAddress('8.8.8.8'), true);
  assert.equal(isPublicAddress('2606:4700::1111'), true);
});

test('★ only https to a dotted public name: no IP literal, no local name, no credentials, no odd port', () => {
  assert.equal(fetchableUrl('http://meta.example.com/a'), null);
  assert.equal(fetchableUrl('https://127.0.0.1/a'), null);
  assert.equal(fetchableUrl('https://[::1]/a'), null);
  assert.equal(fetchableUrl('https://localhost/a'), null);
  assert.equal(fetchableUrl('https://runner.railway.internal/a'), null);
  assert.equal(fetchableUrl('https://user:pw@meta.example.com/a'), null);
  assert.equal(fetchableUrl('https://meta.example.com:8080/a'), null);
  assert.notEqual(fetchableUrl('https://metadata.j7tracker.io/abc'), null);
});

test('a public document is read: links kept, the https picture kept as an address', async () => {
  const doc = { name: 'Scientists reveal the Hi', symbol: 'Irlcat', image: 'https://cdn.example.com/a.webp', twitter: 'https://x.com/u/status/2109962904929816927', telegram: '', website: 'javascript:alert(1)' };
  const read = await fetchDeclaredMetadata('https://ipfs2.example.live/ipfs/notacid', config(serving(JSON.stringify(doc))));
  assert.equal(read.kind, 'read');
  if (read.kind !== 'read') return;
  assert.equal(read.metadata.ticker, 'Irlcat');
  assert.equal(read.metadata.imageUri, 'https://cdn.example.com/a.webp');
  assert.equal(read.metadata.links.social, 'https://x.com/u/status/2109962904929816927');
  assert.equal(read.metadata.links.website, null, 'a link that is not https is not kept');
});

test('a document over the size cap is refused as a shape error, not stored', async () => {
  await assert.rejects(fetchDeclaredMetadata('https://meta.example.com/a', { ...config(serving('x'.repeat(20_000))), maxBytes: 100 }));
});
