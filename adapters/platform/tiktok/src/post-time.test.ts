/** A post's time from its id: the top 32 bits are seconds; anything implausible is null. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { postTimeFromId } from './post-time.ts';

test('★ an id carries the second the post was made', () => {
  const at = postTimeFromId('7658657103057308942');
  assert.ok(at !== null);
  assert.equal(new Date(at).getUTCFullYear(), 2026);
});

test('an id too small to be one of these has no time rather than a wrong one', () => {
  assert.equal(postTimeFromId('123'), null);
  assert.equal(postTimeFromId('x'), null);
});

test('a pasted link is a post with its id, an account, or not ours (a share link needs a request)', async () => {
  const { parseLink } = await import('./post-time.ts');
  assert.deepEqual(parseLink('https://www.tiktok.com/@cazy.chan/video/7658657103057308942'), { kind: 'post', sourceItemId: '7658657103057308942', handle: 'cazy.chan' });
  assert.deepEqual(parseLink('https://www.tiktok.com/@cazy.chan'), { kind: 'account' });
  assert.equal(parseLink('https://vm.tiktok.com/ZN8eU5Cqw/'), null);
});
