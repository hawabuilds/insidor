/**
 * THE COIN MODEL LOOP — each post the judge said no to scored once by our own coin model, the
 * safety net (Policy.judge.coinModel; work/coin-model.ts).
 *
 * Its own supervised loop rather than a step after discovery, because the owner's rule for it is
 * "never stall the live feed": the discover pass and the judge never wait on it, and a slow read
 * here backs off only this loop. A quiet pass is one or two queries.
 *
 * What breaks if changed carelessly: a skipped pass (off, a dry run, no applied fit, 0096 not
 * applied) is reported as nothing in and nothing out, never as failed: failing the run row would
 * back the loop off and the shadow would fall behind.
 */

import type { Loop, LoopCounts } from '../loop.ts';
import type { CoinModelResult } from '../work/coin-model.ts';

/** Every two minutes: a post the judge said no to is scored well inside For You's age bar. */
const EVERY_MS = 120_000;
/** After the narratives loop's offset, so the loops do not start in the same second. */
const OFFSET_MS = 75_000;

export function coinModelLoop(work: () => Promise<CoinModelResult>): Loop {
  return {
    stage: 'coinmodel',
    everyMs: EVERY_MS,
    offsetMs: OFFSET_MS,
    async run(): Promise<LoopCounts> {
      const r = await work();
      return { in: r.scored + r.unscored, out: r.scored, failed: 0, firstError: null };
    },
  };
}
