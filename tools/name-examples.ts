/**
 * `node --env-file=.env.local tools/name-examples.ts [--cache <file>] [--yes --cap <usd>]`
 *
 * SEEDS THE NAMER'S EXAMPLES (0076), ONCE, AFTER THE MIGRATION: every known post → coin pair the
 * runner cannot read for itself — the founders' coined sheet and its known origin posts, from the
 * frozen files under eval/ — together with the database's own (the owner's confirmed coins, gold,
 * created coins, and every coin whose links carry a post the judge said yes to, of any age; the
 * runner's own pass only reads the last day's). Each example post gets its vector: from the
 * measurement's cache file (tools/name-guess-eval.ts), the runner's kept vectors, or — only with
 * SPEND=live and --yes — embedded on the learning book up to --cap.
 *
 * Idempotent: a pair already held is left as it is, a vector already held is not paid again.
 * Without 0076 it writes nothing and says so.
 *
 * What breaks if changed carelessly: the source of each pair. The runner adds the owner's and the
 * database's pairs by itself every pass; seeding them here too is harmless (the first write wins),
 * but a sheet row written as 'owner' would make it look like his call.
 */

import process from 'node:process';

import { POST_SPACE } from '../adapters/embed/voyage/src/index.ts';
import { asDb, createPool, DB_ROLE, PgNameExampleRepo, type NamePair } from '../store/src/index.ts';
import { allPairPosts, vectorsFor } from './lib/name-pairs.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const CACHE = arg('--cache', 'var/name-vectors.json');
const paid = process.env['SPEND'] === 'live' && process.argv.includes('--yes');
const CAP = Number(arg('--cap', '0.3'));

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-name-examples' });
const db = asDb(pool);
const shared = paid ? await openSharedMeter(CAP, process.env, 'learning') : null;

try {
  const held = await db.query<{ ok: boolean }>(`select to_regclass('internal.name_example') is not null as ok`);
  if (held[0]?.ok !== true) {
    console.error('0076 is not applied: nothing written.');
    process.exitCode = 2;
  } else {
    const posts = [...(await allPairPosts(db)).values()];
    const repo = new PgNameExampleRepo(db);
    const pairs: (NamePair & { picture: string | null })[] = posts.flatMap((p) =>
      p.coins.map((c) => ({ itemId: p.itemId, address: c.address, name: c.name, ticker: c.ticker, source: c.source, text: p.text, picture: p.picture, postedAtMs: p.postedAtMs, availableAtMs: c.availableAtMs, rejected: c.rejected })),
    );
    let written = 0;
    for (let i = 0; i < pairs.length; i += 500) written += await repo.put(pairs.slice(i, i + 500));
    const vectors = await vectorsFor(db, posts, POST_SPACE, CACHE, shared?.meter ?? null, paid ? posts.length : 0);
    const rows = [...vectors].map(([itemId, values]) => ({ itemId, values }));
    for (let i = 0; i < rows.length; i += 200) await repo.putVectors(rows.slice(i, i + 200), POST_SPACE);
    console.log(`${posts.length} example posts, ${pairs.length} pairs (${written} new); ${vectors.size} vectors written${paid ? `, $${shared?.meter.spentUsd().toFixed(4)} spent` : ''}`);
  }
} finally {
  await shared?.close();
  await pool.end();
}
