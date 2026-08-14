/**
 * The wall, asserted.
 *
 * Three properties, and each one corresponds to a leak that actually shipped:
 *   - the decoded row has exactly the public field set and nothing else;
 *   - an internal field in the payload is fatal, not ignored;
 *   - an absent number arrives as pending rather than as zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BOARD_ROW_FIELDS } from './wire/fields.ts';
import {
  WireLeakError,
  WireShapeError,
  assertNoInternalVocabulary,
  decodeBoardRow,
  decodeCoinLink,
} from './decode.ts';

const CLEAN_ROW = {
  id: 'st_01',
  title: 'Cat pushing a tiny shopping trolley',
  summary: ['Clipped and re-cut by 40 accounts in six hours.', 'Two coins so far; one is ours.'],
  thumbUrl: 'https://cdn.example/thumb.jpg',
  reach: { v: 1_240_000 },
  spark: { windowMs: 3_600_000, points: [{ atMs: 1, value: 3 }, { atMs: 2, value: null }] },
  momentum: 'rising',
  firstSeenAt: { at: 1_700_000_000_000 },
  coins: { kind: 'none' },
  isNew: true,
};

test('the decoder emits exactly the public field set', () => {
  const row = decodeBoardRow(CLEAN_ROW);
  assert.deepEqual(Object.keys(row).sort(), [...BOARD_ROW_FIELDS].sort());
});

test('an internal field on the payload is fatal, not silently dropped', () => {
  /* This is `live.js:397` as a test: the query asked for the score, so the client had the
     score, so the client rendered it. Here, having it is where it stops. */
  for (const leak of ['score', 'confidence', 'propensity', 'policyHash', 'burst', 'costUsd']) {
    assert.throws(
      () => decodeBoardRow({ ...CLEAN_ROW, [leak]: 0.83 }),
      WireLeakError,
      `${leak} was not caught`,
    );
  }
});

test('an internal field nested inside a sub-object is caught too', () => {
  assert.throws(
    () => decodeBoardRow({ ...CLEAN_ROW, coins: { kind: 'none', score: 0.4 } }),
    WireLeakError,
  );
});

test('a vendor name in a value is caught, not just in a key', () => {
  assert.throws(
    () => decodeBoardRow({ ...CLEAN_ROW, thumbUrl: 'https://io.dexscreener.com/x.png' }),
    WireLeakError,
  );
});

test('ordinary payloads pass the censor untouched', () => {
  assert.doesNotThrow(() => assertNoInternalVocabulary(CLEAN_ROW));
});

test('an absent counter decodes to pending, never to zero', () => {
  const row = decodeBoardRow({ ...CLEAN_ROW, reach: { v: null, why: 'not_reported' } });
  assert.equal(row.reach.known, false);
  if (!row.reach.known) assert.equal(row.reach.pending, 'not_reported');
});

test('a censored spark point stays null instead of collapsing to zero', () => {
  const row = decodeBoardRow(CLEAN_ROW);
  assert.deepEqual(
    row.spark.points.map((p) => p.value),
    [3, null],
  );
});

test('an unknown first-seen time decodes to pending, not to now', () => {
  const row = decodeBoardRow({ ...CLEAN_ROW, firstSeenAt: { at: null } });
  assert.equal(row.firstSeenAt.known, false);
});

test('the unsure link exposes no coin at all', () => {
  const link = decodeCoinLink({ kind: 'unsure', claimCount: 306, coin: { ticker: 'X' } });
  assert.equal(link.kind, 'unsure');
  assert.equal('coin' in link, false);
});

test('"several" with fewer than two coins is a shape error', () => {
  assert.throws(() => decodeCoinLink({ kind: 'several', coins: [] }), WireShapeError);
});

test('a summary that is not exactly two lines is a shape error', () => {
  assert.throws(() => decodeBoardRow({ ...CLEAN_ROW, summary: ['one'] }), WireShapeError);
  assert.throws(() => decodeBoardRow({ ...CLEAN_ROW, summary: ['a', 'b', 'c'] }), WireShapeError);
});
