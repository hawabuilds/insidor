/**
 * `node --env-file=.env.local --experimental-strip-types tools/language-drop-backtest.ts [--from <iso>] [--to <iso>]`
 *
 * THE LANGUAGE-DROP ALARM, BACKTESTED: the runner's rule (core replayLanguageDrops, policy
 * `notify.languageDrop`) replayed every `everyMs` over stored finds from `--from` (default four
 * days ago) to `--to` (default now), each source on its own, and every time it would have said a
 * language was down or back. Free and read-only: stored rows only, nothing is queued.
 *
 * Its own tool because the owner asked that the alarm be shown to fire on the real bug before it is
 * trusted, and to know how often it would have fired otherwise. It reads through tools/lib/
 * language-finds.ts, so it counts exactly what the alarm counts.
 *
 * What breaks if changed carelessly: replaying from `--from` with no history before it starts with
 * nothing down, as the runner does after `lookbackMs`; a drop already under way at `--from` shows
 * as beginning there.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { LANGUAGE_SOURCES, replayFor } from './lib/language-finds.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const p = DEFAULT_POLICY.notify.languageDrop;
const toMs = arg('--to') === null ? Date.now() : Date.parse(arg('--to')!);
const fromMs = arg('--from') === null ? toMs - 4 * 86_400_000 : Date.parse(arg('--from')!);
const at = (ms: number) => new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-language-drop-backtest' });
try {
  console.log(`Language-drop alarm replayed ${at(fromMs)} to ${at(toMs)} UTC, every ${p.everyMs / 60_000} min: down under ${Math.round((1 - p.dropShare) * 100)}% of the same ${p.windowMs / 3_600_000}h a day before (baseline at least ${p.minBaselineFinds}), back at ${Math.round(p.recoverShare * 100)}% of what it fell from.`);
  for (const { source, role } of LANGUAGE_SOURCES) {
    const r = await replayFor(asDb(pool), source, role, fromMs, toMs, p);
    /* What would be pushed: the whole source, and each language not inside a whole-source drop. */
    const said = r.changes.filter((c) => !c.inWhole);
    const downs = said.filter((c) => c.state === 'down');
    console.log(`\n${source}: ${downs.length} down pushed, ${said.length - downs.length} back pushed`);
    for (const c of r.changes) console.log(`  ${at(c.atMs)}  ${(c.lang ?? 'ALL').padEnd(4)} ${c.state.padEnd(4)}  ${c.finds} in the last ${p.windowMs / 3_600_000}h, from ${c.baselineFinds}${c.state === 'back' ? ` (down since ${at(c.sinceMs)})` : ''}${c.inWhole ? '  [inside the whole-source drop: not pushed]' : ''}`);
    for (const l of r.now.filter((n) => n.downSinceMs !== null)) console.log(`  still down at the end: ${l.lang ?? 'ALL'} since ${at(l.downSinceMs!)}`);
  }
} finally {
  await pool.end();
}
