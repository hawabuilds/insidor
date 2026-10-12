/**
 * The balance chart's points and its change, apart from the chart so `node --test` holds them.
 * Trador's `balancePointsWithLive` and `balanceChangeForRange`.
 */

export interface BalancePoint {
  readonly t: number;
  readonly value: number;
}

/** The chart's points: the stored ones, then the live total now, as Trador draws them. */
export function withLive(points: readonly BalancePoint[], live: number | null, now: number): readonly BalancePoint[] {
  if (live === null || !Number.isFinite(live)) return points;
  return [...points.filter((p) => p.t < now), { t: now, value: live }];
}

/** The window's change, first point to the live total, in percent; null with fewer than two points. */
export function windowChange(points: readonly BalancePoint[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || first === undefined || last === undefined || first.value <= 0) return null;
  return ((last.value - first.value) / first.value) * 100;
}
