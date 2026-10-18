/**
 * OUR OWN COIN MODEL BY HAND: fit it, print the owner's table, and (with --record) write the fit to
 * internal.coin_model (0096) as the re-tune would; `shadow` prints what the runner's scores would
 * have added since a time, and which of those got coined.
 *
 *   node --env-file=.env.local tools/coin-model.ts [fit] [--record] [--json <file>]
 *   node --env-file=.env.local tools/coin-model.ts shadow [--since <iso>]
 *
 * Its own entry point beside tools/retune.ts because the table is what the owner decides on before
 * Policy.judge.coinModel.on, and the shadow report is the 24 hours the owner asked for. Free: every
 * fact and vector is already stored; nothing is embedded or judged. Read-only unless --record.
 *
 * What breaks if changed carelessly: nothing downstream reads this output; the re-tune calls
 * tools/lib/coin-model.ts directly, and this must keep calling the same function so the table is
 * the one the re-tune gates on.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { refitCoinModel, shadowReport } from './lib/coin-model.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const pct = (x: number | null): string => (x === null ? '-' : `${(x * 100).toFixed(1)}%`);
const pts = (x: number | null): string => (x === null ? '-' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coin-model' });
try {
  const db = asDb(pool);
  if (process.argv[2] === 'shadow') {
    const since = arg('--since') === null ? new Date(Date.now() - 86_400_000) : new Date(arg('--since') as string);
    console.log(await shadowReport(db, DEFAULT_POLICY, since, new Date()));
  } else {
    const t0 = Date.now();
    const r = await refitCoinModel(db, { record: process.argv.includes('--record'), log: (s) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`) });
    console.log(`counts: ${JSON.stringify(r.counts)}`);
    console.log(`l2 ${r.l2} (validation average precision ${JSON.stringify(r.validation.ap)}), validation ${r.validation.from} to ${r.validation.to}, threshold chosen there: ${r.threshold ?? 'none'}`);
    console.log(`test ${r.test.from} to ${r.test.to} (${r.test.hours.toFixed(1)} h, ${r.test.posts} posts), average precision ${r.test.ap?.toFixed(4)}`);
    const n = r.missed.length;
    const tapRow = r.table[0];
    if (tapRow !== undefined) console.log(`For You with the judge alone in the test: ${tapRow.tapsAlone.shown} posts, ${tapRow.tapsAlone.not} tapped Not a meme by the owner`);
    console.log('\n| threshold | held-out missed caught | coined caught: judge alone | judge + model | model alone | extra For You posts / h | extras coined | junk among extras (old labels) | For You junk alone | with the net | rise (pts) |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const t of r.table) {
      const caught = r.missed.filter((m) => m.score >= t.threshold).length;
      console.log(`| ${t.threshold}${t.threshold === r.threshold ? ' (chosen)' : ''} | ${caught}/${n} | ${t.coined.alone}/${t.coined.of} | ${t.coined.combined}/${t.coined.of} | ${t.coined.model}/${t.coined.of} | ${t.extrasPerHour.toFixed(2)} (${t.extras}) | ${t.extrasCoined} | ${t.extrasJunk.junk}/${t.extrasJunk.labelled} | ${pct(t.junkAlone)} | ${pct(t.junkCombined)} | ${pts(t.junkRise)} |`);
    }
    console.log('\nheld-out missed posts (never taught):');
    for (const m of [...r.missed].sort((a, b) => b.score - a.score)) console.log(`  ${m.score.toFixed(4)}  ${m.itemId}  ${m.group}: ${m.post}${m.blockers.length === 0 ? '' : `  [${m.blockers.join('; ')}]`}`);
    console.log('\ntaught missed posts (scored by the fit that was taught them, for the record):');
    for (const m of [...r.taughtMissed].sort((a, b) => b.score - a.score)) console.log(`  ${m.score.toFixed(4)}  ${m.itemId}  ${m.group}: ${m.post}`);
    console.log('\nlargest named weights (standardised):');
    for (const w of r.weightsByName.slice(0, 20)) console.log(`  ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(3)}  ${w.name}`);
    console.log(`\ncurrent: ${JSON.stringify(r.current)}; applied: ${r.applied}; why: ${r.why ?? '-'}; id: ${r.id ?? '-'}`);
    const out = arg('--json');
    if (out !== null) writeFileSync(out, JSON.stringify({ ...r, testPosts: r.testPosts }, null, 1));
  }
} finally {
  await pool.end();
}
