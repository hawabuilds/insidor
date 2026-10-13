/**
 * Outages on recorded pass times: what counts as one, and how much of a post's chance fell in it.
 * Kept beside the diagnosis' own tests because the 2026-10-13 outage (00:08–02:04 UTC) is the case
 * that made this file: a post at 01:09 must read "down", one at 02:01 must not.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { DEFAULT_POLICY as P } from '@insidor/contracts/policy.ts';

import { outages, postWindow } from './outage.ts';

const T = (hhmm: string) => Date.parse(`2026-10-13T${hhmm}:00Z`);
const RECORD = { firstMs: Date.parse('2026-10-12T22:12:00Z'), lastMs: T('14:00'), gaps: [{ fromMs: T('00:09'), toMs: T('02:04') }, { fromMs: T('02:05'), toMs: T('02:11') }] };

test('a gap longer than the main look-back is an outage; a shorter one is not', () => {
  const list = outages(RECORD, T('14:01'), P);
  assert.deepEqual(list, [{ fromMs: null, toMs: RECORD.firstMs }, { fromMs: T('00:09'), toMs: T('02:04') }]);
});

test('a post made inside an outage, whose whole main window it covered, was down', () => {
  const w = postWindow(outages(RECORD, T('14:01'), P), T('01:09'), 60, P);
  assert.equal(w.down, true);
  assert.equal(w.beforeFirstPass, false);
  assert.equal(w.coveredMin, 0);
  assert.ok(w.slowCoveredMin > 0 && w.slowCoveredMin < 60);
});

test('a post made just before the outage ended had part of its window: not down', () => {
  const w = postWindow(outages(RECORD, T('14:01'), P), T('02:01'), 60, P);
  assert.equal(w.down, false);
  assert.ok(w.coveredMin > 0 && w.coveredMin < P.feed.windowMin);
});

test('before the first pass on record, discovery was not running yet', () => {
  const w = postWindow(outages(RECORD, T('14:01'), P), Date.parse('2026-10-12T17:36:00Z'), 60, P);
  assert.equal(w.down, true);
  assert.equal(w.beforeFirstPass, true);
});

test('no pass on record at all: always down', () => {
  assert.equal(postWindow(outages({ firstMs: null, lastMs: null, gaps: [] }, T('14:00'), P), T('12:00'), 60, P).down, true);
});
