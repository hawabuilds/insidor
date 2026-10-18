/**
 * `node --env-file=.env.local --experimental-strip-types tools/scorecard.ts [--days <n>] [--until <iso>] [--json]`
 *
 * THE SCORECARD, on its own (the owner, 2026-10-18): the six numbers we are measured on, for the
 * last `--days` (default 3) to `--until` (default now), each UTC day and the whole window, as the
 * table the 20:00 number table prints (tools/name-report.ts), and the memeable viral funnel after it
 * (tools/lib/funnel.ts). `--json` prints the scorecard's numbers instead.
 * Free and read-only: stored rows only.
 *
 * What each number means, and what it cannot see, is tools/lib/scorecard.ts; this file only reads
 * the arguments, so a definition changed there changes both reports.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { funnelLines, funnelRows } from './lib/funnel.ts';
import { scorecardRows, scorecards, scorecardTable } from './lib/scorecard.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? '3');
const untilArg = arg('--until');
const until = untilArg === null ? new Date() : new Date(untilArg);
const since = new Date(until.getTime() - days * 86_400_000);
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-scorecard' });
try {
  const cards = scorecards(await scorecardRows(asDb(pool), since, until), since, until);
  if (process.argv.includes('--json')) console.log(JSON.stringify(cards, null, 2));
  else {
    console.log(`Scorecard, ${since.toISOString().slice(0, 16)} to ${until.toISOString().slice(0, 16)} UTC:`);
    for (const line of scorecardTable(cards)) console.log(`  ${line}`);
    console.log('Memeable viral funnel, by posted day:');
    for (const line of funnelLines(await funnelRows(asDb(pool), since, until), since, until)) console.log(`  ${line}`);
  }
} finally {
  await pool.end();
}
