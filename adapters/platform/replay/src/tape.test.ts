/**
 * A replay is only worth having if it fails loudly. Every test here is about
 * something the tape REFUSES to do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { Budget } from '@insidor/contracts/ports/meter.ts';
import { VendorShapeError } from '@insidor/vendor-kit';

import { RAW_TAPE, RAW_TAPE_WITH_ABSENT_COUNTER } from './__fixtures__/tape.ts';
import { replayPlatform } from './index.ts';
import { decodeTape, TapeMiss } from './tape.ts';

const AT = 1_800_000_000_000;
const now = (): number => AT;
const BUDGET: Budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: AT + 60_000 };
const tape = decodeTape(RAW_TAPE, AT);

test('a tape carrying a counter its own capabilities call absent is rejected at load', () => {
  assert.throws(() => decodeTape(RAW_TAPE_WITH_ABSENT_COUNTER, AT), VendorShapeError);
});

test('an unrecorded id throws rather than returning nothing', async () => {
  const adapter = replayPlatform(tape, { now });
  await assert.rejects(adapter.observe(['never-recorded'], BUDGET), TapeMiss);
});

test('successive observes return successive readings, then stop', async () => {
  const adapter = replayPlatform(tape, { now });
  const id = '7391234567890123456';

  const first = await adapter.observe([id], BUDGET);
  assert.equal(first.value.get(id)?.reach?.observedAt, 1_785_912_700_000);

  const second = await adapter.observe([id], BUDGET);
  assert.equal(second.value.get(id)?.reach?.observedAt, 1_785_913_300_000);

  const third = await adapter.observe([id], BUDGET);
  assert.equal(third.value.has(id), false, 'exhausted readings are omitted, never zero-filled');

  adapter.rewind();
  const again = await adapter.observe([id], BUDGET);
  assert.equal(again.value.get(id)?.reach?.observedAt, 1_785_912_700_000);
});

test('a replay costs nothing and says so', async () => {
  const adapter = replayPlatform(tape, { now });
  const read = await adapter.observe(['7391234567890123456'], BUDGET);
  assert.equal(read.spend.usd, 0);
  assert.equal(read.spend.units, 0);
});

test('capabilities come off the recording, not from this package', () => {
  const adapter = replayPlatform(tape, { now });
  assert.deepEqual(adapter.capabilities.absent, ['reproduction']);
  assert.equal(String(adapter.id), 'tiktok');
});

test('paging is honoured but selection is not — a tape is not re-filtered', async () => {
  const adapter = replayPlatform(tape, { now });
  const page = await adapter.discover(
    { mode: 'hashtag', term: 'anything-at-all', sinceMs: null, untilMs: null, limit: 10, cursor: null },
    BUDGET,
  );
  assert.equal(page.value.items.length, tape.items.length);
  assert.equal(page.value.hasMore, false);
  assert.equal(page.value.cursor, null);
});

test('the recorded reading pair is the censoring case: the level did not move', () => {
  const readings = tape.readings.map((r) => r.counters.reach?.value);
  assert.deepEqual(readings, [1_240_000, 1_240_000]);
});

test('decoding is deterministic and honours the injected read instant', () => {
  const [item] = tape.items;
  assert.ok(item);
  assert.equal(item.firstSeenAt, AT);
  assert.deepEqual(decodeTape(RAW_TAPE, AT), tape);
});

test('a malformed fidelity is a shape error, not a default', () => {
  const broken = {
    ...(RAW_TAPE as Record<string, unknown>),
    items: [
      {
        ...((RAW_TAPE as { items: readonly Record<string, unknown>[] }).items[0] as Record<string, unknown>),
        counters: { reach: { value: 1, fidelity: { kind: 'approximate' }, observedAt: 1 } },
      },
    ],
  };
  assert.throws(() => decodeTape(broken, AT), VendorShapeError);
});
