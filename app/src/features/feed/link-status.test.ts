/**
 * What the status line says, in each of the four states it can be in.
 *
 * The claim being defended is a product one rather than a technical one: a board whose live
 * channel has died must not read the same as a board on a quiet market. So each test states
 * the store's facts, states the time, and asserts the sentence — and the last one asserts
 * that the four sentences are actually different, which is the only property that matters if
 * somebody later tidies them into one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { BoardMeta, LinkState } from '../../shared/api/index.ts';
import { RECONNECT_GRACE_MS, readLink } from './link-status.ts';

const NOW = 1_700_000_000_000;

function meta(link: LinkState, changedAt = NOW): BoardMeta {
  return { tick: 7, frozen: false, pendingCount: 0, link, linkChangedAt: changedAt, lastFrameAt: NOW };
}

test('no transport at all reads as a snapshot, not as a failure', () => {
  const readout = readLink(meta('idle'), NOW);
  assert.equal(readout.status, 'off');
  assert.equal(readout.label, 'not streaming');
  /* This is what a sample-data build shows, and it is not an error state. */
  assert.doesNotMatch(readout.title, /down|failed|error/i);
});

test('a subscribed channel reads as live', () => {
  const readout = readLink(meta('live'), NOW);
  assert.equal(readout.status, 'streaming');
  assert.equal(readout.label, 'live');
});

test('a channel that just dropped reads as reconnecting, not as broken', () => {
  const readout = readLink(meta('dropped', NOW - 3_000), NOW);
  assert.equal(readout.status, 'reconnecting');
  assert.equal(readout.label, 'reconnecting');
  /* Three seconds is one retry. Calling that broken would cry wolf at every wifi hiccup, and
     an alarm that fires constantly is an alarm nobody reads. */
  assert.match(readout.title, /reopened|behind/i);
});

test('★ a channel that stayed down says the board has stopped updating', () => {
  const readout = readLink(meta('dropped', NOW - RECONNECT_GRACE_MS), NOW);
  assert.equal(readout.status, 'stale', 'the boundary belongs to the state it is named for');
  assert.equal(readout.label, 'not updating');
  /* The sentence has to deny the thing the screen is implying. Rows of live-looking numbers
     under a dead channel read as a quiet market unless something says otherwise. */
  assert.match(readout.title, /quiet market/i);
});

test('the four states never collapse into one another', () => {
  const readouts = [
    readLink(meta('idle'), NOW),
    readLink(meta('live'), NOW),
    readLink(meta('dropped', NOW - 1_000), NOW),
    readLink(meta('dropped', NOW - 10 * RECONNECT_GRACE_MS), NOW),
  ];
  assert.deepEqual(
    readouts.map((r) => r.status),
    ['off', 'streaming', 'reconnecting', 'stale'],
  );
  assert.equal(new Set(readouts.map((r) => r.label)).size, 4, 'two states render the same word');
  assert.equal(new Set(readouts.map((r) => r.title)).size, 4, 'two states render the same sentence');
});

test('the readout is a function of the clock it is given, never of the wall clock', () => {
  const dropped = meta('dropped', NOW);
  assert.equal(readLink(dropped, NOW + 1_000).status, 'reconnecting');
  assert.equal(readLink(dropped, NOW + RECONNECT_GRACE_MS + 1).status, 'stale');
});
