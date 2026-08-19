/**
 * ★ THE ONE PLACE A DECISION IS TAKEN AND THE ONE PLACE IT IS WRITTEN.
 *
 * SETUP.md: "the decision log and the outcome labels are the two tables that cannot
 * be backfilled. Every day the live system runs without writing them is training data
 * that never existed and cannot be bought." A decision that was made and not recorded
 * is the exact failure `internal.decisions` exists to prevent, so the write must not
 * be a call somebody remembers to add.
 *
 * ── WHY A HELPER THAT OWNS BOTH, AND NOT A `finally` ─────────────────────
 *
 * A `finally` was the obvious candidate and it is the wrong shape here, for two
 * reasons that are worth writing down so nobody re-proposes it:
 *
 *   1. A `finally` runs AFTER its block. Putting the write there would put it after
 *      the side effect, which inverts log → act into act → log. That asymmetry is the
 *      whole design (store/src/repo/decisions.ts): a logged decision whose side effect
 *      failed leaves `applied_at IS NULL`, which is queryable and repairable, whereas
 *      a side effect with no log is invisible AND correlated with failures — it biases
 *      the record exactly where bias hurts most.
 *
 *   2. A `finally` cannot write a decision that was never constructed. If `decide()`
 *      throws there is nothing to record, so the guarantee a `finally` would buy is
 *      the one case it cannot cover.
 *
 * So the guarantee is structural instead of temporal, and it is enforced by the type
 * system rather than by discipline:
 *
 *   - `commitDecision` is the only exported way to run a stage. It closes over the
 *     decider, the log and the side effect, and there is no seam between them for a
 *     caller to slip through. `loop.ts` cannot call `spec.decide` itself, because it
 *     is handed a thunk it can only pass in here.
 *
 *   - `StageWork.apply` requires a `DecisionReceipt`, and a `DecisionReceipt` carries
 *     a brand whose symbol this module does not export. No other file can name the
 *     property, so no other file can construct one, so THE SIDE EFFECT IS UNREACHABLE
 *     WITHOUT A ROW ID. Forgetting the write is not a mistake somebody makes at three
 *     in the morning; it is a program that does not typecheck.
 *
 * That second half is the part a `finally` could never have given us. A `finally`
 * guards one function body. This guards every present and future caller.
 */

import type { Decision, Millis } from '@insidor/contracts';

/* ── the log seam ─────────────────────────────────────────────────────── */

/**
 * The store side of the log-then-act asymmetry. `write` returns the row id so
 * `markApplied` can close it; a repo that cannot return the id cannot support the
 * asymmetry at all.
 *
 * Declared here rather than in `loop.ts` because this module is where the ordering
 * lives, and a port declared away from its only rule drifts from it.
 */
export interface DecisionLog {
  write(decision: Decision): Promise<string>;
  markApplied(rowId: string, at: Millis): Promise<void>;
}

/* ── the receipt ──────────────────────────────────────────────────────── */

/**
 * The brand. `declare const` so it is erased at runtime (the repo forbids any syntax
 * that needs a build step), and NOT exported, so `typeof RECEIPT` is unnameable
 * outside this file. That is what makes the receipt unforgeable rather than merely
 * inconvenient to forge.
 */
declare const RECEIPT: unique symbol;

/**
 * Proof that a decision reached `internal.decisions` before its side effect ran.
 *
 * It carries the row id because `markApplied` needs it, and the decision because
 * every `apply` needs to know what was decided — passing both means a stage's side
 * effect can never be applied against a decision other than the one that was logged.
 */
export interface DecisionReceipt {
  readonly [RECEIPT]: true;
  /** `internal.decisions.id`, as text. The id `applied_at` will be stamped against. */
  readonly rowId: string;
  /** The frozen decision, exactly as written. */
  readonly decision: Decision;
}

/** The only constructor, and it is private to this module by construction. */
function receiptFor(rowId: string, decision: Decision): DecisionReceipt {
  // The cast is the one place the brand is asserted rather than proved. It is safe
  // because it is unreachable except from `commitDecision`, three lines below the
  // `write` whose id it is carrying.
  return { rowId, decision } as unknown as DecisionReceipt;
}

/* ── the committed step ───────────────────────────────────────────────── */

export interface CommitDeps {
  readonly decisions: DecisionLog;
  /** The clock, as a function, so `markApplied` stamps when the effect actually landed. */
  readonly now: () => Millis;
}

export interface CommitStep<Input> {
  readonly input: Input;
  /**
   * The pure decider, already closed over its policy and its `StageContext`.
   *
   * A thunk rather than `(input, policy, ctx)` so that the clock, the policy hash and
   * the seed are fixed by the caller BEFORE this function is entered — there is then
   * no way for the write path to influence what was decided.
   */
  readonly decide: () => Decision;
  /** The side effect. It cannot run without a receipt, and a receipt means a row. */
  readonly apply: (input: Input, receipt: DecisionReceipt) => Promise<void>;
}

/**
 * Decide, LOG, act, MARK — in that order, always, for every stage.
 *
 * Throws exactly what its three steps throw, and where it throws is the record:
 *
 *   - `decide()` throws  → nothing was decided, so nothing is written. Correct: an
 *     exception is not a judgement, and a row claiming otherwise would be a lie.
 *   - `write()` throws   → nothing happened at all. The side effect is not attempted,
 *     which is the direction the whole asymmetry chose.
 *   - `apply()` throws   → the row stands with `applied_at IS NULL`. That is the
 *     repair queue (`decisions_unapplied_idx`), not a lost decision.
 *   - `markApplied()` throws → the effect happened and we failed to say so. It looks
 *     identical to the case above, which is the honest direction to be wrong in: the
 *     sweep re-examines it rather than assuming.
 */
export async function commitDecision<Input>(
  step: CommitStep<Input>,
  deps: CommitDeps,
): Promise<Decision> {
  const decision = step.decide();

  // 1. LOG. The feature vector is frozen here, before the outcome exists and before
  //    the side effect is attempted.
  const rowId = await deps.decisions.write(decision);

  // 2. ACT. Unreachable without the receipt above — that is the guarantee.
  await step.apply(step.input, receiptFor(rowId, decision));

  // 3. MARK. The only mutation the table permits, and the database refuses a second.
  await deps.decisions.markApplied(rowId, deps.now());

  return decision;
}
