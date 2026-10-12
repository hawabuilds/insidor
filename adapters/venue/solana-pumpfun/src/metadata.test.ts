/**
 * The metadata reader: only a content-addressed link is read, only through our gateway, and
 * what comes back is bounded and cleaned. The fetch is a plain function; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DOCUMENT, DOCUMENT_URI } from './__fixtures__/metadata.ts';
import { contentAddress, fetchMetadata } from './metadata.ts';

const GATEWAY = 'https://gateway.invalid';
const config = (fetch: typeof globalThis.fetch, maxBytes = 10_000) => ({ gateway: GATEWAY, fetch, timeoutMs: 1_000, maxBytes });
const serving = (body: string, asked: string[] = []) =>
  (async (url: string) => {
    asked.push(url);
    return new Response(body, { status: 200 });
  }) as unknown as typeof globalThis.fetch;

test('★ a content-addressed link is read from OUR gateway, never from the host it named', async () => {
  const asked: string[] = [];
  const read = await fetchMetadata(DOCUMENT_URI, config(serving(JSON.stringify(DOCUMENT), asked)));
  assert.deepEqual(asked, [`${GATEWAY}/ipfs/bafkreiexampleexampleexampleexampleexampleexampleexample`]);
  assert.equal(read.kind, 'read');
  if (read.kind !== 'read') return;
  assert.equal(read.metadata.name, 'Big Trout');
  assert.equal(read.metadata.ticker, 'BIGTROUT');
  assert.equal(read.metadata.imageUri, `${GATEWAY}/ipfs/bafkreiaaaabbbbccccddddeeeeffffgggghhhhiiiijjjjkkkkllllmm`, 'the picture too, by content id, on our gateway');
  assert.equal(read.metadata.links.social, 'https://x.com/pusholder/status/2079311468231545077');
  assert.equal(read.metadata.links.chat, null, 'a link that is not https is not kept');
});

test('★ a link that names no content id is not fetched at all', async () => {
  const asked: string[] = [];
  const read = await fetchMetadata('https://brand-new-domain.example/meta.json', config(serving('{}', asked)));
  assert.deepEqual(read, { kind: 'notContentAddressed' });
  assert.deepEqual(asked, []);
});

test('the content id is found in every shape a link carries it', () => {
  const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  assert.equal(contentAddress(`ipfs://${cid}`), cid);
  assert.equal(contentAddress(`https://cf-ipfs.com/ipfs/${cid}?x=1`), cid);
  assert.equal(contentAddress('https://bafkreiexampleexampleexampleexampleexampleexampleexample.ipfs.w3s.link/'), 'bafkreiexampleexampleexampleexampleexampleexampleexample');
  assert.equal(contentAddress('https://ipfs.io/ipfs/not-a-cid'), null);
  assert.equal(contentAddress('file:///etc/passwd'), null);
});

test('★ a document over the size cap stops being read', async () => {
  await assert.rejects(fetchMetadata(DOCUMENT_URI, config(serving('x'.repeat(5_000)), 1_000)), /over 1000 bytes/);
});
