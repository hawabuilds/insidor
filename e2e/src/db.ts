/**
 * A fresh, fully migrated Postgres in process (PGlite with pgvector, and pg_trgm for 0160's text index), for the e2e tests.
 *
 * Shared so every test here runs the real migrations through the real migrator, and none of
 * them carries its own copy of how a database is opened.
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

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
  const pg = await PGlite.create({ extensions: { vector, pg_trgm } });
  /* Supabase keeps extensions in their own schema; 0160 installs pg_trgm there. */
  await pg.exec('create schema if not exists extensions');
  const db = dbOf(pg);
  await migrate(db, (fn) => pg.transaction((tx) => fn(dbOf(tx))));
  return db;
}
