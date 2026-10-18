/**
 * THE DATABASE DISK AND BILL LINES OF THE 20:00 TABLE (the owner, 2026-10-18): the database's size,
 * the disk the host's grow rule says it has, the share used, growth per day over the policy's days,
 * and the month's projected bill with its parts.
 *
 * The runner's own model (services/runner disk-model.ts) on the runner's own samples
 * (internal.disk_sample, 0105), so the table shows what the alarm will act on. Read-only: the size
 * now is read live and added as the latest point for the table only, never written, so the report
 * says today's number even before the runner's first hourly sample.
 *
 * What breaks if changed carelessly: computing the disk or bill here instead of calling the model
 * shows a number the alarm never sees; dropping the "assumed" and "not counted" words turns two
 * guesses into facts.
 */

import type { StorePolicy } from '../../contracts/src/policy.ts';
import { billParts, GB, growthOf, projectBill, replayDisk, type SizeSample } from '../../services/runner/src/disk-model.ts';
import { PgDiskSampleRepo, type Db } from '../../store/src/index.ts';

export async function diskBillLines(db: Db, nowMs: number, p: StorePolicy): Promise<readonly string[]> {
  const stored = await new PgDiskSampleRepo(db).since(0).catch(() => [] as readonly SizeSample[]);
  const [live] = await db.query<{ db: string }>(`select pg_database_size(current_database())::text as db`);
  const files = await db
    .query<{ bytes: string }>(`select coalesce(sum((metadata ->> 'size')::bigint), 0)::text as bytes from storage.objects`)
    .then((r) => (r[0] === undefined ? null : Number(r[0].bytes)))
    .catch(() => null);
  const samples: SizeSample[] = [...stored];
  if (live !== undefined && (samples.at(-1)?.atMs ?? 0) < nowMs) samples.push({ atMs: nowMs, dbBytes: Number(live.db), storageBytes: files });
  const last = samples.at(-1);
  if (last === undefined) return ['- No size could be read.'];
  const r = replayDisk(samples, p.disk);
  const g = growthOf(samples, p.disk.growthDays);
  const bill = projectBill(samples, nowMs, p);
  const gb = (b: number) => `${(b / GB).toFixed(2)} GB`;
  const days = g === null ? null : g.spanMs / 86_400_000;
  return [
    `- Database ${gb(last.dbBytes)} (pg_database_size; the write-ahead log and the host's own files are not counted, so the disk is fuller). Files in buckets ${last.storageBytes === null ? 'unknown (not readable by this role)' : gb(last.storageBytes)}.`,
    `- Disk ${r.provisionedGb} GB, inferred from the grow rule (${Math.round(p.disk.growAt * 100)}% full, x${p.disk.growBy}) over ${stored.length} hourly samples${r.grows.length === 0 ? '' : `; grew ${r.grows.map((x) => `${x.fromGb}→${x.toGb} GB ${new Date(x.atMs).toISOString().slice(0, 13)}h`).join(', ')}`}. ${r.share === null ? '' : `${Math.round(r.share * 100)}% used`} (alert at ${Math.round(p.disk.alertAt * 100)}%).`,
    `- Growth: ${g === null ? `— (under six hours of samples)` : `${(g.bytesPerDay / GB).toFixed(3)} GB a day over the last ${days !== null && days >= p.disk.growthDays ? `${p.disk.growthDays} days` : `${days?.toFixed(1)} days of samples`}`}.`,
    `- Bill ${bill.month}, projected: ${billParts(bill)}. Disk at month end ${bill.diskEndGb} GB${bill.grows.length === 0 ? '' : ` (grows expected: ${bill.grows.map((x) => `${x.toGb} GB ${new Date(x.atMs).toISOString().slice(0, 10)}`).join(', ')})`}${bill.dbBytesPerDay === null ? '; no growth rate yet, held flat' : ''}. Alert over $${p.bill.alertOverUsd}: ${bill.totalUsd > p.bill.alertOverUsd ? 'OVER' : 'under'}.`,
  ];
}
