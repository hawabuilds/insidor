/**
 * `node --env-file=.env.local --experimental-strip-types tools/onecoin-refit.ts [due | run | dry]`
 *
 * THE WEEKLY REFIT OF THE ONE-COIN BARS (Policy.oneCoin.refit). Asked every ten minutes by the
 * projector's schedule (tools/railway-start.mjs) with `due`, it runs once a week: the last two weeks
 * of posts with candidates replayed (services/project/src/onecoin-cases.ts) against their real coins — the
 * owner's coin calls and pasted addresses, else the biggest candidate an hour after its launch —
 * over a grid of cap floors, lead/hand-over ratios and buyer bars. The best bars by merit (right less
 * wrong less false picks, core `replayMerit`) are written to internal.one_coin_fit (0113) beside the
 * bars in force's score on the same cases; `applied` only when they score higher on at least
 * `minCases` cases. The runner reads the newest applied row each pass; the policy stays the fallback.
 *
 *   due  run only if the newest proposal is older than `refit.everyMs` (or there is none)
 *   run  run now and write the proposal
 *   dry  run now and print, write nothing
 *
 * Free: database reads and one row. Before 0113 it says so and exits 0, as the schedule needs.
 *
 * What breaks if changed carelessly: the comparison. A proposal is only ever applied against the
 * bars in force scored on the SAME cases; comparing against last week's score would apply bars that
 * merely met an easier week — the same gate the judge's re-tune holds to.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { oneCoinBars, replayMerit, scoreReplay, type OneCoinBars, type ReplayScore } from '../core/src/index.ts';
import { asDb, createPool, DB_ROLE, missingTable, PgOneCoinRepo, type Db } from '../store/src/index.ts';
import { loadCases } from '../services/project/src/onecoin-cases.ts';

const P = DEFAULT_POLICY.oneCoin;
const MIN = 60_000;
/** The replay judges each case at the real coin's launch + this: the owner's "within minutes". */
const JUDGE_AT_MS = 10 * MIN;
const command = process.argv[2] ?? 'due';
const log = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, job: 'onecoin-refit', ...f }));

export interface Proposal {
  readonly bars: Pick<OneCoinBars, 'minCapUsd' | 'leadRatio' | 'handOverRatio' | 'minUniqueBuyers'>;
  readonly score: ReplayScore;
}

/** Every combination of the grid, scored; the best first (ties: the higher cap floor, the fewer false picks). */
export function grid(score: (b: OneCoinBars) => ReplayScore, base: OneCoinBars): readonly Proposal[] {
  const out: Proposal[] = [];
  for (const minCapUsd of P.refit.minCapsUsd) {
    for (const ratio of P.refit.ratios) {
      for (const minUniqueBuyers of P.refit.minBuyers) {
        const bars = { minCapUsd, leadRatio: ratio, handOverRatio: ratio, minUniqueBuyers };
        out.push({ bars, score: score({ ...base, ...bars }) });
      }
    }
  }
  return out.sort((a, b) => replayMerit(b.score) - replayMerit(a.score) || a.score.falsePick - b.score.falsePick || b.bars.minCapUsd - a.bars.minCapUsd);
}

async function newestAt(db: Db): Promise<number | null> {
  const [r] = await db.query<{ at: string | null }>('select max(fitted_at) as at from internal.one_coin_fit');
  return r?.at ? new Date(r.at).getTime() : null;
}

async function refit(db: Db, write: boolean): Promise<void> {
  const now = Date.now();
  const loaded = await loadCases(db, now - P.refit.lookbackMs, now, { truthAtMs: P.refit.truthAtMs, truthMinCapUsd: P.refit.truthMinCapUsd, watchMs: P.watchMs });
  const fit = await new PgOneCoinRepo(db).appliedFit();
  const current = oneCoinBars(P, fit);
  const score = (b: OneCoinBars) => scoreReplay(loaded.cases, b, JUDGE_AT_MS, P.watchMs, loaded.useTrades);
  const now_ = score(current);
  const best = grid(score, current)[0];
  const cases = loaded.cases.length;
  const better = best !== undefined && cases >= P.refit.minCases && replayMerit(best.score) > replayMerit(now_);
  const note = cases < P.refit.minCases ? `only ${cases} cases; ${P.refit.minCases} needed` : better ? 'better than the bars in force on the same cases' : 'not better than the bars in force';
  log('info', 'one coin refit', { cases, useTrades: loaded.useTrades, current: { minCapUsd: current.minCapUsd, leadRatio: current.leadRatio, minUniqueBuyers: current.minUniqueBuyers, merit: replayMerit(now_) }, best: best === undefined ? null : { ...best.bars, merit: replayMerit(best.score) }, applied: better, note, write });
  if (!write || best === undefined) return;
  await db.query(
    `insert into internal.one_coin_fit (fitted_at, bars, score, current, cases, applied, note) values (now(), $1, $2, $3, $4, $5, $6)`,
    [JSON.stringify(best.bars), JSON.stringify(best.score), JSON.stringify({ bars: { minCapUsd: current.minCapUsd, leadRatio: current.leadRatio, handOverRatio: current.handOverRatio, minUniqueBuyers: current.minUniqueBuyers }, score: now_ }), cases, better, `${note}; judged on ${loaded.useTrades ? 'trade minutes' : 'market readings'}`],
  );
}

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-onecoin-refit', max: 1 });
  const db = asDb(pool);
  try {
    if (command === 'due') {
      const at = await newestAt(db);
      if (at !== null && Date.now() - at < P.refit.everyMs) return;
      await refit(db, true);
    } else if (command === 'run') await refit(db, true);
    else if (command === 'dry') await refit(db, false);
    else log('error', 'unknown command; use due, run or dry', { command });
  } catch (e) {
    if (missingTable(e)) log('info', 'one coin refit: 0113 not applied yet; nothing to do');
    else throw e;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    log('error', 'one coin refit failed', { err: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  });
}
