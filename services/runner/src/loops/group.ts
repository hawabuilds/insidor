/**
 * GROUP — which story is this?
 *
 * The slowest cadence and the smallest batch, because GROUP is the one stage
 * whose cost grows with PAIRS inside a block rather than with arrivals: every
 * admitted item is scored against every open story candidate. Doubling the
 * batch does not double the work, it squares part of it. If this loop starts
 * falling behind, the answer is a better carrier index, not a bigger batch.
 */

import { group } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 120_000;
const OFFSET_MS = 9_000;
const BATCH_SIZE = 200;

export function groupLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'group',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: group,
      work: deps.group,
    },
    deps,
  );
}
