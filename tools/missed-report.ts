/**
 * `node --env-file=.env.local --experimental-strip-types tools/missed-report.ts [limit]`
 *
 * THE OWNER'S MISSED POSTS, PRINTED: each pasted link, what became of it, why it was missed, the
 * coins of its name and what reading it cost, then the search change that would have caught most
 * of them, with its cost a day, when most were never found. Free: it reads the database only.
 *
 * Its own tool, beside the app's list, so the diagnosis can be read in full (every fact the runner
 * recorded, not only the sentences the app shows) and pasted into a note. The suggestion is the
 * runner's (services/runner/src/work/missed-posts.ts, written after each batch); this tool never
 * computes one of its own, so the app and the report cannot disagree. Nothing is ever applied.
 *
 * What breaks if changed carelessly: nothing writes here. A tool that also applied the suggestion
 * would change the search with no one having read what it costs.
 */

import process from 'node:process';

import { asDb, createPool, DB_ROLE, PgMissedPostRepo } from '../store/src/index.ts';

const DEFAULT_LIMIT = 50;

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  const pool = createPool(DB_ROLE.internal, { applicationName: 'insidor-missed-report' });
  try {
    const repo = new PgMissedPostRepo(asDb(pool));
    const rows = await repo.list(limit);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.diagnosis ?? r.status, (counts.get(r.diagnosis ?? r.status) ?? 0) + 1);
    console.log(`missed posts: ${rows.length} (${[...counts].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`);
    const spent = rows.reduce((s, r) => s + r.usd, 0);
    const read = rows.filter((r) => r.usd > 0).length;
    console.log(`reading them cost $${spent.toFixed(4)}${read > 0 ? `, $${(spent / read).toFixed(5)} a post read` : ''}\n`);
    for (const r of rows) {
      console.log(`#${r.id} ${new Date(r.addedAt).toISOString()} ${r.status}${r.diagnosis === null ? '' : ` ${r.diagnosis}`}  ${r.url}`);
      if (Object.keys(r.detail).length > 0) console.log(`    ${JSON.stringify(r.detail)}`);
      if (r.coins.length > 0) console.log(`    coins: ${JSON.stringify(r.coins)}`);
    }
    const s = await repo.suggestion();
    console.log(`\nsuggestion${s === null ? ': none computed yet' : ` (${new Date(s.computedAt).toISOString()}): ${s.text ?? 'none; most missed posts were found by the search'}`}`);
    if (s !== null && Object.keys(s.facts).length > 0) console.log(`    ${JSON.stringify(s.facts)}`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(`missed-report failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
