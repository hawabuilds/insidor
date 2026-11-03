/**
 * The transport's body cap: 64 KB for every route, except a launch's build, which carries the coin's
 * picture as a data URL (2026-11-03: every launch from a post with a normal-sized picture was refused
 * with "The launch could not be prepared just now." because its body was dropped at 64 KB).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bodyLimitFor } from './server.ts';

test('★ a launch build may carry a picture of a few megabytes; every other route stays at 64 KB', () => {
  assert.ok(bodyLimitFor('/launch/build') >= 1024 * 1024);
  assert.ok(bodyLimitFor('/launch/build?x=1') >= 1024 * 1024);
  assert.ok(bodyLimitFor('/launch/build') < 4.5 * 1024 * 1024, 'under the /api function request limit');
  for (const url of ['/build', '/send', '/launch/preview', '/launch/confirm', '/launch/buildx']) assert.equal(bodyLimitFor(url), 64 * 1024, url);
});
