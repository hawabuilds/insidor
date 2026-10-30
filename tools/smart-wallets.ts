/**
 * `node --env-file=.env.local --experimental-strip-types tools/smart-wallets.ts [due | run | dry]`
 *
 * THE NIGHTLY SMART WALLET LIST (Policy.launchSignals.smart, 0154; the owner, 2026-10-30: "beat the
 * runner"). Asked every ten minutes by the projector's schedule (tools/railway-start.mjs) with `due`, it
 * runs once per UTC day, soon after midnight: it marks the launches our own charts show graduated, and
 * writes that night's list of wallets that were early to 2+ recent graduates, bots and exchanges left out
 * (store/src/repo/smart-wallets.ts holds the rule and says why it runs in SQL).
 *
 *   due  run only if tonight (the UTC date) has no run row yet
 *   run  run now and write, replacing tonight's list if there is one
 *   dry  count what tonight's list would be; write nothing, mark nothing
 *
 * Free: our own tables only, and three counts back over the wire. Before 0154 it says so and exits 0, as
 * the schedule needs.
 *
 * ★ RECORDED, NOT USED. Nothing reads the list to decide yet; the pick learns from it only after a week of
 * rows has been replayed (the owner replays every pick change first).
 *
 * What breaks if changed carelessly: the day. `due` keys on the UTC date the run row carries; keying on
 * "24 hours since the last run" would let each restart of the schedule's service drift the run later,
 * and a replay's "the list as it stood that morning" with it.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE, missingTable, PgSmartWalletRepo, withTransaction } from '../store/src/index.ts';

const P = DEFAULT_POLICY.launchSignals.smart;
const command = process.argv[2] ?? 'due';
const log = (level: string, msg: string, f: Record<string, unknown> = {}) => console.log(JSON.stringify({ level, msg, job: 'smart-wallets', ...f }));

async function main(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-smart-wallets', max: 1 });
  try {
    const now = Date.now();
    if (command === 'due') {
      const last = await new PgSmartWalletRepo(asDb(pool)).lastJudgedOn();
      if (last !== null && last >= new Date(now).toISOString().slice(0, 10)) return;
    } else if (command !== 'run' && command !== 'dry') {
      log('error', 'unknown command; use due, run or dry', { command });
      return;
    }
    const write = command !== 'dry';
    const started = Date.now();
    const run = write
      ? await withTransaction(pool, (db) => new PgSmartWalletRepo(db).judge(now, P, true))
      : await new PgSmartWalletRepo(asDb(pool)).judge(now, P, false);
    log('info', 'smart wallets judged', { ...run, write, ms: Date.now() - started });
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    if (missingTable(e) || code === '42703') log('info', 'smart wallets: 0154 not applied yet; nothing to do');
    else throw e;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    log('error', 'smart wallets failed', { err: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  });
}
