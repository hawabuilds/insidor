/**
 * What the story page says about itself, and when it says nothing.
 *
 * ★ THE CASE THIS FILE EXISTS FOR is the one the board's notice did not cover: a story
 * page is reachable by a shared link, with no board frame anywhere near it. Every
 * assertion here is about the page answering for itself.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { storyNotice } from './story-provenance.ts';

test('a discovered story says nothing about how it got here', () => {
  assert.equal(storyNotice({ kind: 'observed' }), null);
});

test('★ a seeded story says so, on its own page, without a board in sight', () => {
  const notice = storyNotice({ kind: 'seeded', connectSourceLabel: 'Reddit' });
  assert.ok(notice !== null, 'a page of invented posts and view counts must say so');
  assert.match(notice.headline, /seeded demonstration data/);
  assert.match(notice.detail, /db:seed/);
  /* Named specifically, because the page shows accounts and post excerpts that look
     exactly like observations and are not. */
  assert.match(notice.detail, /not the posts, not the accounts, not the view counts/);
  assert.match(notice.detail, /Reddit is free/);
});

test('★ a page that did not state its provenance is announced, never assumed real', () => {
  const notice = storyNotice({ kind: 'unstated' });
  assert.ok(notice !== null, 'not knowing must be said out loud');
  assert.match(notice.detail, /unverified/);
});
