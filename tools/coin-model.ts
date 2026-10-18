/**
 * OUR OWN MODEL BY HAND: fit one target, print the owner's table, and (with --record) write the fit
 * to internal.coin_model (0096, its target 0099) as the re-tune would; `shadow` prints what the
 * runner's scores of one target would have added since a time, and which of those got coined or
 * went viral.
 *
 *   node --env-file=.env.local tools/coin-model.ts [fit] [--target coined|viral] [--now <iso>] [--since <iso>] [--record] [--json <file>]
 *   node --env-file=.env.local tools/coin-model.ts shadow [--target coined|viral] [--since <iso>]
 *
 * Its own entry point beside tools/retune.ts because the table is what the owner decides on before
 * Policy.judge.coinModel.on, and the shadow report is the 24 hours the owner asked for. Free: every
 * fact and vector is already stored; nothing is embedded or judged. Read-only unless --record.
 *
 * The table, one row a threshold, on the test window (newest posts no fit saw): the target's yes
 * caught, the scorecard's measures for the judge alone and with the net (memeable % over labelled
 * posts, earliness as the median share of the day's views at For You, coverage of memeable viral
 * posts before 20% of the viral line), extra posts an hour, junk among them and the junk rise, and
 * the owner's held-out missed posts caught. The applied fit it would replace is printed on the same
 * posts below it.
 *
 * `--now` refits as of an earlier moment (never with --record): the coined target with `--now` a day
 * ago and the viral run's `--since` has the viral target's test window, so the two are compared on
 * posts neither fit saw (the applied fit 1 was fitted on everything up to its night, test included).
 *
 * What breaks if changed carelessly: nothing downstream reads this output; the re-tune calls
 * tools/lib/coin-model.ts directly, and this must keep calling the same function so the table is
 * the one the re-tune gates on.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { COIN_MODEL_TARGETS, DEFAULT_POLICY, type CoinModelTarget } from '../contracts/src/policy.ts';
import type { TableRow } from '../eval/src/feed/coin-fit.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { refitCoinModel, shadowReport, type MissedScore } from './lib/coin-model.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const pct = (x: number | null): string => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
const pts = (x: number | null): string => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`);
const frac = (a: number, b: number): string => `${a}/${b}${b === 0 ? '' : ` (${Math.round((a / b) * 100)}%)`}`;
const k = (x: number | null): string => (x === null ? '-' : x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${Math.round(x / 1e3)}k` : String(Math.round(x)));

const targetArg = arg('--target') ?? 'coined';
if (!(COIN_MODEL_TARGETS as readonly string[]).includes(targetArg)) throw new Error(`--target is one of ${COIN_MODEL_TARGETS.join(', ')}`);
const target = targetArg as CoinModelTarget;

function printTable(rows: readonly TableRow[], missed: readonly MissedScore[], chosen: number | null, label: string): void {
  const n = missed.length;
  console.log(`\n${label}`);
  console.log('| threshold | held-out missed caught | target yes: judge alone | judge + model | extra posts / h | extras junk (labelled) | extras memeable viral | memeable %: alone | with net | junk rise (pts) | earliness: alone | extras | with net | coverage: alone | with net | net adds |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const t of rows) {
    const caught = missed.filter((m) => m.score >= t.threshold).length;
    const e = t.earliness;
    console.log(`| ${t.threshold}${t.threshold === chosen ? ' (chosen)' : ''} | ${caught}/${n} | ${t.hits.alone}/${t.hits.of} | ${t.hits.combined}/${t.hits.of} | ${t.extrasPerHour.toFixed(2)} (${t.extras}) | ${t.extrasJunk.junk}/${t.extrasJunk.labelled} | ${t.extrasMemeViral} | ${pct(t.memeable.alone)} | ${pct(t.memeable.combined)} | ${pts(t.junkRise)} | ${pct(e.alone.medianShare)} | ${pct(e.extras.medianShare)} (${k(e.extras.medianViewsAt)} of ${k(e.extras.median24)}) | ${pct(e.combined.medianShare)} | ${frac(t.coverage.alone, t.coverage.of)} | ${frac(t.coverage.combined, t.coverage.of)} | ${t.coverage.model} |`);
  }
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coin-model' });
try {
  const db = asDb(pool);
  if (process.argv[2] === 'shadow') {
    const since = arg('--since') === null ? new Date(Date.now() - 86_400_000) : new Date(arg('--since') as string);
    console.log(await shadowReport(db, DEFAULT_POLICY, since, new Date(), target));
  } else {
    const t0 = Date.now();
    const nowArg = arg('--now');
    if (nowArg !== null && process.argv.includes('--record')) throw new Error('--now is for reading the table only; a recorded fit is fitted as of now');
    const r = await refitCoinModel(db, { record: process.argv.includes('--record'), target, ...(nowArg === null ? {} : { now: new Date(nowArg) }), ...(arg('--since') === null ? {} : { since: new Date(arg('--since') as string) }), log: (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`) });
    console.log(`target: ${r.target}`);
    console.log(`counts: ${JSON.stringify(r.counts)}`);
    console.log(`l2 ${r.l2} (validation average precision ${JSON.stringify(r.validation.ap)}), validation ${r.validation.from} to ${r.validation.to}, threshold chosen there: ${r.threshold ?? 'none'}`);
    console.log(`test ${r.test.from} to ${r.test.to} (${r.test.hours.toFixed(1)} h, ${r.test.posts} posts), average precision ${r.test.ap?.toFixed(4)}`);
    const tapRow = r.table[0];
    if (tapRow !== undefined) console.log(`For You with the judge alone in the test: ${tapRow.tapsAlone.shown} posts, ${tapRow.tapsAlone.not} tapped Not a meme by the owner; memeable viral posts in the test: ${tapRow.coverage.of}`);
    printTable(r.table, r.missed, r.threshold, `the new ${r.target} fit:`);
    if (r.current !== null) {
      printTable(r.current.table, r.current.missed, r.current.threshold, `the applied ${r.current.target} fit ${r.current.id} on the same posts (its own threshold ${r.current.threshold}):`);
    }
    console.log('\nheld-out missed posts (never taught):');
    for (const m of [...r.missed].sort((a, b) => b.score - a.score)) console.log(`  ${m.score.toFixed(4)}  ${m.itemId}  ${m.group}: ${m.post}${m.blockers.length === 0 ? '' : `  [${m.blockers.join('; ')}]`}`);
    console.log('\ntaught missed posts (scored by the fit that was taught them, for the record):');
    for (const m of [...r.taughtMissed].sort((a, b) => b.score - a.score)) console.log(`  ${m.score.toFixed(4)}  ${m.itemId}  ${m.group}: ${m.post}`);
    console.log('\nlargest named weights (standardised):');
    for (const w of r.weightsByName.slice(0, 20)) console.log(`  ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(3)}  ${w.name}`);
    console.log(`\ncurrent: ${r.current === null ? 'none' : JSON.stringify({ id: r.current.id, target: r.current.target, threshold: r.current.threshold, missedCaught: r.current.missedCaught, junkRise: r.current.junkRise })}; applied: ${r.applied}; why: ${r.why ?? '-'}; id: ${r.id ?? '-'}`);
    const out = arg('--json');
    if (out !== null) writeFileSync(out, JSON.stringify({ ...r, testPosts: r.testPosts }, null, 1));
  }
} finally {
  await pool.end();
}
