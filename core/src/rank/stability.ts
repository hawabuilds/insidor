/**
 * The metric nobody instruments and everybody should: rank correlation between
 * consecutive ticks.
 *
 * It has a floor AND a ceiling, which is what makes it useful. Below the floor the
 * board is churning and unreadable. Sustained near one, the board is frozen — which
 * looks stable and means the ranker has stopped responding to anything. Only a
 * two-sided metric can tell those apart, and neither is visible in a screenshot.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ★ THIS NUMBER MUST NEVER REACH A SCREEN, and that is not a styling preference.
 *
 * Every other number in this system is a measurement of THE WORLD — how fast an item
 * is spreading, how many people made their own version, what a trade would cost.
 * Kendall tau is a measurement of OUR OWN BEHAVIOUR. It says how much our ordering
 * moved, which is a fact about our ranker and about nothing else. Rendering it would
 * put a self-assessment on the same surface as evidence, where a reader has no way to
 * tell the two apart and every incentive to read the self-assessment as a quality
 * score. It is also, being a self-assessment, the one number on that surface we would
 * be tempted to tune rather than to measure.
 *
 * So it goes in the decision log, beside the tick it describes, where it can be
 * queried, alarmed on and compared across policy versions — and nowhere else. The
 * projection in store/ that builds what a browser reads has no field for it and must
 * not grow one.
 *
 * ★ AND MEASURE IT ON BOTH ORDERINGS, which is the trap that makes the ceiling alarm
 * real. Tau over the COMMITTED boards measures the product — what a reader actually
 * saw between two glances. Tau over the RAW score ordering measures the ranker. They
 * are different numbers and the difference is the whole point of hysteresis: a
 * hysteresis rule makes committed tau look excellent by construction, so committed
 * tau alone can never detect a dead ranker. If the raw ordering is frozen and the
 * committed one is smooth, the board is a screenshot and only the raw series says so.
 */

import type { Policy } from '@insidor/contracts/policy.ts';

/**
 * Kendall tau-b between two orderings of subject ids. +1 identical, 0 unrelated,
 * −1 reversed.
 *
 * ★ IT IS COMPUTED OVER THE UNION, NOT THE INTERSECTION, and that decision is the
 * one thing about this function worth arguing over. Consecutive ticks are not the
 * same subject set: rows enter and rows leave. Plain tau over the ids the two lists
 * share silently ignores the turnover, so a board that replaced half its rows scores
 * a perfect 1.0 on the three that stayed — the metric reports maximum stability at
 * the exact moment the board is least readable, which is worse than not measuring it.
 *
 * So the universe is every id in either list, and an id missing from one list is
 * ranked BELOW every id present in it, tied with the other absentees. That is the
 * honest reading of absence in an ordering: "not on the board" is a position, and it
 * is the last one. Ties are then corrected for with the tau-b denominator, because
 * tau-a and tau-b disagree materially exactly when the tie groups are large — which
 * is exactly when turnover is high, which is exactly when this is being consulted.
 *
 * @returns a coefficient in [−1, 1]. 1 when there are fewer than two subjects in the
 *          union, because nothing can have moved relative to nothing; 0 when one
 *          list is empty and the other is not, because an ordering carries no
 *          information about an ordering that does not exist.
 */
export function kendallTau(previous: readonly string[], next: readonly string[]): number {
  const universe: string[] = [];
  const seen = new Set<string>();
  for (const id of previous) if (!seen.has(id)) { seen.add(id); universe.push(id); }
  for (const id of next) if (!seen.has(id)) { seen.add(id); universe.push(id); }

  const n = universe.length;
  // No pairs, so no disagreement is possible. Nothing moved, because there was
  // nothing that could move — 1 is the reading, and a caller alarming on a board
  // this small is alarming on the absence of a board.
  if (n < 2) return 1;

  const previousRank = ranks(previous, universe);
  const nextRank = ranks(next, universe);

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = universe[i] as string;
      const b = universe[j] as string;
      const inPrevious = Math.sign((previousRank.get(a) as number) - (previousRank.get(b) as number));
      const inNext = Math.sign((nextRank.get(a) as number) - (nextRank.get(b) as number));
      // A pair tied in either ordering is counted in neither sum — it is counted in
      // that ordering's tie correction below instead. Counting it as agreement is how
      // a board of absentees scores 1.0.
      if (inPrevious === 0 || inNext === 0) continue;
      if (inPrevious === inNext) concordant += 1;
      else discordant += 1;
    }
  }

  const pairs = (n * (n - 1)) / 2;
  const denominator = Math.sqrt((pairs - tiedPairs(previous, n)) * (pairs - tiedPairs(next, n)));

  // Everything in one of the two orderings is tied — one list is empty, or holds a
  // single id out of a large universe. There is no ordering to correlate against, and
  // 0 says "unrelated", which is exactly what an absent ordering tells us.
  if (!(denominator > 0)) return 0;

  return (concordant - discordant) / denominator;
}

/**
 * Position within a list; every id not in it shares one rank below all of them.
 * A duplicate id keeps its first position — a list that names the same subject twice
 * is malformed, and the alternative is for the later copy to silently reorder it.
 */
function ranks(list: readonly string[], universe: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < list.length; i++) {
    const id = list[i] as string;
    if (!out.has(id)) out.set(id, i);
  }
  const absent = out.size;
  for (const id of universe) if (!out.has(id)) out.set(id, absent);
  return out;
}

/** The tau-b correction: every pair inside the one tie group an ordering can have. */
function tiedPairs(list: readonly string[], universe: number): number {
  const present = new Set(list).size;
  const tied = universe - present;
  return (tied * (tied - 1)) / 2;
}

/* ── reading the number ───────────────────────────────────────────────── */

/**
 * What a tau means, as a state rather than as a comparison somebody has to remember
 * the direction of.
 *
 * Four states and not three, because missing the target and being unreadable are
 * different alarms: one is a note for whoever tunes the ranker next week, the other
 * is a reader who cannot follow a row between two glances and is happening now.
 */
export type StabilityState = 'unreadable' | 'churning' | 'readable' | 'frozen';

/**
 * ★ THE CEILING IS THE HALF THAT CATCHES A DEAD RANKER, and it is the reason this
 * function exists rather than a bare comparison against the floor. A frozen board and
 * a healthy board are pixel-identical: every instrument in the system reports green,
 * the tick fires, the rows render, the latency is excellent, and the ordering has not
 * responded to anything in six hours. `frozen` is the only signal that says so.
 *
 * `frozen` on a single tick is not an incident — an ordering can legitimately hold
 * still for twenty seconds. It is the SUSTAINED state that means the ranker stopped,
 * which is a question about a series and therefore the caller's to ask.
 */
export function stabilityState(tau: number, p: Policy): StabilityState {
  if (tau < p.rank.kendallTauUnusable) return 'unreadable';
  if (tau < p.rank.kendallTauFloor) return 'churning';
  if (tau > p.rank.kendallTauCeiling) return 'frozen';
  return 'readable';
}
