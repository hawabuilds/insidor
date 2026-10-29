/**
 * THE DATABASE HOST'S DISK AND BILL, MODELLED FROM THE HOURLY SIZE SAMPLES (internal.disk_sample,
 * 0105) and Policy.store. Pure: the runner's alarm (disk-alarm.ts) and the 20:00 table
 * (tools/name-report.ts) call the same functions on the same rows.
 *
 * ★ THE PROVISIONED DISK IS REPLAYED, NOT STORED. SQL cannot read it, so it is the host's own rule
 * run over the samples from the first: start at `provisionedGb`, and wherever a sample reaches
 * `growAt` of the disk (and the last grow is `growGapMs` back, and fewer than `growsPerDay` in the
 * day) the disk becomes `growBy` times larger. A restart, a missed hour or a deploy replays to the
 * same answer. It is an inference: the host measures the whole disk (the write-ahead log and its own
 * files too), and grows only when the spend cap is off, so the real disk may grow earlier than this
 * says, or not at all if the cap is turned back on.
 *
 * ★ THE BILL IS THE PROVISIONED DISK'S, HOUR BY HOUR. The host bills the disk it has provisioned,
 * not what is used, prorated by the hours spent at each size; so the month is summed hour by hour,
 * the past from the replay and the rest of the month from the last sample grown at the measured
 * rate (the same grow rule applied as it goes). The plan and compute are flat for the month.
 * Unknowns stay unknown: file storage the role cannot read is `null`, never $0, and egress is not
 * modelled at all (no SQL reads it) — callers say both.
 *
 * What breaks if changed carelessly: replaying from anywhere but the first sample loses every grow
 * before it and under-bills the disk; projecting the month at today's size instead of growing it
 * misses a grow due before month end, which is exactly the bill the owner asked to hear about.
 */

import type { StorePolicy } from '@insidor/contracts/policy.ts';

export const GB = 1024 ** 3;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export interface SizeSample {
  readonly atMs: number;
  readonly dbBytes: number;
  readonly storageBytes: number | null;
  /** Rows read in the hour (0153; transfer-model.ts). Absent or null: unknown. */
  readonly readRows?: number | null;
}

export interface DiskGrow {
  readonly atMs: number;
  readonly fromGb: number;
  readonly toGb: number;
}

export interface DiskCrossing {
  readonly atMs: number;
  readonly provisionedGb: number;
  /** Usage over the provisioned disk at the crossing sample. */
  readonly share: number;
}

export interface DiskReplay {
  readonly grows: readonly DiskGrow[];
  readonly crossings: readonly DiskCrossing[];
  /** The disk now, by the replay. */
  readonly provisionedGb: number;
  /** The latest sample, or null with none. */
  readonly last: SizeSample | null;
  /** The latest sample's share of the disk now. */
  readonly share: number | null;
}

/** Whether the host may grow the disk at `atMs`, given the grows so far. */
function mayGrow(grows: readonly { atMs: number }[], atMs: number, p: StorePolicy['disk']): boolean {
  const prev = grows.at(-1);
  if (prev !== undefined && atMs - prev.atMs < p.growGapMs) return false;
  return grows.filter((g) => atMs - g.atMs < DAY).length < p.growsPerDay;
}

/** The host's grow rule and the owner's 80% crossings, over every sample oldest first. */
export function replayDisk(samples: readonly SizeSample[], p: StorePolicy['disk']): DiskReplay {
  let gb = p.provisionedGb;
  const grows: DiskGrow[] = [];
  const crossings: DiskCrossing[] = [];
  let over = false;
  for (const s of samples) {
    if (s.dbBytes >= p.growAt * gb * GB && mayGrow(grows, s.atMs, p)) {
      const to = gb * p.growBy;
      grows.push({ atMs: s.atMs, fromGb: gb, toGb: to });
      gb = to;
    }
    const share = s.dbBytes / (gb * GB);
    if (!over && share >= p.alertAt) {
      over = true;
      crossings.push({ atMs: s.atMs, provisionedGb: gb, share });
    } else if (over && share < p.rearmBelow) over = false;
  }
  const last = samples.at(-1) ?? null;
  return { grows, crossings, provisionedGb: gb, last, share: last === null ? null : last.dbBytes / (gb * GB) };
}

export interface Growth {
  readonly bytesPerDay: number;
  /** How much history the rate is read over (shorter than `growthDays` while samples are new). */
  readonly spanMs: number;
}

