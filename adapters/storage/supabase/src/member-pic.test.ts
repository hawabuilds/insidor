/**
 * A member's photo: written only when its bytes are a PNG, JPEG or WebP under the cap, under a name
 * the caller cannot steer, at the path its public link names.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { memberPicStore, PhotoRefused, photoType } from './member-pic.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = new TextEncoder().encode('GIF89a....');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
const FILE = '0123456789abcdef0123456789abcdef';

const store = (seen: string[] = []) =>
  memberPicStore({
    url: 'https://storage.test/',
    serviceKey: 'k',
    timeoutMs: 1_000,
    maxBytes: 16,
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url} ${(init?.headers as Record<string, string>)['content-type']}`);
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch,
  });

test('★ only a PNG, JPEG or WebP photo is a photo; a GIF and an SVG are not', () => {
  assert.equal(photoType(JPEG), 'image/jpeg');
  assert.equal(photoType(GIF), null);
  assert.equal(photoType(SVG), null);
});

test('★ written at member-pics/<file> with its real type, and read from the public link', async () => {
  const seen: string[] = [];
  const s = store(seen);
  await s.put(FILE, JPEG);
  assert.deepEqual(seen, [`POST https://storage.test/storage/v1/object/launch-metadata/member-pics/${FILE} image/jpeg`]);
  assert.equal(s.urlOf(FILE), `https://storage.test/storage/v1/object/public/launch-metadata/member-pics/${FILE}`);
});

test('a name it did not make, a photo over the cap, or bytes that are not a photo are refused before anything is sent', async () => {
  const seen: string[] = [];
  const s = store(seen);
  await assert.rejects(s.put('../coin-logos/x', JPEG), PhotoRefused);
  await assert.rejects(s.put(FILE, new Uint8Array(17).fill(0xff)), PhotoRefused);
  await assert.rejects(s.put(FILE, GIF), PhotoRefused);
  await assert.rejects(s.put(FILE, new Uint8Array()), PhotoRefused);
  assert.deepEqual(seen, []);
});
