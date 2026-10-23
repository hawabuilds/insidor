/** The coin gate: a launchpad coin, launched after we had the post; anything unknown is a no. */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { coinGate, LAUNCHPAD_VENUE } from './coin-gate.ts';

const HAD = 1_792_500_000_000;
const ok = { venueId: LAUNCHPAD_VENUE, origin: 'live_stream', launchedMs: HAD + 60_000, hadPostMs: HAD };

test('★ a launchpad coin launched after we had the post passes', () => {
  assert.equal(coinGate(ok), null);
  assert.equal(coinGate({ ...ok, origin: 'backfill', launchedMs: HAD }), null, 'the same instant counts as after');
});

test('★ a coin older than our post ("$ANATOLY launched 7d before @mert\'s post") is refused', () => {
  assert.equal(coinGate({ ...ok, launchedMs: HAD - 7 * 86_400_000 }), 'launched_before_the_post');
});

test('★ an unknown launch ("$Warhound has the name of…") or an unknown sighting is refused, never let through', () => {
  assert.equal(coinGate({ ...ok, launchedMs: null }), 'launch_unknown');
  assert.equal(coinGate({ ...ok, hadPostMs: null }), 'launch_unknown');
});

test('★ a coin with no launchpad row, another venue, or a row that is not a seen launch is refused', () => {
  assert.equal(coinGate({ ...ok, venueId: null, origin: null }), 'not_launchpad');
  assert.equal(coinGate({ ...ok, venueId: 'solana:meteora' }), 'not_launchpad');
  assert.equal(coinGate({ ...ok, origin: 'paired_token' }), 'not_launchpad');
  assert.equal(coinGate({ ...ok, origin: 'fixture' }), 'not_launchpad');
});
