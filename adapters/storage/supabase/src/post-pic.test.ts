/**
 * The post-picture copies: the lists' and the sheet's at the two paths the app builds, only under a
 * name the copier made, and only bytes that are the picture they say they are.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LogoRefused } from './coin-logo.ts';
import { postPicStore } from './post-pic.ts';

const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const FILE = '0123456789abcdef0123456789abcdef';

const store = (seen: string[] = []) =>
  postPicStore({
    url: 'https://storage.test/',
    serviceKey: 'k',
    timeoutMs: 1_000,
    maxBytes: 64,
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response('{}', { status: 200 });
    }) as typeof globalThis.fetch,
  });

test('★ the lists\' copy at post-pics/<file>, the sheet\'s at post-pics/sheet/<file>', async () => {
  const seen: string[] = [];
  const s = store(seen);
  await s.put(FILE, { bytes: WEBP, type: 'image/webp' }, 'card');
  await s.put(FILE, { bytes: WEBP, type: 'image/webp' }, 'sheet');
  assert.deepEqual(seen, [
    `POST https://storage.test/storage/v1/object/launch-metadata/post-pics/${FILE}`,
    `POST https://storage.test/storage/v1/object/launch-metadata/post-pics/sheet/${FILE}`,
  ]);
});

test('a name the copier did not make, or bytes that are not the type claimed, are refused and nothing is written', async () => {
  const seen: string[] = [];
  const s = store(seen);
  await assert.rejects(s.put('../coin-logos/x', { bytes: WEBP, type: 'image/webp' }, 'card'), LogoRefused);
  await assert.rejects(s.put(FILE, { bytes: Uint8Array.from([0x3c, 0x73, 0x76, 0x67]), type: 'image/webp' }, 'card'), LogoRefused);
  assert.deepEqual(seen, []);
});
