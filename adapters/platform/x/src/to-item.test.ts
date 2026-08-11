/**
 * These assert the two things a reviewer cannot check by reading: that reach
 * carries its quantized fidelity, and that a rebroadcast is not filed as a
 * reproduction. The second is the product's central signal, inverted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEGRADED, PLAIN, QUOTE, REBROADCAST } from './__fixtures__/posts.ts';
import { toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

test('reach is declared quantized, so a sub-step change can be censored downstream', () => {
  const item = toItem(PLAIN, AT);
  assert.deepEqual(item.counters.reach?.fidelity, { kind: 'quantized', significantDigits: 3 });
  assert.equal(item.counters.reach?.value, 1_240_000);
  assert.deepEqual(item.counters.conversation?.fidelity, { kind: 'exact' });
});

test('a quote is a reproduction and a retweet is a rebroadcast — never the reverse', () => {
  const q = toItem(QUOTE, AT);
  assert.equal(q.reproductionOf, 'x:1823456789012345678');
  assert.equal(q.rebroadcastOf, null);

  const r = toItem(REBROADCAST, AT);
  assert.equal(r.rebroadcastOf, 'x:1823456789012345678');
  assert.equal(r.reproductionOf, null);
});

test('the read instant is injected, never read from a clock', () => {
  const a = toItem(PLAIN, AT);
  const b = toItem(PLAIN, AT + 60_000);
  assert.equal(a.firstSeenAt, AT);
  assert.equal(b.firstSeenAt, AT + 60_000);
  assert.equal(a.counters.approval?.observedAt, AT);
  assert.deepEqual(toItem(PLAIN, AT), a, 'translation is deterministic');
});

test('an unreadable counter is null, not zero', () => {
  const item = toItem(DEGRADED, AT);
  assert.equal(item.counters.reach?.value, null);
  assert.equal(item.counters.approval?.value, null);
  assert.equal(item.postedAt, null, 'an unparseable date is null, never a guess');
});

test('entity spans are unprefixed so they can join across sources', () => {
  const item = toItem(PLAIN, AT);
  const spans = item.fingerprints.filter((f) => f.kind === 'entitySpan').map((f) => f.key);
  assert.deepEqual(spans, ['cashtag:CHILL', 'hashtag:chillguy']);
});

test('this source has no reusable format object, and says so with an empty list', () => {
  assert.deepEqual(toItem(PLAIN, AT).formatIds, []);
});

test('the raw payload is referenced, never inlined', () => {
  const item = toItem(PLAIN, AT);
  assert.equal(item.rawRef, 'x/1823456789012345678.json');
});
