/**
 * The /api function's cache headers (proxy.js), and that the desktop app's copy is the same file.
 *
 * Exists because the function decides what Vercel's edge may keep on the rollback path, and a
 * mistake there serves one person's reply to the next caller of the same URL. The service's own
 * classification is tested in services/read/src/edge-cache.test.ts; this proves the function
 * passes it through only for read, only for a GET, and never for a request with a token or cookie.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cacheHeaders } from './proxy.js';

const SHARED = 'public, max-age=0, must-revalidate';
const EDGE = 'max-age=2, stale-while-revalidate=8';

/** What proxy.js reads of the service's reply: its status and headers. */
const reply = (headers, status = 200) => ({ status, headers: new Headers(headers) });
const ask = (headers = {}, method = 'GET') => new Request('https://insidor.app/api/proxy?service=read&path=board/default', { method, headers });
const shared = reply({ 'cache-control': SHARED, 'vercel-cdn-cache-control': EDGE, etag: 'W/"a"' });

test('a read reply the service marked shared passes to the edge with its ETag', () => {
  assert.deepEqual(cacheHeaders('read', ask(), shared), { 'cache-control': SHARED, 'vercel-cdn-cache-control': EDGE, etag: 'W/"a"' });
});

test('a token, a cookie, another service or a write keeps it in the browser alone', () => {
  const browser = { 'cache-control': 'private, no-cache', etag: 'W/"a"' };
  assert.deepEqual(cacheHeaders('read', ask({ authorization: 'Bearer x' }), shared), browser);
  assert.deepEqual(cacheHeaders('read', ask({ cookie: 'a=b' }), shared), browser);
  assert.deepEqual(cacheHeaders('social', ask(), shared), browser);
  assert.deepEqual(cacheHeaders('read', ask({}, 'POST'), shared), browser);
});

test('a 304 is never offered to the edge', () => {
  const notModified = reply({ 'cache-control': SHARED, 'vercel-cdn-cache-control': EDGE, etag: 'W/"a"' }, 304);
  assert.equal(cacheHeaders('read', ask(), notModified)['vercel-cdn-cache-control'], undefined);
});

test('private, no-cache passes as before, and anything else is no-store', () => {
  assert.deepEqual(cacheHeaders('read', ask(), reply({ 'cache-control': 'private, no-cache', etag: 'W/"b"' })), { 'cache-control': 'private, no-cache', etag: 'W/"b"' });
  assert.deepEqual(cacheHeaders('read', ask(), reply({ 'cache-control': 'no-store' })), { 'cache-control': 'no-store' });
  assert.deepEqual(cacheHeaders('read', ask(), reply({ 'cache-control': 'public, max-age=600' })), { 'cache-control': 'no-store' });
  assert.deepEqual(cacheHeaders('read', ask(), reply({ 'cache-control': SHARED })), { 'cache-control': 'no-store' }, 'no ETag, no edge header: not kept');
});

test('the desktop app carries the same function', () => {
  const strip = (s) => s.split('\n').filter((l) => !l.includes('keep the two the same')).join('\n');
  const mine = readFileSync(new URL('./proxy.js', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../../app/api/proxy.js', import.meta.url), 'utf8');
  assert.equal(strip(desktop), strip(mine));
});
