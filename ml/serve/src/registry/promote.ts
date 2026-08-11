/**
 * The promotion gates: what must be true before a challenger becomes champion.
 *
 * WHY GATES RATHER THAN A CHECKLIST: promotion is a one-line UPDATE, which is
 * the feature — and which means the only thing standing between a bad model and
 * production is whoever typed it at 1am. So the conditions are a pure function
 * returning named failures, callable from a script, a test and a CI job, and the
 * promote path refuses to run when any of them fails.
 *
 * Every gate here corresponds to a specific way this project has already been
 * wrong, or to a specific way the tree walker is known to fail silently. None of
 * them is a style preference.
 *
 * There are NO numeric literals in this file. Thresholds arrive as a
 * PromotionPolicy the caller reads off Policy, for the same reason every other
 * threshold in the system lives in one frozen object: "every threshold is a
 * number somebody typed somewhere" is the finding that made the last six months
 * unauditable.
 */

import type { Millis } from '@insidor/contracts';
import type { RegistryRow } from './registry.ts';

export const PROMOTION_GATES = [
  'M1_not_a_challenger',
  'M2_stage_mismatch',
  'M3_feature_set_changed',
  'M4_feature_hash_changed',
  'M5_artefact_sha_mismatch',
  'M6_parity_missing',
  'M7_parity_error_too_large',
  'M8_shadowed_too_briefly',
  'M9_population_undeclared',
  'M10_training_window_stale',
  'M11_too_few_rows',
  'M12_too_few_positives',
  'M13_trainer_unconstrained',
  'M14_dataset_sql_unrecorded',
] as const;

export type PromotionGate = (typeof PROMOTION_GATES)[number];

export interface PromotionPolicy {
  /** Days a challenger must shadow-score before it may be promoted. */
  readonly minShadowDays: number;
  /** Max |TypeScript − Python| over the parity fixture. The split's justification. */
  readonly maxParityError: number;
  /** Minimum rows in the parity fixture, so "0 rows, 0 error" cannot pass. */
  readonly minParityRows: number;
  /** Max age of the training window's end, in days, at promotion time. */
  readonly maxTrainingWindowAgeDays: number;
  readonly minTrainingRows: number;
  readonly minTrainingPositives: number;
}

export interface PromotionContext {
  readonly now: Millis;
  readonly policy: PromotionPolicy;
  /**
   * sha256 of the artefact bytes actually fetched from `artefactUri`, computed
   * by the caller. The registry row records what was published; this is what is
   * on disk now. They disagree when a bucket was overwritten in place.
   */
  readonly fetchedArtefactSha256: string;
}

export interface PromotionFailure {
  readonly gate: PromotionGate;
  readonly detail: string;
}

