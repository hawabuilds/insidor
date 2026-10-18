/** The bytes of a reply (compress.ts): which encoding a caller gets, and that each decodes to the reply. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

import { encodingFor, prepare } from './compress.ts';

test('the encoding follows Accept-Encoding: brotli first, then gzip, and q=0 refuses', () => {
  assert.equal(encodingFor('gzip, deflate, br'), 'br');
  assert.equal(encodingFor('gzip'), 'gzip');
  assert.equal(encodingFor('br;q=0, gzip'), 'gzip');
  assert.equal(encodingFor('identity'), null);
  assert.equal(encodingFor(undefined), null);
});

test('a reply over a kilobyte is compressed both ways and decodes to the same bytes; a small one is not', async () => {
  const big = JSON.stringify({ rows: Array.from({ length: 200 }, (_, i) => ({ i, title: 'a narrative' })) });
  const p = await prepare({ status: 200, body: big });
  assert.equal(brotliDecompressSync(p.br ?? Buffer.alloc(0)).toString(), big);
  assert.equal(gunzipSync(p.gzip ?? Buffer.alloc(0)).toString(), big);
  assert.ok((p.br?.length ?? Infinity) < big.length / 4);
  const small = await prepare({ status: 200, body: '{"tick":4}' });
  assert.equal(small.br, null);
  assert.equal(small.gzip, null);
  assert.equal((await prepare({ status: 404, body: '{"error":"not found"}' })).etag, null, 'only a 200 carries an ETag');
});
