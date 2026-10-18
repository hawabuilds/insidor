/**
 * The database's size, sampled once an hour into internal.disk_sample (0105): the one reading the
 * owner's disk and bill alerts (services/runner disk-alarm.ts) and the 20:00 table share.
 *
 * Its own repository because the alarm and the report must replay the same rows, or the report
 * shows a disk size the alarm never inferred. The sizes are read and written in one place, so the
 * meaning of a NULL is decided once: the file buckets' size is NULL when this role may not read
 * storage.objects (a permission error, caught here and nowhere else), never 0.
 *
 * What breaks if changed carelessly: sampling something other than pg_database_size moves every
 * inferred disk size, since the host's grow rule is replayed on these numbers; and turning an
 * unreadable bucket size into 0 makes the bill say the file storage is free.
 */

import type { Db } from '../client.ts';

export interface DiskSample {
  /** The hour, truncated (UTC). */
  readonly atMs: number;
  readonly dbBytes: number;
  /** NULL: this role could not read the buckets. */
  readonly storageBytes: number | null;
}

export class PgDiskSampleRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** Reads the sizes now and writes this hour's row (the latest reading of an hour replaces the earlier). */
  async sample(): Promise<DiskSample> {
    const [size] = await this.#db.query<{ at: Date; db: string }>(
      `select date_trunc('hour', now() at time zone 'utc') at time zone 'utc' as at, pg_database_size(current_database())::text as db`,
    );
    if (size === undefined) throw new Error('pg_database_size returned no row');
    let storage: string | null = null;
    try {
      const [s] = await this.#db.query<{ bytes: string | null }>(`select coalesce(sum((metadata ->> 'size')::bigint), 0)::text as bytes from storage.objects`);
      storage = s?.bytes ?? null;
    } catch {
      /* No grant on storage.objects for this role (or no storage schema): unknown, not empty. */
      storage = null;
    }
    await this.#db.query(
      `insert into internal.disk_sample (at, db_bytes, storage_bytes) values ($1, $2, $3)
       on conflict (at) do update set db_bytes = excluded.db_bytes, storage_bytes = excluded.storage_bytes, sampled_at = now()`,
      [size.at, size.db, storage],
    );
    return { atMs: size.at.getTime(), dbBytes: Number(size.db), storageBytes: storage === null ? null : Number(storage) };
  }

  /** Every sample since `fromMs`, oldest first. The replay needs them all from the first, so callers pass 0 for the disk. */
  async since(fromMs: number): Promise<readonly DiskSample[]> {
    const rows = await this.#db.query<{ at: Date; db_bytes: string; storage_bytes: string | null }>(
      `select at, db_bytes::text, storage_bytes::text from internal.disk_sample where at >= $1 order by at`,
      [new Date(fromMs)],
    );
    return rows.map((r) => ({ atMs: r.at.getTime(), dbBytes: Number(r.db_bytes), storageBytes: r.storage_bytes === null ? null : Number(r.storage_bytes) }));
  }
}
