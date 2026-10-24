/**
 * The running pick on For You: a post whose coin trades now (the strip's last-hour test, or the cap
 * bar) is let on with the judge's yes and the owner's word deciding; an old or missing reading never
 * pulls a post.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_POLICY } from '@insidor/contracts/policy.ts';

import { isRunning, runningLets, type RunningPickRow } from './running-picks.ts';

const NOW = Date.UTC(2026, 9, 23, 21, 0);
const MIN = 60_000;
/* @TocRadio and "You Missed Coin" ($BITCHES), 23 Oct, once read. */
const row = (o: Partial<RunningPickRow> = {}): RunningPickRow => ({ itemId: 'x:2113693141609886045', address: 'BITCHES', judgedYes: true, capUsd: 120_000, volume1hUsd: 80_000, trades1h: 900, readAtMs: NOW - 2 * MIN, ...o });
const free = { ownerNotMeme: false, ownerNone: false, wrong: new Set<string>() };

test('★ running: the strip\'s last hour, or the cap bar, on a fresh reading', () => {
  assert.equal(isRunning(row(), NOW), true);
  /* Under the strip's dollars or trades, and under the cap bar: not running. */
  assert.equal(isRunning(row({ volume1hUsd: 500 }), NOW), false);
  assert.equal(isRunning(row({ trades1h: 5 }), NOW), false);
  /* No last hour recorded: the cap alone decides. */
  assert.equal(isRunning(row({ volume1hUsd: null, trades1h: null, capUsd: DEFAULT_POLICY.runnerLink.running.minCapUsd }), NOW), true);
  assert.equal(isRunning(row({ volume1hUsd: null, trades1h: null }), NOW), false);
  /* An old or missing reading never pulls. */
  assert.equal(isRunning(row({ readAtMs: NOW - DEFAULT_POLICY.runnerLink.running.readingWithinMs - MIN }), NOW), false);
  assert.equal(isRunning(row({ readAtMs: null }), NOW), false);
});

test('★ the route: the judge\'s yes and the owner\'s word decide, never the views', () => {
  assert.equal(runningLets(row(), free, NOW), true);
  assert.equal(runningLets(undefined, free, NOW), false);
  assert.equal(runningLets(row({ judgedYes: false }), free, NOW), false);
  assert.equal(runningLets(row(), { ...free, ownerNotMeme: true }, NOW), false);
  assert.equal(runningLets(row(), { ...free, ownerNone: true }, NOW), false);
  assert.equal(runningLets(row(), { ...free, wrong: new Set(['BITCHES']) }, NOW), false);
});
