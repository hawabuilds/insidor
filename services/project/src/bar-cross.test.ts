/**
 * Which new readings make a judged post one of the quick frame's changed posts (bar-cross.ts): only a
 * reading that takes it over For You's own views bar (rising.ts `clearsForYouBar`) when the readings up
 * to the cursor did not. Under the bar, or over it already, is not a change: the probe asks every few
 * seconds and must not wake a frame for every reading. The SQL half is checked on the real schema in
 * e2e/src/quick-bar-cross.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Millis } from '@insidor/contracts';
import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { barCrossers, crossedSince } from './bar-cross.ts';
import type { ReachReading } from './project.ts';
import { forYouBarCheck } from './rising.ts';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const POSTED = NOW - 90 * MIN;
const CURSOR = NOW - 2 * MIN;
const { clears } = forYouBarCheck(DEFAULT_POLICY);
const at = (minutesAgo: number, count: number): ReachReading => ({ atMs: (NOW - minutesAgo * MIN) as Millis, fidelity: 'exact', rate: { kind: 'censored', reason: 'no_prior', lastLevel: null }, count });

test('★ over the bar on a reading past the cursor, under it before: crossed', () => {
  assert.equal(crossedSince([at(30, 900), at(1, 60_000)], CURSOR, POSTED, 'x', clears), true);
});

test('a new reading still under the bar: not crossed', () => {
  assert.equal(crossedSince([at(30, 900), at(1, 2_000)], CURSOR, POSTED, 'x', clears), false);
});

test('★ over the bar already at the cursor: not crossed again, whatever it is kept off For You by', () => {
  assert.equal(crossedSince([at(30, 50_000), at(1, 60_000)], CURSOR, POSTED, 'x', clears), false);
});

test('switched off, or a zero cap: nothing is read', async () => {
  const asked: string[] = [];
  const db = { query: async (sql: string) => (asked.push(sql), []) } as never;
  const off = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, quickFrame: { ...DEFAULT_POLICY.rising.quickFrame, barCross: { on: false, maxPosts: 40 } } } };
  assert.deepEqual(await barCrossers(db, CURSOR, forYouBarCheck(off)), []);
  const none = { ...DEFAULT_POLICY, rising: { ...DEFAULT_POLICY.rising, quickFrame: { ...DEFAULT_POLICY.rising.quickFrame, barCross: { on: true, maxPosts: 0 } } } };
  assert.deepEqual(await barCrossers(db, CURSOR, forYouBarCheck(none)), []);
  assert.deepEqual(asked, []);
});
