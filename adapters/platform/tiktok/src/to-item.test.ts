/**
 * The first test in this file is the regression test for the defect that
 * motivated the rebuild. It should be the last one anybody ever deletes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DEGRADED, STITCH, WITH_SOUND } from './__fixtures__/posts.ts';
import { CAPABILITIES } from './capabilities.ts';
import { toItem } from './to-item.ts';

const AT = 1_800_000_000_000;

test('no item from this source carries a reproduction counter, in any form', () => {
  for (const raw of [WITH_SOUND, STITCH, DEGRADED]) {
    const item = toItem(raw, AT);
    assert.equal(
      'reproduction' in item.counters,
      false,
      'the key must be absent — not null, not zero, not a counter with a null value',
    );
  }
  assert.deepEqual(CAPABILITIES.absent, ['reproduction']);
  assert.equal(CAPABILITIES.counters.includes('reproduction'), false);
});

test('a share is a rebroadcast and never fills the reproduction gap', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.equal(item.counters.rebroadcast?.value, 9_021);
  assert.equal(item.counters.retention?.value, 41_882);
});

test('a stitch is a reproduction pointer, and rebroadcastOf stays null', () => {
  const item = toItem(STITCH, AT);
  assert.equal(item.reproductionOf, 'tiktok:7391234567890123456');
  assert.equal(item.rebroadcastOf, null);
});

test('play and approval are quantized; comment, share and save are exact', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.deepEqual(item.counters.reach?.fidelity, { kind: 'quantized', significantDigits: 4 });
  assert.deepEqual(item.counters.approval?.fidelity, { kind: 'quantized', significantDigits: 4 });
  assert.deepEqual(item.counters.conversation?.fidelity, { kind: 'exact' });
});

test('a shared sound becomes a prefixed format id and a free carrier', () => {
  const item = toItem(WITH_SOUND, AT);
  assert.deepEqual(item.formatIds, ['tiktok:sound:7380000000000000001', 'tiktok:effect:1234567']);
  const carriers = item.fingerprints.filter((f) => f.kind === 'formatId').map((f) => f.key);
  assert.deepEqual(carriers, ['tiktok:sound:7380000000000000001', 'tiktok:effect:1234567']);
});

test('the read instant is injected and translation is deterministic', () => {
  assert.equal(toItem(WITH_SOUND, AT).firstSeenAt, AT);
  assert.equal(toItem(WITH_SOUND, AT + 1).firstSeenAt, AT + 1);
  assert.deepEqual(toItem(WITH_SOUND, AT), toItem(WITH_SOUND, AT));
});

test('a payload with no stats object yields null counters, not zeros', () => {
  const item = toItem(DEGRADED, AT);
  assert.equal(item.counters.reach?.value, null);
  assert.equal(item.postedAt, null);
  assert.equal(item.authorKey, 'tiktok:unknown');
});