/** Bytes a day over the last `days`, from the oldest sample in it to the latest; null under six hours of samples. */
export function growthOf(samples: readonly SizeSample[], days: number, pick: (s: SizeSample) => number | null = (s) => s.dbBytes): Growth | null {
  const known = samples.filter((s) => pick(s) !== null);
  const last = known.at(-1);
  if (last === undefined) return null;
  const first = known.find((s) => s.atMs >= last.atMs - days * DAY);
  if (first === undefined || last.atMs - first.atMs < 6 * HOUR) return null;
  const spanMs = last.atMs - first.atMs;
  return { bytesPerDay: (((pick(last) ?? 0) - (pick(first) ?? 0)) * DAY) / spanMs, spanMs };
}

export interface BillProjection {
  /** "2026-10", UTC. */
  readonly month: string;
  readonly planUsd: number;
  readonly computeUsd: number;
  readonly computeConfirmed: boolean;
  readonly diskUsd: number;
  /** null: file storage could not be read. */
  readonly storageUsd: number | null;
  /** Plan + compute + disk + storage where known. Egress is not in it. */
  readonly totalUsd: number;
  /** The disk at month end, and grows the projection expects before then. */
  readonly diskEndGb: number;
  readonly grows: readonly DiskGrow[];
  /** The rate the rest of the month was grown at; null: no rate yet, held flat. */
  readonly dbBytesPerDay: number | null;
}

export const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

/** This UTC month's bill, the past from the samples and the rest projected. */
export function projectBill(samples: readonly SizeSample[], nowMs: number, p: StorePolicy): BillProjection {
  const now = new Date(nowMs);
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const monthHours = (end - start) / HOUR;
  const replay = replayDisk(samples, p.disk);
  const db = growthOf(samples, p.disk.growthDays);
  const files = growthOf(samples, p.disk.growthDays, (s) => s.storageBytes);
  const filed = samples.flatMap((s) => (s.storageBytes === null ? [] : [{ atMs: s.atMs, bytes: s.storageBytes }]));
  const lastFiles = filed.at(-1) ?? null;

  const grows: DiskGrow[] = [...replay.grows];
  const projected: DiskGrow[] = [];
  let diskGbHours = 0;
  let filesGbHours = 0;
  let gb = p.disk.provisionedGb;
  let g = 0;
  let f = 0;
  for (let t = start; t < end; t += HOUR) {
    if (t <= nowMs || replay.last === null) {
      for (let next = replay.grows[g]; next !== undefined && next.atMs <= t; next = replay.grows[++g]) gb = next.toGb;
    } else {
      const used = replay.last.dbBytes + ((db?.bytesPerDay ?? 0) * (t - replay.last.atMs)) / DAY;
      if (used >= p.disk.growAt * gb * GB && mayGrow(grows, t, p.disk)) {
        const grow = { atMs: t, fromGb: gb, toGb: gb * p.disk.growBy };
        grows.push(grow);
        projected.push(grow);
        gb = grow.toGb;
      }
    }
    diskGbHours += Math.max(0, gb - p.bill.diskIncludedGb);
    if (lastFiles !== null) {
      /* The files' size at the hour: the latest reading by then (the first, before any was taken),
         and past the last reading, grown at the measured rate. */
      for (let next = filed[f + 1]; next !== undefined && next.atMs <= t; next = filed[++f + 1]);
      const bytes = t > lastFiles.atMs ? lastFiles.bytes + ((files?.bytesPerDay ?? 0) * (t - lastFiles.atMs)) / DAY : (filed[f]?.bytes ?? lastFiles.bytes);
      filesGbHours += Math.max(0, bytes / GB - p.bill.storageIncludedGb);
    }
  }
  const diskUsd = (diskGbHours / monthHours) * p.bill.diskUsdPerGbMonth;
  const storageUsd = lastFiles === null ? null : (filesGbHours / monthHours) * p.bill.storageUsdPerGbMonth;
  return {
    month: monthOf(nowMs),
    planUsd: p.bill.planUsd,
    computeUsd: p.bill.computeNetUsd,
    computeConfirmed: p.bill.computeConfirmed,
    diskUsd,
    storageUsd,
    totalUsd: p.bill.planUsd + p.bill.computeNetUsd + diskUsd + (storageUsd ?? 0),
    diskEndGb: gb,
    grows: projected,
    dbBytesPerDay: db?.bytesPerDay ?? null,
  };
}

/** "$75.00 = plan $25 + compute $50 (to confirm) + disk $0.00 + files $0.00; egress not counted". */
export function billParts(b: BillProjection): string {
  const usd = (x: number) => `$${x.toFixed(2)}`;
  return `${usd(b.totalUsd)} = plan ${usd(b.planUsd)} + compute ${usd(b.computeUsd)}${b.computeConfirmed ? '' : ' (assumed, to confirm)'} + disk ${usd(b.diskUsd)} + files ${b.storageUsd === null ? 'unknown (not readable)' : usd(b.storageUsd)}; egress not counted`;
}
