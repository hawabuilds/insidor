/**
 * `node --env-file=.env.local --experimental-strip-types tools/coined-words.ts [--days <n>]`
 *
 * WHAT GETS COINED, LISTED (the owner, 2026-10-15: "show me the list"): the tags, sounds and
 * creators of every coined post we hold from the last `--days` (default Policy.finders.learned's
 * week), counted the way the runner counts them for its daily learned words (services/runner
 * work/search-words.ts `learnWords`), and the words the runner holds now (internal.search_word).
 * Free and read-only.
 *
 * What breaks if changed carelessly: the count must be the runner's own function. A copy here
 * would show the owner a list the searches do not use.
 */

import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { learnWords } from '../services/runner/src/work/search-words.ts';
import { asDb, createPool, DB_ROLE, PgFinderRepo } from '../store/src/index.ts';
import { leadRows } from './lib/lead-time.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const days = Number(arg('--days') ?? String(P.finders.learned.lookbackMs / 86_400_000));
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-coined-words' });
const db = asDb(pool);
try {
  const coined = await leadRows(db, new Date(Date.now() - days * 86_400_000));
  const posts = await db.query<{ item_id: string; source: string; handle: string | null; body: string | null; format_ids: string[] | null }>(
    `select i.item_id, i.source, a.handle, i.body, i.format_ids from public.item i left join public.author a on a.author_key = i.author_key where i.item_id = any($1::text[])`,
    [coined.map((c) => c.itemId)],
  );
  const words = learnWords(posts.map((p) => ({ source: p.source, handle: p.handle, body: p.body ?? '', formatIds: p.format_ids ?? [] })), 'tiktok', P);
  console.log(`Coined posts in the last ${days} days: ${coined.length} (${posts.length} held, ${posts.filter((p) => p.source === 'tiktok').length} short videos).`);
  for (const kind of ['tag', 'sound', 'creator'] as const) {
    const list = words.filter((w) => w.kind === kind);
    console.log(`${kind}s (${list.length}): ${list.map((w) => `${w.value} (${String(w.facts?.['coinedPosts'] ?? '')})`).join(', ') || '—'}`);
  }
  const held = await new PgFinderRepo(db).searchWords(['trend', 'coined']);
  console.log(`The runner's words now: ${held.length === 0 ? '— (none yet, or 0083 not applied)' : held.map((w) => `${w.origin}/${w.kind} ${w.value}`).join(', ')}`);
} finally {
  await pool.end();
}
