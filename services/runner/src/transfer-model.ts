/**
 * THE MONTH'S DATABASE TRANSFER, ESTIMATED FROM THE HOURLY READ ROWS (internal.disk_sample.read_rows,
 * 0153) and Policy.store.transfer. Pure: the runner's alarm (disk-alarm.ts) calls it on the same rows
 * the disk and bill alerts read.
 *
 * ★ AN ESTIMATE, SAID AS ONE. The host counts the bytes that leave it; SQL can count only the rows
 * the statements returned. A row is `bytesPerRow` on the wire, measured on 29 Oct 2026 from the
 * columns' widths of the statements then running; when the reads change shape the true figure moves
 * and this does not, so the alert says "about" and names the rows it counted.
 *
 * ★ UNKNOWN HOURS ARE NOT ZERO. An hour with no sample, or a NULL (the runner's first hour after a
 * start, or before 0153), is filled with the average of the month's known hours; the rest of the
 * month is projected at the average of the last `recentHours` known hours, so a cut takes effect
 * in the projection within a day. With no known hour at all there is no projection (null).
 *
 * What breaks if changed carelessly: projecting at the month's average instead of the recent hours
 * keeps alarming for days after a cut; counting an unknown hour as zero hides a restart-heavy day.
 */

import type { StorePolicy } from '@insidor/contracts/policy.ts';

import { monthOf, type SizeSample } from './disk-model.ts';

const HOUR = 3_600_000;
/** The host's unit: 10⁹ bytes. */
export const TRANSFER_GB = 1e9;

export interface TransferProjection {
  readonly month: string;
  /** Hours of the month so far with a known count, and all hours so far. */
  readonly knownHours: number;
  readonly elapsedHours: number;
  /** Rows counted so far this month (known hours only). */
  readonly rowsSoFar: number;
  /** GB so far, unknown hours filled with the month's known average. */
  readonly gbSoFar: number;
  /** GB a day at the recent hours' rate. */
  readonly gbPerDay: number;
  /** The month's projected GB. */
  readonly projectedGb: number;
}

export function projectTransfer(samples: readonly SizeSample[], nowMs: number, p: StorePolicy['transfer']): TransferProjection | null {
  const now = new Date(nowMs);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const known = samples.filter((s) => s.atMs >= start && s.atMs < end && s.atMs <= nowMs && typeof s.readRows === 'number');
  if (known.length === 0) return null;
  /* Hours begun so far, the current one included: a sample is stamped with its hour's start. */
  const elapsedHours = Math.floor((Math.min(nowMs, end - 1) - start) / HOUR) + 1;
  const rowsSoFar = known.reduce((n, s) => n + (s.readRows as number), 0);
  const perHourMonth = rowsSoFar / known.length;
  const recent = known.slice(-p.recentHours);
  const perHourRecent = recent.reduce((n, s) => n + (s.readRows as number), 0) / recent.length;
  const gb = (rows: number) => (rows * p.bytesPerRow) / TRANSFER_GB;
  const gbSoFar = gb(rowsSoFar + perHourMonth * Math.max(0, elapsedHours - known.length));
  const remainingHours = Math.max(0, (end - start) / HOUR - elapsedHours);
  return {
    month: monthOf(nowMs),
    knownHours: known.length,
    elapsedHours,
    rowsSoFar,
    gbSoFar,
    gbPerDay: gb(perHourRecent * 24),
    projectedGb: gbSoFar + gb(perHourRecent * remainingHours),
  };
}
