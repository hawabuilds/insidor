/**
 * Expanding a share link: one redirect read, the tracking query dropped, and anything that
 * is not a video refused. The fetch is a plain function; no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { expandShortLink, isShortLink } from './short-link.ts';

const redirectingTo = (location: string, status = 301) =>
  (async () => new Response(null, { status, headers: { location } })) as unknown as typeof globalThis.fetch;

test('★ a share link becomes the video it names, without the tracking query', async () => {
  const full = await expandShortLink('https://vm.tiktok.com/ZN8eU5Cqw/', redirectingTo('https://www.tiktok.com/@cazy.chan/video/7658657103057308942?_r=1&_t=ZN-98'));
  assert.equal(full, 'https://www.tiktok.com/@cazy.chan/video/7658657103057308942');
});

test('a photo post is a post too', async () => {
  const full = await expandShortLink('https://vm.tiktok.com/x/', redirectingTo('https://www.tiktok.com/@meimeiwarrior/photo/7565704323678702850?_r=1'));
  assert.equal(full, 'https://www.tiktok.com/@meimeiwarrior/photo/7565704323678702850');
});

test('a full link is returned as it is, and nothing is asked', async () => {
  let asked = false;
  const fetch = (async () => {
    asked = true;
    return new Response(null);
  }) as unknown as typeof globalThis.fetch;
  assert.equal(await expandShortLink('https://www.tiktok.com/@a/video/1', fetch), 'https://www.tiktok.com/@a/video/1');
  assert.equal(asked, false);
  assert.equal(isShortLink(' https://vt.tiktok.com/x/ '), true);
});

test('★ a redirect to anything but a post is refused, never stored as a post', async () => {
  await assert.rejects(expandShortLink('https://vm.tiktok.com/x/', redirectingTo('https://www.tiktok.com/login')));
  await assert.rejects(expandShortLink('https://vm.tiktok.com/x/', redirectingTo('https://www.tiktok.com/@a/video/1', 200)));
});
