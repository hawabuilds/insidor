/**
 * The logo copy: a picture is known by its first bytes, never by what its host claimed; anything
 * that is not one of the four is refused before a byte is stored.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { coinLogoStore, LogoRefused, sniffPicture } from './coin-logo.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>');

test('★ a picture is what its bytes say, and an SVG is not one', () => {
  assert.equal(sniffPicture(PNG), 'image/png');
  assert.equal(sniffPicture(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffPicture(SVG), null);
});

const store = (body: Uint8Array, seen: string[] = []) =>
  coinLogoStore({
    url: 'https://storage.test/',
    serviceKey: 'k',
    timeoutMs: 1_000,
    maxBytes: 64,
    fetch: (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(init?.method === 'POST' ? '{}' : body, { status: 200 });
    }) as typeof globalThis.fetch,
  });

test('a picture over the cap, or one that is not a picture, is refused', async () => {
  await assert.rejects(store(new Uint8Array(100).fill(0x89)).download('https://host/p'), LogoRefused);
  await assert.rejects(store(SVG).download('https://host/p'), LogoRefused);
});

test('★ stored at coin-logos/<address>, the path the app builds', async () => {
  const seen: string[] = [];
  const s = store(PNG, seen);
  const picture = await s.download('https://host/p');
  await s.put('So1aNaCoinMint1111111111111111111111111pump'.slice(0, 44), picture);
  assert.ok(seen.some((x) => x.startsWith('POST https://storage.test/storage/v1/object/launch-metadata/coin-logos/')));
  await assert.rejects(s.put('../../etc', picture), LogoRefused);
});