export interface PromotionCheck {
  readonly ok: boolean;
  readonly failures: readonly PromotionFailure[];
  /** Null when this would be the first champion for the stage — legal, and noted. */
  readonly replacing: string | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Every failure, not the first. A promotion attempt that reports one problem at
 * a time turns a five-minute check into five round trips through a training run.
 */
export function checkPromotion(
  challenger: RegistryRow,
  champion: RegistryRow | null,
  ctx: PromotionContext,
): PromotionCheck {
  const f: PromotionFailure[] = [];
  const m = challenger.metadata;
  const p = ctx.policy;

  if (challenger.role !== 'challenger') {
    f.push({ gate: 'M1_not_a_challenger', detail: `role is "${challenger.role}"` });
  }

  if (champion !== null && champion.stage !== challenger.stage) {
    f.push({
      gate: 'M2_stage_mismatch',
      detail: `challenger serves "${challenger.stage}", incumbent serves "${champion.stage}"`,
    });
  }

  // A model may only replace one that reads the same vector. Otherwise the
  // decision log's `features` column stops being comparable across the swap and
  // every before/after query silently mixes two populations.
  if (champion !== null) {
    if (m.featureSet !== champion.metadata.featureSet) {
      f.push({
        gate: 'M3_feature_set_changed',
        detail: `"${champion.metadata.featureSet}" → "${m.featureSet}"; ` +
          'ship the feature set first, let it accrue rows, then promote a model that reads it',
      });
    } else if (m.featureHash !== champion.metadata.featureHash) {
      f.push({
        gate: 'M4_feature_hash_changed',
        detail:
          `same feature set "${m.featureSet}" but a different key list ` +
          `(${champion.metadata.featureHash.slice(0, 12)} → ${m.featureHash.slice(0, 12)}). ` +
          'A feature was added, removed or renamed without a version bump.',
      });
    }
  }

  if (m.artefactSha256 !== ctx.fetchedArtefactSha256) {
    f.push({
      gate: 'M5_artefact_sha_mismatch',
      detail: `row records ${m.artefactSha256.slice(0, 12)}, the fetched bytes hash to ${ctx.fetchedArtefactSha256.slice(0, 12)}`,
    });
  }

  // The parity fixture is the entire justification for allowing a second
  // language. Without it, do not split — so without it, do not promote.
  if (m.parity === null) {
    f.push({
      gate: 'M6_parity_missing',
      detail: 'no parity fixture; the TypeScript walker has never been compared to LightGBM on this model',
    });
  } else {
    if (m.parity.rows < p.minParityRows) {
      f.push({
        gate: 'M6_parity_missing',
        detail: `parity fixture has ${m.parity.rows} rows, minimum ${p.minParityRows}`,
      });
    }
    if (!(m.parity.maxAbsError <= p.maxParityError)) {
      f.push({
        gate: 'M7_parity_error_too_large',
        detail: `max |ts − py| = ${m.parity.maxAbsError}, limit ${p.maxParityError}`,
      });
    }
  }

  const shadowed = challenger.shadowingSince;
  if (shadowed === null) {
    f.push({ gate: 'M8_shadowed_too_briefly', detail: 'never shadow-scored' });
  } else {
    const days = (ctx.now - shadowed) / MS_PER_DAY;
    if (days < p.minShadowDays) {
      f.push({
        gate: 'M8_shadowed_too_briefly',
        detail: `shadowed ${days.toFixed(2)} days, minimum ${p.minShadowDays}`,
      });
    }
  }

  if (m.population.trim().length === 0) {
    f.push({ gate: 'M9_population_undeclared', detail: 'population is blank' });
  }

  const windowAgeDays = (ctx.now - m.trainingWindow.toMs) / MS_PER_DAY;
  if (windowAgeDays > p.maxTrainingWindowAgeDays) {
    f.push({
      gate: 'M10_training_window_stale',
      detail: `training window ended ${windowAgeDays.toFixed(1)} days ago, limit ${p.maxTrainingWindowAgeDays}`,
    });
  }

  if (m.rowCount < p.minTrainingRows) {
    f.push({ gate: 'M11_too_few_rows', detail: `${m.rowCount} rows, minimum ${p.minTrainingRows}` });
  }
  if (m.positiveCount < p.minTrainingPositives) {
    f.push({
      gate: 'M12_too_few_positives',
      detail: `${m.positiveCount} positives, minimum ${p.minTrainingPositives}`,
    });
  }

  // The three trainer constraints the walker depends on. The walker also refuses
  // such a model at load, but a promotion that fails here fails at 10am on a
  // laptop instead of at 3am in the runner.
  if (m.categoricalFeatures !== 0 || m.linearTree) {
    f.push({
      gate: 'M13_trainer_unconstrained',
      detail:
        `categoricalFeatures=${m.categoricalFeatures}, linearTree=${String(m.linearTree)}; ` +
        'both must be zero/false — the walker implements neither and would be wrong by ~0.9 in probability space',
    });
  }

  if (m.datasetSql.sha256.length === 0 || m.datasetSql.path.length === 0) {
    f.push({
      gate: 'M14_dataset_sql_unrecorded',
      detail: 'the training query and its sha must be recorded, or the training set is unreproducible',
    });
  }

  return { ok: f.length === 0, failures: f, replacing: champion?.rowId ?? null };
}

/** A one-line summary for the promotion script's output and the registry note. */
export function describePromotion(check: PromotionCheck): string {
  if (check.ok) {
    return check.replacing === null ? 'ok — first champion for this stage' : `ok — replaces ${check.replacing}`;
  }
  return check.failures.map((x) => `${x.gate}: ${x.detail}`).join('\n');
}
