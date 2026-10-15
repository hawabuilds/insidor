/**
 * The text source's short links: only its own host is asked, the redirect is read and never
 * followed, and an answer that is no redirect leads nowhere (null), never to an error page.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expandShortLink, isShortLink } from './short-link.ts';

test('only the short-link host is asked; any other link comes back unasked', async () => {
  let asked = 0;
  const fetch = (async () => {
    asked += 1;
    return new Response(null, { status: 301, headers: { location: 'https://video.example/@a/video/1' } });
  }) as unknown as typeof globalThis.fetch;
  assert.equal(isShortLink('https://t.co/abc'), true);
  assert.equal(await expandShortLink('https://example.com/x', fetch), 'https://example.com/x');
  assert.equal(asked, 0);
  assert.equal(await expandShortLink('https://t.co/abc', fetch), 'https://video.example/@a/video/1');
  assert.equal(asked, 1);
});

test('no redirect: it leads nowhere', async () => {
  const fetch = (async () => new Response('ok', { status: 200 })) as unknown as typeof globalThis.fetch;
  assert.equal(await expandShortLink('https://t.co/abc', fetch), null);
});
