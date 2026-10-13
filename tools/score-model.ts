/**
 * `node --env-file=.env.local --experimental-strip-types tools/score-model.ts report|fit`
 *
 * THE FOR YOU ORDER MODEL BY HAND. Free: no paid call, every signal is already stored.
 *
 *   report   fit on every label so far and print, writing nothing: each group's coverage per
 *            signal, each signal's weight per standard deviation, the held-out gate against the fit
 *            in use (or today's rules), and the owner's trade-off table — for bars 0.3 to 0.9, hand
 *            gold, live non-memes and missed posts passed-of-tested on the held-out posts, with
 *            today's rules and the bar together (what `rising.scorePassBar` would do) and the bar
 *            alone (for information).
 *   fit      the same, and record the fit in internal.score_model (0065), applied when the gate
 *            holds — what the re-tune does at 08:00 and 20:00 (tools/retune.ts).
 *
 * Its own entry point beside tools/retune.ts because the order model's numbers are worth reading
 * without paying for a judge test. What breaks if changed carelessly: `report` must never write;
 * the owner runs it to choose a bar, not to change the feed.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { refit, type Rate, type RefitResult } from './lib/score-model.ts';
import { ratesOf } from '../eval/src/feed/score-fit.ts';

/** Today's rules alone on the fixed held-out posts: the table's "none" row. */
const ratesOfRules = (r: RefitResult) => ratesOf(r.examples.filter((e) => e.heldOut), (e) => e.rulesPass);

const command = process.argv[2] ?? '';
if (command !== 'report' && command !== 'fit') {
  console.error('usage: tools/score-model.ts report|fit');
  process.exit(2);
}
const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: url }, applicationName: 'insidor-score-model' });
try {
  const r = await refit(asDb(pool), { record: command === 'fit' });
  const ofN = (x: Rate) => `${x.passed}/${x.tested}`.padStart(7);
  console.log(`labelled posts, by group: labelled / held / with a reach reading (usable): ${Object.entries(r.coverage).map(([g, c]) => `${g} ${c.labelled}/${c.held}/${c.usable}`).join(', ')}`);
  console.log(`fitted on ${r.fitN}, held out ${r.heldOutN}`);
  console.log('\ncoverage: posts with each signal read, by group');
  const groups = Object.keys(r.coverage) as (keyof typeof r.coverage)[];
  console.log(`${'signal'.padEnd(16)}${groups.map((g) => g.padStart(9)).join('')}`);
  for (const s of Object.keys(r.coverage.gold.present)) console.log(`${s.padEnd(16)}${groups.map((g) => `${r.coverage[g].present[s]}/${r.coverage[g].held}`.padStart(9)).join('')}`);
  console.log('\nweights, per standard deviation of the signal (and the weight when it is missing)');
  for (const w of r.weights) console.log(`${w.signal.padEnd(16)}${w.weight.toFixed(2).padStart(7)}${w.missing === null ? '' : `   missing ${w.missing.toFixed(2)}`}`);
  console.log(`intercept ${r.fit.intercept.toFixed(2)}`);
  const g = r.gate;
  console.log(`\ngate at bar ${r.bar ?? 'none'}: hand gold ${ofN(g.ref.hand)} -> ${ofN(g.next.hand)}, live non-memes ${ofN(g.ref.negatives)} -> ${ofN(g.next.negatives)}, missed ${ofN(g.ref.missed)} -> ${ofN(g.next.missed)}; order ${g.refOrder?.toFixed(3) ?? '-'} -> ${g.order?.toFixed(3) ?? '-'}`);
  console.log(g.apply ? (command === 'fit' ? `applied (fit ${r.id})` : 'would be applied') : `not applied: ${g.why}`);
  const table = (title: string, none: RefitResult['crossNone'], rows: RefitResult['table']) => {
    console.log(`\n${title}\nbar  | today's rules and the bar: hand gold, non-memes, missed, recall | the bar alone: hand gold, non-memes, missed, recall`);
    const z = none;
    console.log(`none | ${ofN(z.hand)} ${ofN(z.negatives)} ${ofN(z.missed)} ${ofN(z.recall)} | (today's rules alone)`);
    for (const t of rows) {
      const a = t.withRules;
      const b = t.alone;
      console.log(`${t.bar.toFixed(1)}  | ${ofN(a.hand)} ${ofN(a.negatives)} ${ofN(a.missed)} ${ofN(a.recall)} | ${ofN(b.hand)} ${ofN(b.negatives)} ${ofN(b.missed)} ${ofN(b.recall)}`);
    }
  };
  table(`the fixed held-out posts (${r.heldOutN}), scored by this fit`, ratesOfRules(r), r.table);
  table(`every usable label, each scored by a fit that never saw it (${r.examples.length}, five folds); order ${r.crossRulesOrder?.toFixed(3) ?? '-'} with today's rules, ${r.crossOrder?.toFixed(3) ?? '-'} by the fit`, r.crossNone, r.crossTable);
} finally {
  await pool.end();
}
