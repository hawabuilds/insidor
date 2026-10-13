/**
 * THE POST JUDGE, WITH THE OWNER'S LATEST APPLIED EXAMPLES — swapped in while the runner runs.
 *
 * The re-tune (tools/retune.ts) writes a new learned-examples block twice a day and marks it
 * applied only when it passed every gate (internal.judge_examples_version, 0056). This reads the
 * latest applied block at boot and again every few minutes, and when it changed, builds a new
 * judge with it and puts it behind the same port the scorer already holds. With no applied block
 * the judge has no examples, which is how it ran before there were any.
 *
 * ★ ONE PORT, READ THROUGH ON EVERY CALL. The scorer is handed `port` once at wiring; `id` and
 * `promptId` are getters, so the next pass after a swap files its answers under the new prompt's
 * hash. An answer always names the exact examples it saw — the adapter hashes them into the id.
 *
 * ★ A FAILED READ KEEPS WHAT IS RUNNING. The database being unreachable for a minute is not a
 * reason to drop the examples the judge was using; it is logged and the next check tries again.
 *
 * What breaks if changed carelessly: building the judge inside `judge()` per call. The adapter
 * holds the prompt and its hash; rebuilt per call, the prompt cache would still hit, but the id
 * would be recomputed on every post for nothing, and a half-loaded block could reach one call.
 */

import type { JudgePort } from '@insidor/contracts/ports/judge.ts';

import type { Logger } from './log.ts';

/** How often the runner asks whether a newer block was applied. Twice-daily re-tunes; minutes are plenty. */
export const EXAMPLES_RECHECK_MS = 5 * 60_000;

export interface AppliedBlock {
  readonly versionId: number;
  readonly text: string;
  readonly sha: string;
}

export interface LearnedJudgeDeps {
  /** The latest applied block, or null when none has ever been applied. */
  readonly latest: () => Promise<AppliedBlock | null>;
  /** The post judge with these examples (null: none). */
  readonly build: (examples: string | null) => JudgePort;
  readonly log: Logger;
}

export interface LearnedJudge {
  readonly port: JudgePort;
  /** Reads the latest applied block and swaps the judge if it changed. Never throws. */
  readonly refresh: () => Promise<void>;
  /** The version in use, or null for none. */
  readonly version: () => number | null;
}

export function learnedJudge(deps: LearnedJudgeDeps): LearnedJudge {
  let current = deps.build(null);
  let version: number | null = null;

  const port: JudgePort = {
    get id() {
      return current.id;
    },
    get promptId() {
      return current.promptId;
    },
    get maxBatch() {
      return current.maxBatch;
    },
    judge: (subjects, budget) => current.judge(subjects, budget),
    estimate: (subjects) => current.estimate(subjects),
  };

  return {
    port,
    version: () => version,
    async refresh() {
      let block: AppliedBlock | null;
      try {
        block = await deps.latest();
      } catch (e) {
        deps.log.warn('the learned examples could not be read; keeping the ones in use', { version, err: e instanceof Error ? e.message : String(e) });
        return;
      }
      const next = block?.versionId ?? null;
      if (next === version) return;
      current = deps.build(block?.text ?? null);
      deps.log.info(block === null ? 'post judge: no learned examples applied' : 'post judge: learned examples applied', {
        version: next,
        was: version,
        sha: block?.sha ?? null,
        chars: block?.text.length ?? 0,
        promptId: current.promptId,
      });
      version = next;
    },
  };
}
