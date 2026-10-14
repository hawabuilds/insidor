/**
 * The poster-picture copy: stored only under a name the copier made, in the folder the app builds,
 * and only a real picture — an HEIC file (what the short-video source's first links serve) is not one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PictureRefused, posterPicStore } from './poster-pic.ts';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const HEIC = Uint8Array.from([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

const store = (body: Uint8Array, seen: string[] = []) =>
  posterPicStore({
    url: 'https://storage.test/',
    serviceKey: 'k',
    timeoutMs: 1_000,
    maxBytes: 64,
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(init?.method === 'POST' ? '{}' : body, { status: 200 });
    }) as typeof globalThis.fetch,
  });

test('★ stored at author-pics/<file>, the path the app builds', async () => {
  const seen: string[] = [];
  const s = store(JPEG, seen);
  await s.put('0123456789abcdef0123456789abcdef', await s.download('https://host/p'));
  assert.equal(seen[1], 'POST https://storage.test/storage/v1/object/launch-metadata/author-pics/0123456789abcdef0123456789abcdef');
});

test('an HEIC file is refused, and so is any name the copier did not make', async () => {
  await assert.rejects(store(HEIC).download('https://host/p'), PictureRefused);
  const s = store(JPEG);
  await assert.rejects(s.put('../coin-logos/x', { bytes: JPEG, type: 'image/jpeg' }), PictureRefused);
});
