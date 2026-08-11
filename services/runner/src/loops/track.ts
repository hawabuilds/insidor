/**
 * TRACK — when do we look again?
 *
 * The cadence is deliberately finer than the tracking schedule's finest tier
 * (~4 minutes). A claim queue polled less often than its shortest due-interval
 * turns the schedule into a suggestion: every item slips by up to one poll, and
 * the slip is largest exactly on the hottest items, which are on the shortest
 * tiers. The unconditional 2% holdout suffers the same slip, which would bias
 * the only unbiased history in the system.
 */

import { track } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 30_000;
const OFFSET_MS = 3_000;
/** Re-reads are batched by the adapter; the queue claim is FOR UPDATE SKIP LOCKED. */
const BATCH_SIZE = 1_000;

export function trackLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'track',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: track,
      work: deps.track,
    },
    deps,
  );
}
