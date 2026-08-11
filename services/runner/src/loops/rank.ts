/**
 * RANK — one primitive, both lanes.
 *
 * The fastest cadence in the process, because this is the loop the board's
 * refresh rate is made of. It is also the only loop whose output a user sees
 * directly, which is why it writes through the projection: a rank Decision
 * carries a score, and the row the browser reads carries a three-valued tone
 * and no score at all. The projection is in store/, not here — this loop must
 * not be the place someone is tempted to "just pass the number through".
 */

import { rank } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 20_000;
const OFFSET_MS = 18_000;
const BATCH_SIZE = 500;

export function rankLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'rank',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: rank,
      work: deps.rank,
    },
    deps,
  );
}
