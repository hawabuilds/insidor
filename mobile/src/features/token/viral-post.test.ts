/**
 * The token page's viral post: the most-viewed post naming the coin, and "proven" only when that
 * post's evidence says the coin links it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { AboutPost } from '../../shared/api/index.ts';
import { viralPost } from './viral-post.ts';

const LAUNCH = 100;
const p = (postId: string, views: number | null, linksPost: boolean | null, at = 1): AboutPost => ({
  postId, own: false, sourceLabel: 'X', authorLabel: '@a', permalink: null, excerpt: '', thumbUrl: null,
  postedAt: { known: true, at: at as never },
  foundAt: null,
  views: views === null ? { known: false, pending: 'not_reported' } : { known: true, amount: views },
  story: null,
  evidence: { linksPost, samePicture: null, launchedAfterMs: null },
});

test('★ the most-viewed post leads; a post with no views read never beats one we can count', () => {
  assert.equal(viralPost([p('a', 12_000, null), p('b', 751_000, null), p('c', null, true)], { launchedAt: LAUNCH })?.post.postId, 'b');
  assert.equal(viralPost([p('c', null, null), p('a', 5, null)], { launchedAt: LAUNCH })?.post.postId, 'a');
  assert.equal(viralPost([p('c', null, null)], { launchedAt: LAUNCH })?.post.postId, 'c', 'the only post naming the coin is still shown');
});

test('★ proven only when the post\'s evidence says the coin links it; unknown is not proven', () => {
  assert.equal(viralPost([p('a', 1, true)])?.proven, true);
  assert.equal(viralPost([p('a', 1, null)], { launchedAt: LAUNCH })?.proven, false);
  assert.equal(viralPost([p('a', 1, false)], { launchedAt: LAUNCH })?.proven, false);
});

test('no post naming the coin, no card', () => {
  assert.equal(viralPost([]), null);
});

test('★ the post the coin links comes first, though another naming post has more views (2026-11-04)', () => {
  const post = (id: string, views: number, links: boolean) => ({ postId: id, postedAt: { known: true, at: 1 }, views: { known: true, amount: views }, evidence: { linksPost: links, launchedAfterMs: null } }) as never;
  assert.equal(viralPost([post('big', 9_000_000, false), post('linked', 400_000, true)])?.post.postId, 'linked');
  assert.equal(viralPost([post('big', 9_000_000, false), post('small', 10, false)], { launchedAt: LAUNCH })?.post.postId, 'big', 'no linked post: the most viewed');
});

test('★ never a promotion: with no linked post, only a post from before the launch is shown (2026-11-04)', () => {
  assert.equal(viralPost([p('og', 50_000, null, 10), p('promo', 9_000_000, null, 500)], { launchedAt: LAUNCH })?.post.postId, 'og', 'the bigger post came after the launch');
  assert.equal(viralPost([p('promo', 9_000_000, null, 500)], { launchedAt: LAUNCH }), null, 'only posts after the launch: none shown');
  assert.equal(viralPost([p('og', 5, null, 10)], { launchedAt: null }), null, 'launch time unknown: we cannot tell which came first');
  const after = { ...p('x', 9, null, 10), evidence: { linksPost: null, samePicture: null, launchedAfterMs: -60_000 } };
  assert.equal(viralPost([after], { launchedAt: LAUNCH }), null, 'the evidence says it was posted after the launch');
  assert.equal(viralPost([p('linked', 1, true, 500)], { launchedAt: LAUNCH })?.post.postId, 'linked', 'the linked post is shown whenever it was posted');
  assert.equal(viralPost([p('og', 50_000, null, 10), p('promo', 9_000_000, null, 500)])?.post.postId, 'promo', 'not shown (the narrative card\'s choice): the ranking alone, as before');
});
