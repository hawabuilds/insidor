/**
 * A fresh, fully migrated Postgres in process (PGlite with pgvector), for the e2e tests.
 *
 * Shared so every test here runs the real migrations through the real migrator, and none of
 * them carries its own copy of how a database is opened.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';

import { migrate } from '@insidor/store';
import type { Db } from '@insidor/store';

type Pg = Pick<PGlite, 'query' | 'exec'>;

/** The store's Db over PGlite. A statement with no parameters may hold several, as a migration does. */
export function dbOf(pg: Pg): Db {
  return {
    query: async <R>(sql: string, params?: readonly unknown[]): Promise<R[]> => {
      if (params === undefined || params.length === 0) {
        const results = await pg.exec(sql);
        return (results.at(-1)?.rows ?? []) as R[];
      }
      const result = await pg.query<R>(sql, [...params]);
      return result.rows;
    },
  } as Db;
}

export async function migratedDb(): Promise<Db> {
  const pg = await PGlite.create({ extensions: { vector } });
  const db = dbOf(pg);
  await migrate(db, (fn) => pg.transaction((tx) => fn(dbOf(tx))));
  return db;
}
