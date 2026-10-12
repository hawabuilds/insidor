/** A post's time from its id: exact for a time-ordered id, null for anything else. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { postTimeFromId } from './post-time.ts';

test('★ an id carries the moment the post was made', () => {
  assert.equal(new Date(postTimeFromId('2079311468231545077') ?? 0).toISOString(), '2026-07-20T21:04:20.422Z');
});

test('an id that is not time-ordered, or not an id, has no time rather than a wrong one', () => {
  assert.equal(postTimeFromId('12345'), null);
  assert.equal(postTimeFromId('abc'), null);
});

test('★ a pasted link is a post with its id, an account, or not ours', async () => {
  const { parseLink } = await import('./post-time.ts');
  assert.deepEqual(parseLink('https://x.com/pusholder/status/2079311468231545077?s=46'), { kind: 'post', sourceItemId: '2079311468231545077' });
  assert.deepEqual(parseLink('https://twitter.com/i/web/status/123'), { kind: 'post', sourceItemId: '123' });
  assert.deepEqual(parseLink('https://x.com/thedroponsol'), { kind: 'account' });
  assert.deepEqual(parseLink('https://x.com/i/communities/1800000000000000000'), { kind: 'account' });
  assert.equal(parseLink('https://t.me/somegroup'), null);
});
