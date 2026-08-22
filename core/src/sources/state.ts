/**
 * IS THIS SOURCE LIVE, DORMANT, OR FAILING — the one place that decides, for
 * everybody.
 *
 * ★ WHY IT IS HERE AND NOT IN THE THING THAT DISPLAYS IT. The rule turns on two
 * thresholds, and a threshold typed into a projector is a threshold nobody can
 * find later — the exact failure `contracts/src/policy.ts` exists to end. It is
 * also a rule that will be asked by more than one caller: the process that does
 * the calling wants to know whether it is running on nothing, and the process
 * that draws the indicator wants to know what word to put beside a pip. Two
 * spellings of a three-way call WILL drift, and the direction they drift in is
 * always the same one — toward the branch that says `live`, because that is the
 * branch nobody notices being wrong.
 *
 * ── ★ THE ORDER OF THE BRANCHES IS THE ARGUMENT ────────────────────────────
 *
 *   not configured    → DORMANT. First, and unconditionally. A source nobody
 *                       turned on cannot be failing: there is nothing to fail.
 *                       This branch is what stops a product that is working
 *                       exactly as configured from wearing a permanent fault, and
 *                       it must stay first — every check below it is a question
 *                       about calls, and no call was ever made.
 *   half configured   → FAILING. Somebody turned it on and got it wrong. That is
 *                       a mistake, not a decision, and reporting it as `dormant`
 *                       would agree with the person who believes it is running.
 *   failing in a row  → FAILING. The fast shape: a wrong key refuses every call,
 *                       instantly, and would otherwise read as live for a whole
 *                       freshness window while answering nothing.
 *   never answered    → FAILING. Configured, and nothing has ever come back. Not
 *                       "quiet" — the watchdog treats never-succeeded as its own
 *                       page-severity alert for the same reason. The instant
 *                       beside this state is null, so a surface can still say "has
 *                       never answered" rather than inventing an age.
 *   silent past a bar → FAILING. The slow shapes, and the ones a failure COUNT
 *                       can never catch: a source whose calls hang never returns,
 *                       so it never errors; a source nobody is asking any more
 *                       because the loop that asks it died never errors either.
 *                       Both have a counter sitting at zero and would read healthy
 *                       forever.
 *   otherwise         → LIVE.
 *
 * ── ★ A FUTURE SUCCESS IS NOT A SUCCESS ────────────────────────────────────
 *
 * A clock skewed forward — ours or a database's — produces a NEGATIVE silence,
 * which passes any `silence <= bar` test forever and makes the source
 * unfalsifiably live. It is judged failing instead. Every tie in this file breaks
 * the same way: toward the answer that costs a false alarm, never toward the one
 * that hides a real outage. `projectFeedSource` closes the identical hole on the
 * mint feed, and this is that clause, on this input.
 *
 * ── ★ AND A FACT WE CANNOT READ IS NOT EVIDENCE OF HEALTH ──────────────────
 *
 * A non-finite instant or count makes every comparison below FALSE, so a naive
 * version falls through every failing branch and returns `live` — a corrupt row
 * would light the pip green. Both are checked explicitly. This is not defensive
 * tidying: it is the difference between "we do not know" and "it is fine", and
 * this whole file exists because those two were being spelled the same way.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import type { SourceHealth, SourceState } from '@insidor/contracts/source.ts';
import type { Millis } from '@insidor/contracts/vocabulary.ts';

/**
 * The three-way call.
 *
 * @param health the recorded facts. Never re-read, never refreshed — whatever the
 *        caller passes is what the answer is about.
 * @param now injected, like every clock in this package. A judgement that read the
 *        wall clock could not be replayed, and this one is replayed every time a
 *        past frame is re-projected.
 */
export function sourceState(health: SourceHealth, now: Millis, policy: Policy): SourceState {
  if (health.configuration === 'dormant') return 'dormant';
  if (health.configuration === 'misconfigured') return 'failing';

  const failures = health.consecutiveFailures;
  if (!Number.isFinite(failures)) return 'failing';
  if (failures >= policy.ingest.failingAfterFailures) return 'failing';

  const lastSuccessAt = health.lastSuccessAt;
  if (lastSuccessAt === null || !Number.isFinite(lastSuccessAt)) return 'failing';

  const silenceMs = now - lastSuccessAt;
  /* `>= 0` rejects the future instant; `<=` makes the bar inclusive, so a source
     that answered exactly one window ago is still live. Inclusive because the bar
     is a duration a source is ALLOWED to be silent for, and a bar you are not
     allowed to reach is a different, unstated bar one millisecond lower. */
  return silenceMs >= 0 && silenceMs <= policy.ingest.sourceFreshnessMs ? 'live' : 'failing';
}

/**
 * How many of a set are live.
 *
 * ★ IT EXISTS SO THAT NOBODY COUNTS `all().length` AND CALLS IT THE NUMBER OF
 * SOURCES WE HEARD FROM. The whole point of the three states is that two of them
 * are dark for different reasons, and a caller that wants "how many are answering"
 * must not get that number by counting rows that happen to exist. Splitting it out
 * also makes the zero case a value a caller can branch on rather than an emptiness
 * it has to notice.
 */
export function liveCount(states: readonly SourceState[]): number {
  return states.filter((state) => state === 'live').length;
}
