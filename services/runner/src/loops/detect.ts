/**
 * DETECT — is this accelerating relative to its own baseline?
 *
 * Runs on the observation stream that TRACK produces, so its cadence only has
 * to be fast enough that a burst is not stale by the time it is noticed. It is
 * never the first thing to see an item: an item with no observations yet has no
 * rate, and a stage with no rate must abstain rather than score a zero.
 */

import { detect } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 60_000;
const OFFSET_MS = 6_000;
const BATCH_SIZE = 500;

export function detectLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'detect',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: detect,
      work: deps.detect,
    },
    deps,
  );
}
