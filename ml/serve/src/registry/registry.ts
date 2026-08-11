/**
 * Which artefact is live — as a database row, not as a deploy.
 *
 * THE POINT: a challenger can shadow-score for days and then be promoted
 * without shipping code. A challenger runs on the SAME frozen feature vector,
 * immediately after the champion, writes a second decision row pointing at the
 * champion's with `shadow_of`, and changes nothing the product does. Zero
 * product effect, one extra pure function call. Champion-versus-challenger
 * comparison becomes a query rather than a deploy, and a rollback becomes an
 * UPDATE rather than a revert.
 *
 * This is only possible because features are an object you can pass around —
 * the same property that makes the decision log work.
 *
 * NOTE ON PLACEMENT: the registry lives inside the ml/serve package because
 * `ml/serve` is the only TypeScript package under ml/ that the workspace
 * declares. It is its own directory so that the boundary stays legible: nothing
 * here walks a tree, and nothing in the walker knows a row exists.
 */

import type { Millis, StageName } from '@insidor/contracts';
import type { FeatureSetId } from '@insidor/contracts/features.ts';
import type { ArtefactMetadata } from '../artefact.ts';

/**
 * A role, not a status. Exactly one champion per stage; any number of
 * challengers; retired rows are kept forever, because "what was live on the day
 * that decision was made" is a question the decision log will be asked.
 */
export const MODEL_ROLES = ['champion', 'challenger', 'retired'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** One row of `internal.model_registry` (migration 0014). */
export interface RegistryRow {
  readonly rowId: string;
  readonly stage: StageName;
  readonly role: ModelRole;

  /** Where the bytes live. A URI, never the bytes themselves. */
  readonly artefactUri: string;
  readonly metadata: ArtefactMetadata;

  /** When this row took its current role. Null for a challenger never promoted. */
  readonly promotedAt: Millis | null;
  readonly retiredAt: Millis | null;

  /** When the challenger started shadow-scoring. The clock the shadow gate reads. */
  readonly shadowingSince: Millis | null;
  /** The champion this challenger is shadowing, so the comparison has a subject. */
  readonly shadowOfRowId: string | null;

  /** Free text, written by a human at promotion. The regime note lives here. */
  readonly note: string | null;
}

/**
 * What store/ implements. Async, because it is a database — which is exactly why
 * it is a port and not a function: core and the stages see a Scorer, never this.
 */
export interface ModelRegistryPort {
  /** The live model for a stage, or null when the stage is still ruled. */
  champion(stage: StageName): Promise<RegistryRow | null>;
  /** Every challenger currently shadow-scoring the given stage. */
  challengers(stage: StageName): Promise<readonly RegistryRow[]>;
  /** History, newest first, including retired rows. */
  history(stage: StageName, limit: number): Promise<readonly RegistryRow[]>;
  /**
   * Promote a challenger. Implementations MUST demote the incumbent and promote
   * the challenger in one transaction: two champions for a stage is a state the
   * loader cannot resolve, and it would resolve it by picking one.
   */
  promote(rowId: string, at: Millis, note: string): Promise<void>;
  /** Roll back: the named row becomes champion again. Same transaction rule. */
  rollback(toRowId: string, at: Millis, note: string): Promise<void>;
}

/**
 * The pure selector, so "which model was live" is answerable from a set of rows
 * with no database and no clock — which is what the replay harness needs.
 *
 * Throws on two champions rather than picking one. A registry with two live
 * models for one stage is a bug in the promotion transaction, and silently
 * choosing the newer would hide it for months.
 */
export function selectChampion(rows: readonly RegistryRow[], stage: StageName): RegistryRow | null {
  const live = rows.filter((r) => r.stage === stage && r.role === 'champion');
  if (live.length > 1) {
    throw new Error(
      `model registry has ${live.length} champions for stage "${stage}" ` +
        `(${live.map((r) => r.rowId).join(', ')}). Promotion must be transactional.`,
    );
  }
  return live[0] ?? null;
}

/**
 * The champion as of an instant, reconstructed from history. This is what makes
 * an old decision auditable: `decider` names the artefact, and this answers
 * "was that in fact the live model when the row was written".
 */
export function championAt(rows: readonly RegistryRow[], stage: StageName, at: Millis): RegistryRow | null {
  let best: RegistryRow | null = null;
  for (const r of rows) {
    if (r.stage !== stage) continue;
    if (r.promotedAt === null || r.promotedAt > at) continue;
    if (r.retiredAt !== null && r.retiredAt <= at) continue;
    if (best === null || r.promotedAt > (best.promotedAt ?? 0)) best = r;
  }
  return best;
}

/** Does this row's artefact match what the named stage will hand it? */
export function servesFeatureSet(row: RegistryRow, featureSet: FeatureSetId): boolean {
  return row.metadata.featureSet === featureSet;
}
