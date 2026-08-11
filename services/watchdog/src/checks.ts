/**
 * The four rules, as pure functions.
 *
 * Pure because a monitoring rule that can only be exercised against a live
 * broken system is a monitoring rule that gets tested by the outage it was
 * supposed to catch. These take a snapshot and a clock and return alerts; the
 * tests next door induce all four failures in about forty lines.
 *
 * The rules, and the specific failure each one exists for:
 *
 *   W1 stage stale       a stage whose last SUCCESSFUL run is older than 3× its
 *                        cadence. This is the seven-hour outage. Note it keys on
 *                        last SUCCESS, not last run: a stage erroring every
 *                        minute is producing rows, and a rule that looked at
 *                        "any run" would call that healthy.
 *   W2 run stuck         a run row open longer than ten minutes. This is the
 *                        killed-process case: `finished_at` stays NULL forever,
 *                        so the evidence is the absence of a close, which no
 *                        amount of log searching would surface.
 *   W3 coverage gap      a mint-coverage window wider than 180 seconds, whether
 *                        already recorded or still open right now. A gap is not
 *                        an error and nothing retries it — it is a statement
 *                        that lead time is unmeasurable for that window.
 *   W4 compression shift a stage whose items_in/items_out ratio moved more than
 *                        3× week over week. Nothing is down; the shape of the
 *                        funnel changed without anyone deciding to change it,
 *                        which is how a quietly-broken filter looks from outside.
 *
 * A stage that has NEVER succeeded is reported once, distinctly, rather than
 * being skipped. "It has not run since we deployed it" is a real outage and it
 * is the one a null-check would silently forgive.
 */

import type { Millis } from '@insidor/contracts';

import type { WatchSnapshot } from './snapshot.ts';

export type Severity = 'page' | 'warn';

export interface Alert {
  /** Stable across polls, so the same condition is not paged every minute. */
  readonly key: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
}

export interface Thresholds {
  /** A stage may miss this many of its own cadences before it is stale. */
  readonly staleCadences: number;
  /** A run open longer than this is presumed dead. */
  readonly maxOpenRunMs: number;
  /** A coverage window wider than this is worth waking someone for. */
  readonly maxGapMs: number;
  /** Week-over-week compression ratio move that counts as a shape change. */
  readonly compressionShiftFactor: number;
}

