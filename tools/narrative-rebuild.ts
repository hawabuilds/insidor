/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-rebuild.ts dry [--days 7] [--step-hours 3] [--grow-open] [--out <file.md>]`
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-rebuild.ts live [--days 7] [--step-hours 3] [--grow-open] [--out <file.md>]`
 *
 * BRING BACK THE NARRATIVES THAT LEFT THE APP (the owner, 2026-10-18), once, after 0106 and the
 * permanent narratives pass are deployed. The plan is services/runner work/narrative-rebuild.ts: the runner's
 * own grouping replayed over the stored days, what it would have made kept, a dropped narrative
 * back under its own id, every narrative open today untouched (with `--grow-open`, given the stored
 * posts it would have had too).
 *
 *   dry   reads only (a read-only transaction) and prints the plan: the missing narratives and what
 *         happens to each, the narratives it makes, posts per day with a vector
 *   live  the same plan, written as one pass in one transaction (store PgNarrativeRepo `save`), each
 *         narrative it makes marked restored (0106). The projector then writes their pages, the
 *         never-written ones first, Policy.narrative.dead.pagesPerFrame a frame
 *
 * Free: stored posts, stored vectors, stored calls; nothing is embedded, judged or titled. Running it
 * twice is safe: the second run finds the posts pinned and makes nothing new.
 *
 * What breaks if changed carelessly: `live` needs 0106 (the restored mark keeps the backward search
 * off these narratives); it refuses without it.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';
import { planRebuild, rebuildLines } from '../services/runner/src/work/narrative-rebuild.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const mode = process.argv[2];
if (mode !== 'dry' && mode !== 'live') {
  console.error('usage: tools/narrative-rebuild.ts dry|live [--days 7] [--step-hours 3] [--out <file.md>]');
  process.exit(2);
}
const days = Number(arg('--days') ?? 7);
const stepHours = Number(arg('--step-hours') ?? 3);
if (!(days > 0 && days <= 14) || !(stepHours > 0 && stepHours <= 24)) {
  console.error('--days is 1 to 14, --step-hours 1 to 24');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narrative-rebuild' });
try {
  const db = asDb(pool);
  const [ready] = await db.query<{ ok: boolean }>(`select exists (select 1 from information_schema.columns where table_schema = 'internal' and table_name = 'narrative' and column_name = 'restored_at') as ok`);
  if (mode === 'live' && ready?.ok !== true) {
    console.error('0106 is not applied: run pnpm db:migrate first.');
    process.exit(2);
  }
  const plan = await withTransaction(pool, async (tx) => {
    await tx.query('set transaction read only');
    return planRebuild(tx, { policy: DEFAULT_POLICY, nowMs: Date.now(), days, stepMs: stepHours * 3_600_000, growOpen: process.argv.includes('--grow-open') });
  });
  if (mode === 'live') {
    const wrote = await withTransaction(pool, (tx) => new PgNarrativeRepo(tx).save(plan.pass));
    if (!wrote) throw new Error('nothing written: the narrative tables are not there');
  }
  const lines = rebuildLines(plan, mode);
  console.log(lines.join('\n'));
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
