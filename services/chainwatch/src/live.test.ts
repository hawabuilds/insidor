/**
 * The live feed's dollars: one odd SOL sample is not kept, so it cannot put every coin's price wrong
 * for a moment; a tick gets the median of the last minute's samples.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLiveHub } from './live.ts';

test('★ one odd SOL sample is not kept: the hub reads the median of the last minute', () => {
  let now = 1_000_000;
  const hub = createLiveHub(() => now);
  for (const usd of [100, 100.2, 99.9, 100.1, 100]) hub.hooks.onSolUsd(usd, now);
  hub.hooks.onSolUsd(55, now);
  assert.equal(hub.stats().solUsd, 100);
  now += 1_000;
  hub.hooks.onSolUsd(100.3, now);
  assert.ok(Math.abs((hub.stats().solUsd ?? 0) - 100.1) < 0.2);
  hub.stop();
});

test('with too few samples to judge, a sample is kept; once they age out the price can move', () => {
  let now = 0;
  const hub = createLiveHub(() => now);
  hub.hooks.onSolUsd(100, now);
  hub.hooks.onSolUsd(140, now);
  assert.ok((hub.stats().solUsd ?? 0) >= 100);
  now += 120_000;
  hub.hooks.onSolUsd(150, now);
  assert.equal(hub.stats().solUsd, 150);
  hub.stop();
});
