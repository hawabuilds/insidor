/**
 * The token page's viral post: the most-viewed post naming the coin, and "proven" only when that
 * post's evidence says the coin links it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AboutPost } from '../../shared/api/index.ts';
import { viralPost } from './viral-post.ts';

const p = (postId: string, views: number | null, linksPost: boolean | null): AboutPost => ({
  postId, own: false, sourceLabel: 'X', authorLabel: '@a', permalink: null, excerpt: '', thumbUrl: null,
  postedAt: { known: true, at: 1 as never },
  views: views === null ? { known: false, pending: 'not_reported' } : { known: true, amount: views },
  story: null,
  evidence: { linksPost, samePicture: null, launchedAfterMs: null },
});

test('★ the most-viewed post leads; a post with no views read never beats one we can count', () => {
  assert.equal(viralPost([p('a', 12_000, null), p('b', 751_000, null), p('c', null, true)])?.post.postId, 'b');
  assert.equal(viralPost([p('c', null, null), p('a', 5, null)])?.post.postId, 'a');
  assert.equal(viralPost([p('c', null, null)])?.post.postId, 'c', 'the only post naming the coin is still shown');
});

test('★ proven only when the post\'s evidence says the coin links it; unknown is not proven', () => {
  assert.equal(viralPost([p('a', 1, true)])?.proven, true);
  assert.equal(viralPost([p('a', 1, null)])?.proven, false);
  assert.equal(viralPost([p('a', 1, false)])?.proven, false);
});

test('no post naming the coin, no card', () => {
  assert.equal(viralPost([]), null);
});
