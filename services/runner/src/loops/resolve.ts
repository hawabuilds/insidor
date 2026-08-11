/**
 * RESOLVE — which coin, if any?
 *
 * A NOTE ON THE COUNT. The architecture calls the runner "six supervised loops"
 * and then lists seven loop files, RESOLVE among them. Seven is what is
 * supervised here, because the alternative is a stage with no caller: candidate
 * generation is a time-windowed query over `asset`, and nothing else in the
 * system runs it. Anyone reconciling the documents should fix the count, not
 * delete the loop.
 *
 * Cadence is set by the input, not by cost: a coin is minted within about two
 * minutes of the source post, so a resolve pass that runs less often than that
 * spends its first cycle looking at a window that is not populated yet. Being
 * late here is not fatal — the winnable window is days wide, six days to peak —
 * but being late is also free to avoid.
 *
 * The batch is small — 50 STORIES per pass — and that is not the same number as
 * the candidate set. Each of those 50 decisions scores up to 500 candidate
 * assets, because the margin rule needs a genuine runner-up: a margin computed
 * over a truncated candidate list is a margin against the wrong second place,
 * and one meme can spawn 306 tokens. Widen the candidate query, never this.
 */

import { resolve } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 60_000;
const OFFSET_MS = 15_000;
const BATCH_SIZE = 50;

export function resolveLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'resolve',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: resolve,
      work: deps.resolve,
    },
    deps,
  );
}
