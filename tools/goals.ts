/**
 * `node --env-file=.env.local --experimental-strip-types tools/goals.ts [--days 7]`
 *
 * THE GOALS SCORECARD ON ITS OWN: the same section the 20:00 report opens with (tools/lib/goals.ts),
 * printed without the rest of the report. Read-only: one connection inside a read-only transaction,
 * so nothing here can write even by mistake. Free: stored rows only.
 *
 * Its own file so the scorecard can be checked between reports without running every other
 * section; the arithmetic and the SQL live in the lib, so the two can never disagree.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { goalSection } from './lib/goals.ts';

const i = process.argv.indexOf('--days');
const days = i < 0 ? 7 : Math.max(1, Number(process.argv[i + 1]) || 7);
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-goals', max: 1 });
const client = await pool.connect();
try {
  await client.query('begin read only');
  for (const line of await goalSection(asDb(client), Date.now(), days)) console.log(line);
  await client.query('rollback');
} finally {
  client.release();
  await pool.end();
}
