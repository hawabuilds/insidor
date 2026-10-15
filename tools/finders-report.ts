/**
 * `node --env-file=.env.local --experimental-strip-types tools/finders-report.ts [--hours <n>] [--out <file.md>]`
 *
 * THE OWNER'S 24-HOUR REPORT ON SHORT VIDEOS (2026-10-15): the short videos For You showed in the
 * last `--hours` (default 24), their median age when first shown, and which lane found each
 * (internal.item_found_by: the searches' lanes, the watch list, and the finders' coin_link,
 * x_repost, trend and creator from 0083) — with what each lane found and how much of it the judge
 * passed, and the lead time on coined posts (tools/lib/lead-time.ts). Free and read-only.
 *
 * What breaks if changed carelessly: a post's age is from its own time to its FIRST showing. The
 * last showing would make every post look old, and the first sighting by us is not a showing.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { asDb, createPool, DB_ROLE } from '../store/src/index.ts';
import { leadLines, leadRows, summarise } from './lib/lead-time.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const hours = Number(arg('--hours') ?? '24');
const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-finders-report' });
const db = asDb(pool);
const lines: string[] = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};
const median = (xs: readonly number[]): number | null => (xs.length === 0 ? null : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null);
const age = (min: number | null) => (min === null ? '—' : min >= 120 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`);

try {
  const since = new Date(Date.now() - hours * 3_600_000);
  say(`# Short videos on For You, last ${hours} hours (to ${new Date().toISOString().slice(0, 16)} UTC)`);
  say();
  const shown = await db.query<{ item_id: string; lane: string | null; age_min: number | null; handle: string | null; views: number | null }>(
    `select fp.item_id, f.lane, extract(epoch from (fp.first_shown_at - i.posted_at)) / 60 as age_min, a.handle,
            (i.counters -> 'reach' ->> 'value')::double precision as views
       from public.feed_post fp
       join public.item i on i.item_id = fp.item_id
       left join public.author a on a.author_key = i.author_key
       left join internal.item_found_by f on f.item_id = fp.item_id
      where fp.feed_id = 'fyp' and fp.first_shown_at >= $1 and i.source = 'tiktok'
      order by fp.first_shown_at`,
    [since],
  );
  const ages = shown.flatMap((r) => (r.age_min === null ? [] : [Number(r.age_min)]));
  say(`- ${shown.length} short videos first shown; median age when shown ${age(median(ages))}.`);
  const byLane = new Map<string, number>();
  for (const r of shown) byLane.set(r.lane ?? 'none', (byLane.get(r.lane ?? 'none') ?? 0) + 1);
  say(`- Found by: ${[...byLane].map(([l, n]) => `${l} ${n}`).join(', ') || 'none'}.`);
  say();
  if (shown.length > 0) {
    say('| post | found by | age when shown | views |');
    say('|---|---|---|---|');
    for (const r of shown) say(`| ${r.item_id} (@${r.handle ?? '—'}) | ${r.lane ?? '—'} | ${age(r.age_min === null ? null : Number(r.age_min))} | ${r.views === null ? '—' : Math.round(Number(r.views)).toLocaleString('en-US')} |`);
    say();
  }

  say('## What each lane found');
  say();
  say('| lane | source | found | judged | judged yes | on For You |');
  say('|---|---|---|---|---|---|');
  const lanes = await db.query<{ lane: string; source: string; found: number; judged: number; yes: number; shown: number }>(
    `select f.lane, split_part(f.item_id, ':', 1) as source, count(*)::int as found,
            count(j.item_id)::int as judged, count(*) filter (where j.coinable)::int as yes,
            count(fp.item_id)::int as shown
       from internal.item_found_by f
       left join lateral (select pj.item_id, pj.coinable from internal.post_judgement pj
                           where pj.item_id = f.item_id and pj.prompt_id not like 'post-kind%'
                           order by pj.judged_at desc limit 1) j on true
       left join public.feed_post fp on fp.item_id = f.item_id and fp.feed_id = 'fyp'
      where f.found_at >= $1
      group by 1, 2 order by 1, 2`,
    [since],
  );
  for (const l of lanes) say(`| ${l.lane} | ${l.source} | ${l.found} | ${l.judged} | ${l.yes} | ${l.shown} |`);
  say();

  say('## Lead time on coined posts (last 3 days)');
  say();
  for (const line of leadLines(summarise(await leadRows(db, new Date(Date.now() - 3 * 86_400_000))))) say(`- ${line}`);
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
