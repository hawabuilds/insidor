import test from 'node:test';
import assert from 'node:assert/strict';

import { reloadsInPlace } from './new-version.ts';

test('a browser tab takes a newer build by reloading in place', () => {
  assert.equal(reloadsInPlace(false), true);
});

test('the home-screen app never reloads in place: the reload brings back the strip under the feed', () => {
  assert.equal(reloadsInPlace(true), false);
});
