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
