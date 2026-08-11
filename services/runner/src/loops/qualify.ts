/**
 * QUALIFY — is there a nameable, coinable thing in this story?
 *
 * This is the only loop whose `pull` costs real money per subject: the judge
 * call happens THERE, in the adapter, and its Judgement and its metered cost
 * arrive as fields on the input. The core stage consults no model; it reads a
 * value that was already fetched. That is what makes this stage replayable six
 * months later with no network and no API key.
 *
 * The batch is small for the same reason. A batch size here is a spend
 * decision, and a spend decision that is also a page size is one refactor away
 * from being accidentally multiplied.
 */

import { qualify } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

const EVERY_MS = 120_000;
const OFFSET_MS = 12_000;
const BATCH_SIZE = 50;

export function qualifyLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'qualify',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: qualify,
      work: deps.qualify,
    },
    deps,
  );
}