/** The numbers from the architecture's own monitoring section. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  staleCadences: 3,
  maxOpenRunMs: 600_000,
  maxGapMs: 180_000,
  compressionShiftFactor: 3,
};

function ms(n: number): string {
  return `${Math.round(n / 1000)}s`;
}

export function checkSnapshot(
  snap: WatchSnapshot,
  cadences: Readonly<Record<string, number>>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): readonly Alert[] {
  const now = snap.takenAt;
  const alerts: Alert[] = [];

  /* W1 — a stage that has stopped succeeding. */
  for (const stage of snap.stages) {
    const cadence = cadences[stage.stage];
    if (cadence === undefined) {
      // The watchdog is TOLD the cadences rather than importing them, because
      // importing them would couple it to the process it watches. The cost of
      // that independence is this branch: an unknown stage is reported, not
      // ignored, or a renamed stage would silently stop being monitored.
      alerts.push({
        key: `W1-unknown:${stage.stage}`,
        severity: 'warn',
        title: `unmonitored stage '${stage.stage}'`,
        detail: 'this stage is writing runs but no cadence was configured for it',
      });
      continue;
    }

    if (stage.lastSuccessAt === null) {
      alerts.push({
        key: `W1-never:${stage.stage}`,
        severity: 'page',
        title: `stage '${stage.stage}' has never succeeded`,
        detail: `last outcome ${stage.lastOutcome ?? 'none'}; no successful run on record`,
      });
      continue;
    }

    const silent = now - stage.lastSuccessAt;
    if (silent > thresholds.staleCadences * cadence) {
      alerts.push({
        key: `W1:${stage.stage}`,
        severity: 'page',
        title: `stage '${stage.stage}' is stale`,
        detail:
          `no successful run for ${ms(silent)} against a ${ms(cadence)} cadence ` +
          `(last outcome ${stage.lastOutcome ?? 'unknown'})`,
      });
    }
  }

  /* W2 — a run that was opened and never closed. */
  for (const run of snap.openRuns) {
    const openFor = now - run.startedAt;
    if (openFor > thresholds.maxOpenRunMs) {
      alerts.push({
        key: `W2:${run.runId}`,
        severity: 'page',
        title: `run ${run.runId} on '${run.stage}' has been open ${ms(openFor)}`,
        detail: `host ${run.host}; a run row that never closes means the process was killed`,
      });
    }
  }

  /* W3 — coverage we cannot vouch for: already recorded, or open right now. */
  for (const gap of snap.recentGaps) {
    const width = gap.toMs - gap.fromMs;
    if (width > thresholds.maxGapMs) {
      alerts.push({
        key: `W3:${gap.feedId}:${gap.fromMs}`,
        severity: 'page',
        title: `mint coverage gap of ${ms(width)} on '${gap.feedId}'`,
        detail: `kind ${gap.kind}; lead time is unmeasurable for this window, not negative`,
      });
    }
  }

  for (const feed of snap.feeds) {
    if (feed.lastSuccessAt === null) {
      alerts.push({
        key: `W3-never:${feed.feedId}`,
        severity: 'page',
        title: `feed '${feed.feedId}' has never read successfully`,
        detail: 'there is no coverage at all for this feed',
      });
      continue;
    }
    const openFor = now - feed.lastSuccessAt;
    if (openFor > thresholds.maxGapMs) {
      alerts.push({
        key: `W3-open:${feed.feedId}`,
        severity: 'page',
        title: `feed '${feed.feedId}' has not read for ${ms(openFor)}`,
        detail: 'the gap is still open; every mint in it is being lost as it happens',
      });
    }
  }

  /* W4 — the funnel changed shape without a deploy. */
  for (const row of snap.compression) {
    const { thisWeek, lastWeek } = row;
    if (thisWeek === null || lastWeek === null) continue;
    if (thisWeek <= 0 || lastWeek <= 0) continue;
    const factor = thisWeek > lastWeek ? thisWeek / lastWeek : lastWeek / thisWeek;
    if (factor > thresholds.compressionShiftFactor) {
      alerts.push({
        key: `W4:${row.stage}`,
        severity: 'warn',
        title: `stage '${row.stage}' compression moved ${factor.toFixed(1)}×`,
        detail: `${lastWeek.toFixed(2)} last week vs ${thisWeek.toFixed(2)} this week`,
      });
    }
  }

  return alerts;
}

/**
 * De-duplication. An alert that fires every 60 seconds is an alert people turn
 * off, and an alert people turned off is worse than one that never existed.
 * Conditions re-page only after `repeatAfterMs`, and clearing one emits a
 * recovery so the channel says when it ended, not only when it started.
 */
export interface AlertGate {
  /** Returns what should actually be sent this round. */
  admit(alerts: readonly Alert[], now: Millis): readonly Alert[];
  /** Alerts that were firing and are not any more. */
  recovered(alerts: readonly Alert[], now: Millis): readonly string[];
}

export function createAlertGate(repeatAfterMs: number): AlertGate {
  const firing = new Map<string, Millis>();

  return {
    admit(alerts, now) {
      const out: Alert[] = [];
      for (const a of alerts) {
        const sentAt = firing.get(a.key);
        if (sentAt === undefined || now - sentAt >= repeatAfterMs) {
          firing.set(a.key, now);
          out.push(a);
        }
      }
      return out;
    },

    recovered(alerts, _now) {
      const live = new Set(alerts.map((a) => a.key));
      const cleared: string[] = [];
      for (const key of [...firing.keys()]) {
        if (!live.has(key)) {
          firing.delete(key);
          cleared.push(key);
        }
      }
      return cleared;
    },
  };
}
