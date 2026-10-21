/**
 * The kept notifications and the quiet retry (keep.ts): kept per person and per list, never across
 * people; asked again soon, then less often, then once a minute.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { listKeeper, retryDelayMs, tokenSubject } from './keep.ts';

const jwt = (payload: Record<string, unknown>): string => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

test("the slot is the token's subject; anything that is not a token has no slot", () => {
  assert.equal(tokenSubject(jwt({ sub: 'did:privy:abc', exp: 1 })), 'did:privy:abc');
  assert.equal(tokenSubject(jwt({ exp: 1 })), null);
  assert.equal(tokenSubject('not-a-token'), null);
  assert.equal(tokenSubject('a.%%%.b'), null);
  assert.equal(tokenSubject(null), null);
});

test('★ a list is kept per person and per list: another person, or no one signed in, never sees it', () => {
  const k = listKeeper<string>();
  k.set('did:a', 'notifications', 'rows of a');
  assert.equal(k.get('did:a', 'notifications'), 'rows of a');
  assert.equal(k.get('did:b', 'notifications'), null);
  assert.equal(k.get('did:a', 'feed'), null);
  k.set(null, 'notifications', 'rows of nobody');
  assert.equal(k.get(null, 'notifications'), null, 'no person, nothing kept');
});

test('a failed read is asked again after 3 s, 10 s, 30 s, then every minute', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(retryDelayMs), [3_000, 10_000, 30_000, 60_000, 60_000]);
});
