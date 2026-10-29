/**
 * The database's size, sampled once an hour into internal.disk_sample (0105): the one reading the
 * owner's disk and bill alerts (services/runner disk-alarm.ts) and the 20:00 table share.
 *
 * Its own repository because the alarm and the report must replay the same rows, or the report
 * shows a disk size the alarm never inferred. The sizes are read and written in one place, so the
 * meaning of a NULL is decided once: the file buckets' size is NULL when this role may not read
 * storage.objects (a permission error, caught here and nowhere else), never 0.
 *
 * ★ AND THE ROWS READ SINCE THE LAST SAMPLE (0153, the transfer alert): pg_stat_statements is read
 * whole and each read statement's `rows` is subtracted from what this repo read last time, statement
 * by statement; a statement new since then counts whole (it entered within the interval, or was
 * evicted and came back). Only a positive difference counts, so a reset or an eviction never lowers
 * the hour. The first sample after a start has nothing to subtract and stores NULL: unknown, not 0.
 *
 * What breaks if changed carelessly: sampling something other than pg_database_size moves every
 * inferred disk size, since the host's grow rule is replayed on these numbers; and turning an
 * unreadable bucket size into 0 makes the bill say the file storage is free. One repo must live for
 * the process (the runner's wiring makes one): a new repo each sample would store NULL every hour.
 */

import type { Db } from '../client.ts';

export interface DiskSample {
  /** The hour, truncated (UTC). */
  readonly atMs: number;
  readonly dbBytes: number;
  /** NULL: this role could not read the buckets. */
  readonly storageBytes: number | null;
  /** Rows the read statements returned since the previous sample (0153). NULL: unknown, never zero. */
  readonly readRows: number | null;
}

const UNDEFINED_COLUMN = '42703';
/** A statement that writes: its `rows` are rows written, not sent. Anything else (a hidden text included) counts as a read. */
const WRITE = /^\s*(insert|update|delete|merge|copy|create|alter|drop|truncate|vacuum|analyze|grant|revoke|refresh|set|begin|commit|rollback|savepoint|release|lock|listen|notify)\b/i;

export class PgDiskSampleRepo {
  readonly #db: Db;
  /** Each statement's cumulative rows at the previous sample, by queryid and role; null before the first. */
  #lastRows: Map<string, number> | null = null;

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
    const readRows = await this.#readRowsSinceLast();
    try {
      /* A second sample in the same hour adds its rows to the first's: each counts its own interval. */
      await this.#db.query(
        `insert into internal.disk_sample (at, db_bytes, storage_bytes, read_rows) values ($1, $2, $3, $4)
         on conflict (at) do update set db_bytes = excluded.db_bytes, storage_bytes = excluded.storage_bytes, sampled_at = now(),
           read_rows = case when internal.disk_sample.read_rows is null then excluded.read_rows
                            when excluded.read_rows is null then internal.disk_sample.read_rows
                            else internal.disk_sample.read_rows + excluded.read_rows end`,
        [size.at, size.db, storage, readRows],
      );
    } catch (e) {
      /* Before 0153: the size alone, as before. */
      if ((e as { code?: unknown }).code !== UNDEFINED_COLUMN) throw e;
      await this.#db.query(
        `insert into internal.disk_sample (at, db_bytes, storage_bytes) values ($1, $2, $3)
         on conflict (at) do update set db_bytes = excluded.db_bytes, storage_bytes = excluded.storage_bytes, sampled_at = now()`,
        [size.at, size.db, storage],
      );
    }
    return { atMs: size.at.getTime(), dbBytes: Number(size.db), storageBytes: storage === null ? null : Number(storage), readRows };
  }

  /** The rows read statements returned since the previous call; null on the first call or without access. */
  async #readRowsSinceLast(): Promise<number | null> {
    let rows: { id: string; q: string | null; n: string }[];
    try {
      rows = await this.#db.query<{ id: string; q: string | null; n: string }>(
        `select queryid::text || '/' || userid::text || '/' || dbid::text as id, left(query, 40) as q, rows::text as n from pg_stat_statements`,
      );
    } catch {
      /* No extension or no access: unknown. */
      this.#lastRows = null;
      return null;
    }
    const now = new Map<string, number>();
    for (const r of rows) if (r.q === null || !WRITE.test(r.q)) now.set(r.id, Number(r.n));
    const last = this.#lastRows;
    this.#lastRows = now;
    if (last === null) return null;
    let sum = 0;
    for (const [id, n] of now) sum += Math.max(0, n - (last.get(id) ?? 0));
    return sum;
  }

  /** Every sample since `fromMs`, oldest first. The replay needs them all from the first, so callers pass 0 for the disk. */
  async since(fromMs: number): Promise<readonly DiskSample[]> {
    let rows: { at: Date; db_bytes: string; storage_bytes: string | null; read_rows: string | null }[];
    try {
      rows = await this.#db.query<{ at: Date; db_bytes: string; storage_bytes: string | null; read_rows: string | null }>(
        `select at, db_bytes::text, storage_bytes::text, read_rows::text from internal.disk_sample where at >= $1 order by at`,
        [new Date(fromMs)],
      );
    } catch (e) {
      /* Before 0153: every hour's reads are unknown. */
      if ((e as { code?: unknown }).code !== UNDEFINED_COLUMN) throw e;
      rows = (
        await this.#db.query<{ at: Date; db_bytes: string; storage_bytes: string | null }>(
          `select at, db_bytes::text, storage_bytes::text from internal.disk_sample where at >= $1 order by at`,
          [new Date(fromMs)],
        )
      ).map((r) => ({ ...r, read_rows: null }));
    }
    return rows.map((r) => ({ atMs: r.at.getTime(), dbBytes: Number(r.db_bytes), storageBytes: r.storage_bytes === null ? null : Number(r.storage_bytes), readRows: r.read_rows === null ? null : Number(r.read_rows) }));
  }
}
