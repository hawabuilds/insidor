/**
 * `node --env-file=.env.local --experimental-strip-types tools/onecoin-replay.ts [--days 7] [--at 10]`
 *
 * THE ONE-COIN RULE REPLAYED on what we stored (read-only): every post the matcher gave candidates
 * in the last `--days`, its candidates' trade minutes (internal.coin_trade_minute, 0112) — or their
 * market readings, said in the header, when no minute was stored — run through the live rule step by
 * step (core match/one-coin-replay.ts), against the real coin: the owner's call, else the biggest
 * candidate an hour after its launch (services/project/src/onecoin-cases.ts).
 *
 * Prints, for the bars in force (the policy, or the newest applied refit): right, wrong and no pick at
 * the real coin's launch + `--at` minutes (default 10, and 5 beside it), and false picks where nothing
 * ran. Nothing is written: the session is read-only.
 *
 * What breaks if changed carelessly: reading only the minutes' coins. A post whose candidates were
 * never watched has no minutes; judged "on trades" it would look like nobody bought anything, so the
 * replay falls back to readings for the whole run when no minute exists, and says so.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { oneCoinBars, replayMerit, scoreReplay, type ReplayScore } from '../core/src/index.ts';
import { asDb, createPool, DB_ROLE, missingTable, PgOneCoinRepo } from '../store/src/index.ts';
import { loadCases } from '../services/project/src/onecoin-cases.ts';

const P = DEFAULT_POLICY.oneCoin;
const MIN = 60_000;
const DAY = 86_400_000;
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i < 0 ? NaN : Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const pct = (a: number, b: number): string => (b === 0 ? '—' : `${Math.round((100 * a) / b)}%`);
export const scoreLine = (label: string, s: ReplayScore): string =>
  `${label.padEnd(28)} right ${pct(s.right, s.withCoin).padStart(4)}  wrong ${pct(s.wrong, s.withCoin).padStart(4)}  no pick ${pct(s.noPick, s.withCoin).padStart(4)}  (of ${s.withCoin})   false pick ${pct(s.falsePick, s.nothingRan).padStart(4)} (of ${s.nothingRan})   merit ${replayMerit(s)}`;

async function main(): Promise<void> {
  const days = arg('days', 7);
  const at = arg('at', 10);
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-onecoin-replay', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const db = asDb(client);
    const now = Date.now();
    const loaded = await loadCases(db, now - days * DAY, now, { truthAtMs: P.refit.truthAtMs, truthMinCapUsd: P.refit.truthMinCapUsd, watchMs: P.watchMs });
    const fit = await new PgOneCoinRepo(db).appliedFit();
    const bars = oneCoinBars(P, fit);
    console.log(`one coin replay, last ${days} day(s): ${loaded.posts} posts with candidates, ${loaded.cases.length} with a real coin or nothing ran, ${loaded.unmeasured} left out (no candidate measured at +1h, no owner call)`);
    console.log(`judged on ${loaded.useTrades ? 'trade minutes' : 'MARKET READINGS (no trade minute stored: the fallback rule)'}; bars ${fit === null ? 'from the policy' : 'from the applied refit'}: cap $${bars.minCapUsd}, lead ${bars.leadRatio}x, hand over ${bars.handOverRatio}x, buyers ${bars.minUniqueBuyers}`);
    if (loaded.cases.length === 0) {
      console.log('nothing to replay yet: the matcher has written no candidates in this window, or none could be measured');
      return;
    }
    for (const t of [...new Set([5, at])].sort((a, b) => a - b)) {
      console.log(scoreLine(`at launch + ${t} min`, scoreReplay(loaded.cases, bars, t * MIN, P.watchMs, loaded.useTrades)));
    }
    const by = new Map<string, number>();
    for (const t of loaded.truths.values()) by.set(t.by, (by.get(t.by) ?? 0) + 1);
    console.log(`real coins by: ${[...by].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    if (missingTable(e)) {
      console.log('0113 is not applied to this database yet: no one-coin candidates or picks to read');
      return;
    }
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
