/** R2: all four settings or none; every store writes the same path there, signed, and reads it from the public base. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { coinLogoStore, pictureUrl } from './coin-logo.ts';
import { postPicStore } from './post-pic.ts';
import { readR2Config } from './r2.ts';

const HEX32 = 'a'.repeat(32);
const ENV = { R2_ACCOUNT_ID: HEX32, R2_ACCESS_KEY_ID: 'b'.repeat(32), R2_SECRET_ACCESS_KEY: 'c'.repeat(64), R2_PUBLIC_BASE: 'https://pub-x.r2.dev/' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);

test('★ placeholders, a missing setting or a bad address leave R2 off, so the stores keep writing to Supabase', () => {
  assert.notEqual(readR2Config(ENV), null);
  assert.equal(readR2Config({ ...ENV, R2_ACCOUNT_ID: '...' }), null);
  assert.equal(readR2Config({ ...ENV, R2_SECRET_ACCESS_KEY: 'paste-secret' }), null);
  assert.equal(readR2Config({ ...ENV, R2_PUBLIC_BASE: undefined }), null);
  assert.equal(readR2Config({ ...ENV, R2_PUBLIC_BASE: 'http://pub-x.r2.dev' }), null);
  assert.equal(readR2Config(ENV)?.bucket, 'insidor-pics');
  assert.equal(readR2Config(ENV)?.publicBase, 'https://pub-x.r2.dev');
});

test('★ with R2 set, a coin logo is one signed PUT to the bucket at its usual path, and is read from the public base', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('', { status: 200 });
  }) as typeof globalThis.fetch;
  const r2 = readR2Config(ENV);
  const store = coinLogoStore({ url: 'https://db.invalid', serviceKey: 'k', fetch, timeoutMs: 1_000, maxBytes: 1_000, r2 });
  const address = 'So11111111111111111111111111111111111111112';
  await store.put(address, { bytes: PNG, type: 'image/png' }, 'small');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `https://${HEX32}.r2.cloudflarestorage.com/insidor-pics/coin-logos/64/${address}`);
  assert.equal(calls[0]?.init.method, 'PUT');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.match(headers['authorization'] ?? '', /^AWS4-HMAC-SHA256 Credential=b{32}\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(headers['cache-control'], 'max-age=604800');
  assert.equal(store.ownCopyUrl(address), `https://pub-x.r2.dev/coin-logos/${address}`);
  await postPicStore({ url: 'https://db.invalid', serviceKey: 'k', fetch, timeoutMs: 1_000, maxBytes: 1_000, r2 }).put('f'.repeat(32), { bytes: PNG, type: 'image/png' }, 'sheet');
  assert.equal(calls[1]?.url, `https://${HEX32}.r2.cloudflarestorage.com/insidor-pics/post-pics/sheet/${'f'.repeat(32)}`);
});

test('without R2 the address is Supabase\'s, as before', () => {
  assert.equal(pictureUrl({ url: 'https://db.invalid/', r2: null }, 'coin-logos/x'), 'https://db.invalid/storage/v1/object/public/launch-metadata/coin-logos/x');
});
