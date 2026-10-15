/**
 * `node --env-file=.env.local --experimental-strip-types tools/lead-time.ts [--days <n>] [--min-coins <n>] [--list]`
 *
 * LEAD TIME, the main number (the owner, 2026-10-15): of the posts coined in the last `--days`
 * (default 3), the share For You showed before the first coin launched and the median minutes of
 * lead, for each source. `--min-coins` counts only posts at least that many coins named — a post
 * one coin names is usually one nobody saw; several coins say people noticed it. `--list` prints
 * every coined post we showed, with how it was found. Free and read-only.
 *
 * The arithmetic is tools/lib/lead-time.ts, shared with the re-tune and the number table.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { leadLines, leadRows, summarise } from './lib/lead-time.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? '3');
const minCoins = Number(arg('--min-coins') ?? '1');
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-lead-time' });
try {
  const rows = (await leadRows(asDb(pool), new Date(Date.now() - days * 86_400_000))).filter((r) => r.coins >= minCoins);
  console.log(`Lead time over the last ${days} days${minCoins > 1 ? `, posts named by ${minCoins}+ coins` : ''}:`);
  for (const line of leadLines(summarise(rows))) console.log(`  ${line}`);
  if (process.argv.includes('--list')) {
    for (const r of rows.filter((x) => x.leadMin !== null).sort((a, b) => (b.leadMin ?? 0) - (a.leadMin ?? 0))) {
      console.log(`  ${r.itemId}  lead ${Math.round(r.leadMin ?? 0)} min  coins ${r.coins}  found by ${r.foundBy ?? '—'}  first coin ${r.firstCoin}`);
    }
  }
} finally {
  await pool.end();
}
