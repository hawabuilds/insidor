/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-unmerge.ts [dry] [--out <file.md>]`
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-unmerge.ts live [--out <file.md>]`
 *
 * UNDO EVERY MERGE THAT WAS NOT MINE (the owner, 2026-10-18): each narrative the old regroup folded
 * into another comes back under its own id and title with its own posts, and they leave the
 * narrative they were folded into. The plan is services/runner work/narrative-unmerge.ts — how its
 * own posts are found again, since which posts it had was never stored.
 *
 *   dry   (the default) reads only and prints the plan: what comes back with how many posts, what
 *         stays folded and why, and what each narrative they leave shrinks to
 *   live  the same plan, written in one transaction (store PgNarrativeRepo `unmerge`). The projector
 *         drops each one's public.story_alias row and writes its page at its next frames
 *
 * Free: stored posts and vectors; nothing embedded, judged or titled. Safe to run again: a
 * narrative open again is never planned again.
 *
 * What breaks if changed carelessly: run it after the permanent narratives pass is live. The old
 * regroup would fold them straight back at its next pass.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { createPool, DB_ROLE, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';
import { planUnmerge, unmergeLines } from '../services/runner/src/work/narrative-unmerge.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const mode = process.argv[2] === 'live' ? 'live' : 'dry';
if (process.argv[2] !== undefined && !['dry', 'live', '--out'].includes(process.argv[2])) {
  console.error('usage: tools/narrative-unmerge.ts [dry|live] [--out <file.md>]');
  process.exit(2);
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narrative-unmerge' });
try {
  const plan = await withTransaction(pool, async (tx) => {
    await tx.query('set transaction read only');
    return planUnmerge(tx, { policy: DEFAULT_POLICY });
  });
  if (mode === 'live') {
    const done = await withTransaction(pool, (tx) => new PgNarrativeRepo(tx).unmerge(plan.back));
    console.log(`${done} narratives open again.`);
  }
  const lines = unmergeLines(plan, mode);
  console.log(lines.join('\n'));
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
