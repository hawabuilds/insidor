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
