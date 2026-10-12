/**
 * The latest copy of each file a hosted one-off job writes (0045), so its progress and results
 * outlive the container it ran in.
 *
 * Separate from every other repo because these rows are files, not facts: nothing here is read by
 * a surface or a decision, only by tools/jobs.ts to resume and by a person pulling results back.
 *
 * What breaks if changed carelessly: `put` replaces the whole body. Appending, or keeping only
 * what changed, would let a resumed job read a file stitched from two runs.
 */

import type { Db } from '../client.ts';

export interface JobFile {
  readonly path: string;
  readonly body: string;
  readonly savedAt: Date;
}

export class PgJobFileRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async put(path: string, body: string): Promise<void> {
    await this.#db.query(
      `insert into internal.job_file (path, body, saved_at) values ($1, $2, now())
       on conflict (path) do update set body = excluded.body, saved_at = excluded.saved_at`,
      [path, body],
    );
  }

  async get(path: string): Promise<JobFile | null> {
    const rows = await this.#db.query<{ path: string; body: string; saved_at: Date }>(
      'select path, body, saved_at from internal.job_file where path = $1',
      [path],
    );
    const row = rows[0];
    return row === undefined ? null : { path: row.path, body: row.body, savedAt: row.saved_at };
  }

  async list(): Promise<readonly { readonly path: string; readonly bytes: number; readonly savedAt: Date }[]> {
    const rows = await this.#db.query<{ path: string; bytes: number; saved_at: Date }>(
      'select path, octet_length(body) as bytes, saved_at from internal.job_file order by path',
    );
    return rows.map((r) => ({ path: r.path, bytes: Number(r.bytes), savedAt: r.saved_at }));
  }
}
