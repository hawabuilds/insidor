/**
 * The quick frame, run once: For You moved by the posts that changed past a cursor, then exit.
 *
 *   node services/project/src/quick-main.ts <answer id> <database time in ms>
 *
 * A one-shot like main.ts, for main.ts's reasons: nothing to supervise, one transaction. The project
 * service's launcher (tools/railway-start.mjs, through quick-wake.ts) decides when, and hands it the
 * cursor it read before the last frame began; quick-frame.ts says what it does.
 *
 * It holds the service credential for the same reason the full frame does: For You's views and
 * crypto reads live where the app role cannot read them.
 *
 * What breaks if changed carelessly: a quick frame must not run without a cursor. "Everything
 * since the beginning" is the full frame's job, at the full frame's cost.
 */

import { DEFAULT_POLICY, type Millis } from '@insidor/contracts';
import { asDb, createPool, DB_ROLE, withTransaction } from '@insidor/store';

import { loadAnswerPolicies } from './judge-cutoff.ts';
import { holdLogoHoursIn } from './post-match.ts';
import { quickForYou, type QuickCursor } from './quick-frame.ts';

function cursorOf(argv: readonly string[]): QuickCursor {
  const [answerId, atMs] = [Number(argv[0]), Number(argv[1])];
  if (!Number.isSafeInteger(answerId) || answerId < 0 || !Number.isSafeInteger(atMs) || atMs <= 0) {
    throw new Error('usage: quick-main.ts <answer id> <database time in ms>; a quick frame needs the cursor the last frame began at');
  }
  return { answerId, atMs };
}

async function main(): Promise<void> {
  const cursor = cursorOf(process.argv.slice(2));
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') throw new Error('DATABASE_URL is not set; refusing to start (see main.ts)');
  /* The picture search's logo hours, shared with the full frame (post-match.ts holdLogoHoursIn). */
  holdLogoHoursIn(url);
  const pool = createPool(DB_ROLE.service, { applicationName: 'insidor-project-quick', env: { DATABASE_URL_SERVICE: url }, statementTimeoutMs: 60_000 });
  try {
    const started = performance.now();
    const nowMs = Date.now() as Millis;
    const answers = await loadAnswerPolicies(asDb(pool), DEFAULT_POLICY);
    const r = await withTransaction(pool, (db) => quickForYou(db, nowMs, cursor, answers.main, answers));
    console.log(`quick frame changed=${r.changed} added=${r.added} removed=${r.removed} wrote=${String(r.wrote)} ms=${Math.round(performance.now() - started)}`);
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`quick frame failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
