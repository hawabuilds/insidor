/**
 * THE JUNK FILTER BY HAND: fit it on every label with a vector, print the held-out table the owner
 * decides on, and (with --record) write the fit to internal.junk_filter (0091) as the re-tune would.
 *
 *   node --env-file=.env.local tools/junk-filter.ts [--record] [--l2 <ridge>]
 *
 * Its own entry point beside tools/retune.ts because the table is worth reading before the filter
 * is switched on (Policy.judge.junkFilter.on), and between re-tunes. Free: every vector is already
 * stored; nothing is embedded or judged. Read-only unless --record.
 *
 * The table: for each threshold, how many held-out posts of each label group the filter would drop
 * (each scored by a fit made without its fold), and how many of the last day's judged posts with a
 * vector it would have kept from the judge — of those, how many the judge said yes to — and what
 * that is at the day's measured cost per answer.
 *
 * What breaks if changed carelessly: nothing downstream reads this output; the re-tune calls
 * tools/lib/junk-filter.ts directly, and this must keep calling the same function so the table is
 * the one the re-tune gates on.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { refitJunk, type ThresholdRow } from './lib/junk-filter.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const record = process.argv.includes('--record');
const l2 = arg('--l2') === null ? DEFAULT_POLICY.judge.junkFilter.l2 : Number(arg('--l2'));

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-junk-filter' });
try {
  const r = await refitJunk(asDb(pool), { record, l2 });
  console.log(`labels: ${JSON.stringify(r.labelled)}`);
  console.log(`with a vector: ${JSON.stringify(r.withVector)} (${r.fitN} fitted, ${DEFAULT_POLICY.judge.junkFilter.folds} folds by words, l2 ${l2})`);
  console.log(`highest held-out protected post: ${r.highestProtected?.toFixed(4)} (${r.highestProtectedId}); threshold ${r.threshold?.toFixed(4) ?? 'none'} (margin ${DEFAULT_POLICY.judge.junkFilter.margin} in log-odds)`);
  const f = (d: { dropped: number; tested: number }) => `${d.dropped}/${d.tested}`;
  const pct = (d: { dropped: number; tested: number }) => (d.tested === 0 ? '-' : `${((100 * d.dropped) / d.tested).toFixed(1)}%`);
  const usd = (row: ThresholdRow) => (r.trafficUsdPerPost === null ? '-' : `$${(row.traffic.dropped * r.trafficUsdPerPost).toFixed(2)}`);
  console.log('\nthreshold  gold      missed   coined    meme    not-a-meme      day\'s judged posts skipped (judge said yes)   day\'s cost of those answers');
  for (const row of r.table) {
    const mark = row.threshold === r.threshold ? '  ← chosen' : '';
    console.log(`${row.threshold.toFixed(4)}     ${f(row.dropped.gold).padEnd(9)} ${f(row.dropped.missed).padEnd(8)} ${f(row.dropped.coined).padEnd(9)} ${f(row.dropped.meme).padEnd(7)} ${`${f(row.dropped.not)} ${pct(row.dropped.not)}`.padEnd(15)} ${`${f(row.traffic)} ${pct(row.traffic)}`.padEnd(18)} (${f(row.trafficYes)})                  ${usd(row)}${mark}`);
  }
  console.log(`\n${r.trafficN} of the last day's judged posts had a vector and no label; cost per answer then $${r.trafficUsdPerPost?.toFixed(6) ?? '-'}.`);
  console.log(record ? (r.id === null ? `not recorded: ${r.why}` : `recorded as fit ${r.id}, ${r.applied ? 'applied' : `not applied: ${r.why}`}`) : `not recorded (pass --record); ${r.why === null ? 'it would be applied' : `it would not be applied: ${r.why}`}.`);
} finally {
  await pool.end();
}
