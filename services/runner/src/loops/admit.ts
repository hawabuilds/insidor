/**
 * ADMIT — is this worth spending money to track?
 *
 * The numbers here are OPERATIONAL cadences, not product thresholds. Every
 * threshold the decision is judged against lives in Policy and is hashed into
 * the decision row; nothing in this file changes what admit decides, only how
 * often it is asked. That distinction is why these literals are allowed to sit
 * in a service and would not be allowed to sit in core.
 */

import { admit } from '@insidor/core';

import { makeStageLoop, type Loop, type LoopDeps } from '../loop.ts';

/** Arrivals run about 0.35/s; a minute is a batch worth the round trip. */
const EVERY_MS = 60_000;
const OFFSET_MS = 0;
/** Discovery returns pages, not streams. 500 is a page-sized bite. */
const BATCH_SIZE = 500;

export function admitLoop(deps: LoopDeps): Loop {
  return makeStageLoop(
    {
      stage: 'admit',
      everyMs: EVERY_MS,
      offsetMs: OFFSET_MS,
      batchSize: BATCH_SIZE,
      decide: admit,
      work: deps.admit,
    },
    deps,
  );
}
