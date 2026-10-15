/**
 * `node --env-file=.env.local --experimental-strip-types tools/name-report.ts [--eval <name-guess-eval.json>] [--diff <backfill-diff.md>] [--out <file.md>]`
 *
 * THE NAMER'S NUMBERS FOR THE 20:00 REPORT (the owner, 2026-10-14), from what is stored. Free and
 * read-only: no model is asked, nothing is searched, nothing is written but `--out`.
 *
 *   1. Name guessing, top 5 and top 1: live — every feed post the namer guessed whose real coin is
 *      known (the owner's confirmed coin, a coin whose links carry the post, a coin created from it),
 *      by core `guessHit`; and the held-out measurement (tools/name-guess-eval.ts) when `--eval`.
 *   2. Coin matching, right / wrong / missed: the owner's coin labels weighed by the projector's own
 *      code (services/project post-match.ts `weighPostCoins`) with the namer's guesses and without;
 *      the founders' held-out half and their 71 known posts on the frozen evidence (eval/src/gold).
 *   3. See N coins on the owner's labelled posts: how often his coin is in the list, and how many
 *      other coins it shows (services/project coin-list.ts `withPlausibleLists`, as the feed does).
 *   4. The backfill's changed cards (`--diff`) and the first-day watch (0077).
 *   5. Lead time on coined posts: shown before the first coin, and by how much (tools/lib/lead-time.ts).
 *
 * What breaks if changed carelessly: the owner's posts must be weighed by the projector's code,
 * never a copy (the reason tools/lib/coin-match-fit.ts gives); a number from another path is a
 * number about a feed nobody runs.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { addressOfCoinId, coinLabelOf, foldCoinCalls, guessHit, type PostCoinMatch } from '../core/src/index.ts';
import { evaluateCase, matchBarsOf, type MatchOutcome } from '../eval/src/gold/match-eval.ts';
import { loadMatchEvidence, matchCases } from '../eval/src/gold/match-cases.ts';
import { withPlausibleLists } from '../services/project/src/coin-list.ts';
import { loadFit, weighPostCoins } from '../services/project/src/post-match.ts';
import { asDb, createPool, DB_ROLE, PgOwnerCoinCallRepo } from '../store/src/index.ts';
import { leadLines, leadRows, summarise } from './lib/lead-time.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-name-report' });
const db = asDb(pool);
const lines: string[] = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};
const pct = (n: number, d: number) => (d === 0 ? '—' : `${n}/${d} (${Math.round((100 * n) / d)}%)`);

type Tally = Record<MatchOutcome, number> & { n: number };
const tally = (os: readonly MatchOutcome[]): Tally => {
  const t: Tally = { provenRight: 0, provenWrong: 0, likelyRight: 0, likelyWrong: 0, missed: 0, clear: 0, n: os.length };
  for (const o of os) t[o] += 1;
  return t;
};
const tallyText = (t: Tally) => `right ${t.provenRight + t.likelyRight} (proven ${t.provenRight}), wrong ${t.provenWrong + t.likelyWrong} (proven ${t.provenWrong}), missed ${t.missed}, clear ${t.clear}, of ${t.n}`;
const outcomeOf = (d: PostCoinMatch, right: string | null): MatchOutcome => {
  const named = d.kind === 'confident' ? d.address : d.kind === 'unsure' ? d.likely : null;
  if (named === null) return right === null ? 'clear' : 'missed';
  if (named === right) return d.kind === 'confident' ? 'provenRight' : 'likelyRight';
  return d.kind === 'confident' ? 'provenWrong' : 'likelyWrong';
};

try {
  say(`# Namer report, ${new Date().toISOString().slice(0, 16)} UTC`);
  say();

  /* 1. Name guessing. */
  say('## Name guessing');
  const guessed = await db.query<{ item_id: string; guesses: { name: string; ticker: string }[] }>(
    `select item_id, jsonb_agg(jsonb_build_object('name', name, 'ticker', ticker) order by rank) as guesses from internal.name_guess group by item_id`,
  ).catch(() => []);
  const real = await db.query<{ item_id: string; coins: { name: string; ticker: string }[] }>(
    `select item_id, jsonb_agg(jsonb_build_object('name', name, 'ticker', ticker)) as coins from internal.name_example
      where source in ('owner', 'linked', 'created') and not coalesce((to_jsonb(name_example) ->> 'rejected')::boolean, false)
        and item_id = any($1::text[]) group by item_id`,
    [guessed.map((g) => g.item_id)],
  ).catch(() => []);
  const realBy = new Map(real.map((r) => [r.item_id, r.coins] as const));
  const known = guessed.filter((g) => realBy.has(g.item_id));
  const top1 = known.filter((g) => guessHit(g.guesses, realBy.get(g.item_id) ?? [], 1, P.names)).length;
  const top5 = known.filter((g) => guessHit(g.guesses, realBy.get(g.item_id) ?? [], P.names.guesses, P.names)).length;
  say(`- Live: ${guessed.length} posts guessed; ${known.length} have a known real coin. Real name or ticker first: ${pct(top1, known.length)}; in the top 5: ${pct(top5, known.length)}.`);
  const evalFile = arg('--eval');
  if (evalFile !== null && existsSync(evalFile)) {
    const e = JSON.parse(readFileSync(evalFile, 'utf8')) as Record<string, { set: string; before: { name: string; ticker: string }[]; after: { name: string; ticker: string }[] | null; real: { name: string; ticker: string }[] }>;
    const rows = Object.values(e).filter((r) => r.set !== 'coinless');
    const hit = (g: readonly { name: string; ticker: string }[] | null, r: (typeof rows)[number], n: number) => guessHit(g ?? [], r.real, n, P.names);
    say(`- Held out (${rows.length} known pairs, by time): top 5 ${pct(rows.filter((r) => hit(r.after, r, P.names.guesses)).length, rows.length)} against the judge's names ${pct(rows.filter((r) => hit(r.before, r, P.names.guesses)).length, rows.length)}; top 1 ${pct(rows.filter((r) => hit(r.after, r, 1)).length, rows.length)} against ${pct(rows.filter((r) => hit(r.before, r, 1)).length, rows.length)}.`);
  }
  say();

  /* 2. Coin matching. */
  say('## Coin matching');
  const fit = await loadFit(db);
  const use = fit ?? { weights: P.postCoin.weights, likelyMinShare: P.postCoin.likelyMinShare };
  const ev = loadMatchEvidence();
  const cases = matchCases().filter((c) => ev.searches[c.term] !== undefined);
  const results = cases.map((c) => evaluateCase(c, ev, { ...matchBarsOf(P, use.weights), likelyMinShare: use.likelyMinShare }, P, true));
  say(`- Founders' held-out half (frozen searches): ${tallyText(tally(results.filter((r) => r.c.split === 'holdout').map((r) => r.outcome)))}.`);
  say(`- Founders' 71 known posts (frozen searches): ${tallyText(tally(results.filter((r) => r.c.kind === 'origin').map((r) => r.outcome)))}.`);

  const calls = await new PgOwnerCoinCallRepo(db).rows();
  const folded = foldCoinCalls(calls.map((r) => ({ itemId: r.itemId, verdict: r.verdict, coinAddress: r.coinAddress, shownCoin: addressOfCoinId(r.shownCoinId), atMs: r.atMs, id: r.id })));
  const labels = [...folded].flatMap(([itemId, c]) => {
    const l = coinLabelOf(c);
    return l === null ? [] : [{ itemId, right: l.right }];
  });
  const lookups = await db.query<{ subject_id: string; hits: string[] | null }>(
    `select distinct on (subject_id) subject_id, hits from internal.coin_lookup where subject_kind = 'post' and subject_id = any($1::text[]) order by subject_id, looked_at desc nulls last`,
    [labels.map((l) => l.itemId)],
  );
  const lists = new Map(labels.map((l) => [l.itemId, lookups.find((r) => r.subject_id === l.itemId)?.hits ?? []] as const));
  for (const l of labels) if (l.right !== null && !(lists.get(l.itemId) ?? []).includes(l.right)) lists.set(l.itemId, [...(lists.get(l.itemId) ?? []), l.right]);
  const policy = { ...P, postCoin: { ...P.postCoin, weights: use.weights, likelyMinShare: use.likelyMinShare } };
  const withNamer = await weighPostCoins(db, lists, policy, { ignoreFit: true });
  const without = await weighPostCoins(db, lists, policy, { ignoreFit: true, guesses: new Map() });
  const ownerTally = (m: typeof withNamer) => tally(labels.flatMap((l) => {
    const d = m.get(l.itemId);
    return d === undefined ? [] : [outcomeOf(d.decision, l.right)];
  }));
  say(`- My labels (${labels.length} posts), with the namer's guesses: ${tallyText(ownerTally(withNamer))}.`);
  say(`- My labels, without them (the judge's names only): ${tallyText(ownerTally(without))}.`);
  say();

  /* 3. See N coins. */
  say('## See N coins on my labelled posts');
  const lookupsAsLists = new Map(labels.map((l) => [l.itemId, { coins: lookups.find((r) => r.subject_id === l.itemId)?.hits ?? [], more: false }] as const));
  const listed = await withPlausibleLists(db, lookupsAsLists, withNamer, P, Date.now());
  const withCoin = labels.filter((l) => l.right !== null && (lookupsAsLists.get(l.itemId)?.coins.length ?? 0) > 0);
  const inList = withCoin.filter((l) => {
    const x = listed.get(l.itemId);
    return x !== undefined && 'coins' in x && x.coins.includes(l.right ?? '');
  }).length;
  const others = withCoin.map((l) => {
    const x = listed.get(l.itemId);
    return x !== undefined && 'coins' in x ? x.coins.filter((a) => a !== l.right).length : 0;
  });
  say(`- My coin in the list: ${pct(inList, withCoin.length)}; other coins listed: ${withCoin.length === 0 ? '—' : (others.reduce((a, b) => a + b, 0) / withCoin.length).toFixed(1)} on average.`);
  say();

  /* 4. Backfill and watch. */
  say('## Backfill and the first-day watch');
  const diffFile = arg('--diff');
  if (diffFile !== null && existsSync(diffFile)) {
    const summary = readFileSync(diffFile, 'utf8').split('\n').find((s) => s.includes('changed coin'));
    say(`- Backfill: ${summary ?? 'no summary line'} (${diffFile})`);
  }
  const run = await db.query<{ at: Date; additions: number; by_guess: number; labelled: number; wrong: number; rate_after: number | null; rate_before: number | null; switched_off: boolean; note: string | null }>(
    `select at, (select count(*) from internal.name_watch_addition)::int as additions, (select count(*) from internal.name_watch_addition where by_guess)::int as by_guess,
            labelled, wrong, rate_after, rate_before, (select coalesce(bool_or(switched_off), false) from internal.name_watch_run) as switched_off, note
       from internal.name_watch_run order by at desc limit 1`,
  ).catch(() => []);
  const w = run[0];
  if (w === undefined) say('- Watch: not running yet (0077, or no baseline).');
  else say(`- Watch (${new Date(w.at).toISOString().slice(0, 16)}): ${w.additions} coins added to feed posts, ${w.by_guess} by the namer's names; you called ${w.wrong} of ${w.labelled} of those wrong or no coin (${w.rate_after === null ? '—' : `${Math.round(w.rate_after * 100)}%`}, against ${w.rate_before === null ? '—' : `${Math.round(w.rate_before * 100)}%`} before). ${w.switched_off ? 'It SWITCHED THE NAMER OFF.' : 'The namer is on.'} List: tools/name-watch.ts list.`);

  /* 5. Lead time, the main number from 2026-10-15 (tools/lib/lead-time.ts). */
  say();
  say('## Lead time on coined posts (last 3 days)');
  for (const line of leadLines(summarise(await leadRows(db, new Date(Date.now() - 3 * 86_400_000))))) say(`- ${line}`);

  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
