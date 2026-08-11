/**
 * The reason list is the diagnostic surface of the whole pipeline: it is what turns
 * "the board looks quiet" into a query that names the gate that ate the traffic. So
 * the properties worth pinning are that codes are unique, prefixed by stage, and that
 * the guard actually refuses a code that is not in the list.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { REASON_CODES, isReasonCode, reasonPrefix } from './reasons.ts';

test('every code is a stage letter, a stable number, and a snake-case name', () => {
  // The number never gets reused or renumbered: dashboards and historical
  // comparisons are keyed on it. Two codes may share a number when they are two
  // outcomes of one gate (G7 quotability), which is why the letter+number is not
  // required to be unique but the whole code is.
  for (const code of Object.keys(REASON_CODES)) {
    assert.match(code, /^[ATDMQGVRS][0-9]+_[a-z0-9_]+$/, `malformed reason code: ${code}`);
  }
});

test('every code carries a one-line meaning, so no dashboard needs a second table', () => {
  for (const [code, meaning] of Object.entries(REASON_CODES)) {
    assert.ok(meaning.length > 0, `${code} has no meaning`);
  }
});

test('the guard refuses free text, which is what `reason` must never become', () => {
  assert.ok(isReasonCode('Q0_coinable'));
  assert.ok(!isReasonCode('looked wrong'));
  assert.ok(!isReasonCode('toString'));
});

test('an outage reason is distinct from an unfavourable answer', () => {
  // "our quote vendor is down" and "this asset cannot be traded" must be different
  // rows, or every candidate silently passes during an outage.
  assert.ok(isReasonCode('G7_unquotable'));
  assert.ok(isReasonCode('G7_vendor_unavailable'));
  assert.equal(reasonPrefix('G7_unquotable'), 'G');
});
