/**
 * Which reads Vercel's edge may keep (edge-cache.ts). The table below IS the classification: a
 * route moving from one column to the other has to be a deliberate edit here, because a personal
 * reply kept at the edge is served to the next person who asks for the same URL.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BROWSER_REVALIDATE, EDGE_HEADER, edgeHeaders, edgeLifeFor } from './edge-cache.ts';
import { ruleFor } from './prepared.ts';

const ANYONE = { authorization: false, cookie: false };
const OK = Buffer.from('{"tick":1}');

/** Same for everyone who asks: the edge keeps them, for these many seconds. */
const PUBLIC: readonly (readonly [string, number])[] = [
  ['/board/default', 2],
  ['/narratives/default', 2],
  ['/narratives/default/all?sort=new&offset=0', 2],
  ['/narratives/default/all?sort=views&offset=20&on=x', 2],
  ['/story/st_1', 2],
  ['/rising/fyp/tick', 2],
  ['/rising/fyp/sorted?by=trending&window=day', 2],
  ['/rising/fyp/older?before=1792275060000:x%3A1', 2],
  ['/launches/default', 2],
  ['/pairs/default', 2],
  ['/sources/default', 2],
  ['/post/x%3A2111844404654940507/sheet', 5],
  ['/story/st_1/sheet', 5],
  ['/story/st_1/sheet?posts=x%3A1,x%3A2', 5],
  ['/coin/solana%3AMint/market?tf=1m', 4],
  ['/coin/solana%3AMint', 10],
  ['/coin/solana%3AMint/about', 30],
];

/** Personal, live, or frame-tied in a way the edge would break: never edge-kept. */
const PRIVATE: readonly string[] = [
  '/rising/fyp', // reloaded on the live line's "changed"; an edge copy is the previous frame
  '/rising/launch',
  '/wallet/9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin?range=day',
  '/wallet/9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin/history?range=day',
  '/search?q=pepe',
  '/ticker/PEPE',
  '/ticker/PEPE/coins',
  '/post/x%3A1/coins',
  '/post/x%3A1/names',
  '/stream/rising/fyp',
  '/stream/board/default',
  '/health',
  '/',
  '/board',
  '/coin/%zz',
  `/board/${'a'.repeat(400)}`,
];

test('every public route is edge-kept for its lifetime, query and all', () => {
  for (const [url, fresh] of PUBLIC) {
    const life = edgeLifeFor(url);
    assert.notEqual(life, null, url);
    assert.equal(life?.fresh, fresh, url);
    assert.ok((life?.stale ?? 0) <= 60, `${url}: a stale copy is never more than a minute behind`);
  }
});

test('no personal, live or For You feed route is edge-kept', () => {
  for (const url of PRIVATE) assert.equal(edgeLifeFor(url), null, url);
});

test('a route the edge keeps is one prepared.ts also shares between callers, or one with no caller in it', () => {
  /* ruleFor's list is "same for everyone"; the edge list must not reach past it except for the
     uncached history and desktop routes, which take no caller either (routes.ts passes `client`
     only to search, ticker, post coins and names, and wallet). */
  const shared = new Set(['older', 'launches', 'pairs', 'sources']);
  for (const [url] of PUBLIC) {
    const segments = url.split('?')[0]!.split('/').filter((x) => x !== '');
    if (segments.some((s) => shared.has(s))) continue;
    assert.notEqual(ruleFor(url), null, `${url} is edge-kept but prepared.ts does not treat it as shared`);
  }
});

test('the headers tell the edge, and tell the browser only to ask before each use', () => {
  const h = edgeHeaders('GET', '/board/default', 200, OK, ANYONE);
  assert.deepEqual(h, { 'cache-control': BROWSER_REVALIDATE, [EDGE_HEADER]: 'max-age=2, stale-while-revalidate=8' });
  /* Vercel will not keep a reply whose cache-control says private or no-cache. */
  assert.doesNotMatch(h?.['cache-control'] ?? '', /private|no-cache|no-store|s-maxage/);
  assert.equal(edgeHeaders('HEAD', '/coin/solana%3AMint/about', 200, OK, ANYONE)?.[EDGE_HEADER], 'max-age=30, stale-while-revalidate=60');
});

test('anything but a 200 to a GET from a caller with no token or cookie keeps the private headers', () => {
  assert.equal(edgeHeaders('GET', '/board/default', 404, OK, ANYONE), null);
  assert.equal(edgeHeaders('GET', '/board/default', 500, OK, ANYONE), null);
  assert.equal(edgeHeaders('POST', '/board/default', 200, OK, ANYONE), null);
  assert.equal(edgeHeaders('GET', '/board/default', 200, OK, { authorization: true, cookie: false }), null);
  assert.equal(edgeHeaders('GET', '/board/default', 200, OK, { authorization: false, cookie: true }), null);
});

test('a market reply saying its source is unavailable is not kept at the edge', () => {
  const down = Buffer.from('{"kind":"unavailable","why":"source_down"}');
  assert.equal(edgeHeaders('GET', '/coin/solana%3AMint/market?tf=1m', 200, down, ANYONE), null);
  assert.notEqual(edgeHeaders('GET', '/coin/solana%3AMint/market?tf=1m', 200, Buffer.from('{"kind":"market"}'), ANYONE), null);
});
