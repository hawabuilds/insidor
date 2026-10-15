/**
 * ADMIT'S TWO AGGREGATES OVER THE DECISION LOG, HELD FOR TEN MINUTES.
 *
 * ADMIT asks the log two questions every pass: the score quantile that sets its admission
 * bar (`PgDecisionRepo.scoreQuantile`) and how many posts it admitted in the last day
 * (`countSince`). Each reads a day of ADMIT's rows. On 2026-10-15, with the database short
 * of memory and every page read off disk at ~10 ms, the quantile took 7–40 s and the count
 * 17–50 s, ADMIT asked them nearly continuously, and between them they were most of the
 * disk the projector needed to keep For You and Popular moving. 0082's index made them
 * cheaper; it did not make asking every few seconds cheap.
 *
 * ★ THE DECISION: hold each answer for `HOLD_MS`, per stage and per question (the quantile
 * asked, the verdict counted). Both are a day-long window that moves slowly — a ten-minute
 * slice of a day's scores barely moves a quantile — so a bar ten minutes old is the same
 * bar. The window's start still slides with the clock on every fresh read; between reads
 * it is the answer as of the last one.
 *
 * ★ THE CONSEQUENCE, WHICH IS REAL: the daily-admission count is up to ten minutes stale,
 * so ADMIT can admit up to ten minutes' worth of posts past `admit.dailyAdmitTarget` before
 * `budgetExhausted` turns true — on the order of a hundred at today's volume. The budget is
 * a soft spend target, not a money limit, so an overshoot that small is the price of not
 * starving the database. Lower `HOLD_MS` if the target ever becomes a hard limit.
 *
 * Its own file so the hold is one decision in one place and testable without a database.
 * What breaks if changed carelessly: a failed read is never held (a timeout would otherwise
 * freeze the bar on nothing for ten minutes), and two passes asking at once share one read
 * rather than issuing two. Held in memory, so a deploy starts cold — which is correct.
 */

import type { Decision, Millis, StageName } from '@insidor/contracts';
import type { PgDecisionRepo } from '@insidor/store';

/** How long one answer is reused. See the header for what this costs ADMIT's budget. */
export const HOLD_MS = 10 * 60_000;

export type HeldDecisionReads = Pick<PgDecisionRepo, 'scoreQuantile' | 'countSince'>;

interface Held<T> {
  readonly at: number;
  readonly value: Promise<T>;
}

/** The two reads, answered from memory while an answer is younger than `holdMs`. */
export function heldDecisionReads(
  source: HeldDecisionReads,
  holdMs: number = HOLD_MS,
  clock: () => number = Date.now,
): HeldDecisionReads {
  const held = new Map<string, Held<unknown>>();

  function hold<T>(key: string, read: () => Promise<T>): Promise<T> {
    const now = clock();
    const found = held.get(key);
    if (found && now - found.at < holdMs) return found.value as Promise<T>;
    const value = read();
    held.set(key, { at: now, value });
    // A failed read is dropped, so the next pass asks again instead of reusing the failure.
    value.catch(() => {
      if (held.get(key)?.value === value) held.delete(key);
    });
    return value;
  }

  return {
    scoreQuantile: (stage: StageName, sinceMs: Millis, quantile: number) =>
      hold(`q|${stage}|${quantile}`, () => source.scoreQuantile(stage, sinceMs, quantile)),
    countSince: (stage: StageName, verdict: Decision['verdict'], sinceMs: Millis) =>
      hold(`n|${stage}|${verdict}`, () => source.countSince(stage, verdict, sinceMs)),
  };
}
