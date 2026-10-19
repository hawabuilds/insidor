/**
 * `node --env-file=.env.local --experimental-strip-types tools/lang-shares.ts [--days 7] [--views 500000]`
 *
 * THE LANGUAGE SHARES THE NEWEST-POSTS SEARCH IS SPLIT BY (`Policy.feed.langSplit.shares`),
 * recomputed from what was coined: of the X posts a coin's metadata named in the last `--days`
 * days (internal.coin_post_link) that reached `--views` views, the share in each language we hold
 * them in. Printed over every language, then over `feed.langs` alone and normalised to one, as a
 * line ready to paste into policy. Free and read-only.
 *
 * Its own tool because the shares are the owner's rule ("make the languages proportionate") and
 * go stale as the coined mix moves: a share a week old steers a day of search money.
 *
 * What it cannot see, and the shares therefore leave out: a coined post we never stored has no
 * language here, so a language we do not search is under-counted by construction — the count of
 * such posts is printed so the gap is visible. A post's views are its latest reading, so a post
 * read before it peaked counts only if it had already passed the bar. What breaks if changed
 * carelessly: counting every coined post rather than the viral ones weights the split toward the
 * languages with the most junk coins, not the ones whose posts run.
 */

import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : fallback;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const days = arg('--days', 7);
const views = arg('--views', 500_000);

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-lang-shares' });
try {
  const db = asDb(pool);
  const rows = await db.query<{ lang: string | null; posts: string; held: boolean }>(
    `with coined as (
       select distinct 'x:' || l.source_item_id as item_id
         from internal.coin_post_link l
        where l.source = 'x' and l.minted_at >= now() - make_interval(days => $1::int)
     )
     select i.lang, count(*)::text as posts, i.item_id is not null as held
       from coined c left join public.item i using (item_id)
      where i.item_id is null or (i.counters->'reach'->>'value')::float8 >= $2
      group by i.lang, i.item_id is not null`,
    [days, views],
  );
  const held = rows.filter((r) => r.held);
  const unheld = rows.filter((r) => !r.held).reduce((n, r) => n + Number(r.posts), 0);
  const total = held.reduce((n, r) => n + Number(r.posts), 0);
  console.log(`Coined X posts with at least ${views.toLocaleString('en')} views, coined in the last ${days} days: ${total} held (${unheld} more coined posts are not held, so their language and views are unknown).`);
  const byLang = new Map<string, number>();
  for (const r of held) byLang.set(r.lang ?? '(none)', (byLang.get(r.lang ?? '(none)') ?? 0) + Number(r.posts));
  for (const [lang, n] of [...byLang].sort((a, b) => b[1] - a[1])) console.log(`  ${lang.padEnd(6)} ${String(n).padStart(5)}  ${total === 0 ? '—' : `${((100 * n) / total).toFixed(1)}%`}`);

  const langs = DEFAULT_POLICY.feed.langs;
  const ours = langs.reduce((n, l) => n + (byLang.get(l) ?? 0), 0);
  console.log(`\nOver the searched languages (${langs.join(', ')}): ${ours} posts, ${total === 0 ? '—' : `${((100 * ours) / total).toFixed(1)}%`} of the held ones. Normalised:`);
  if (ours === 0) {
    console.log('  — none of these posts is in a searched language; the shares cannot be computed.');
  } else {
    /* Three places: a share under a tenth of a percent still sets a language's cadence. */
    const shares = Object.fromEntries(langs.map((l) => [l, Math.round(((byLang.get(l) ?? 0) / ours) * 1000) / 1000]));
    for (const l of langs) console.log(`  ${l.padEnd(6)} ${((shares[l] ?? 0) * 100).toFixed(1)}%`);
    const zero = langs.filter((l) => (byLang.get(l) ?? 0) === 0);
    if (zero.length > 0) console.log(`  (${zero.join(', ')}: no such post, so a share of 0 — searched only at the slowest cadence, langSplit.maxEveryMs)`);
    console.log(`\nshares: { ${langs.map((l) => `${l}: ${shares[l]}`).join(', ')} },`);
  }
} finally {
  await pool.end();
}
