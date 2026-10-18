/**
 * ONE NARRATIVE'S BACKWARD SEARCH, AS THE OWNER CHECKS IT (the owner, 2026-10-18: show the
 * Roadster's back-search result after it runs). For the narrative named by id or by a piece of its
 * title: the posts the backward name search brought in (services/runner work/narrative-back.ts),
 * their earliest posted and found times, and what its page now shows as First post and We found it
 * against its stored posts.
 *
 * Its own file because tools/lib/narrative-times.ts checks every narrative on the board against
 * the rules, and this answers one question about one narrative; the 20:00 table must not grow a
 * row per narrative for it.
 *
 * Which posts are the backward search's: credited to the 'narrative_name' found-by lane (the
 * backward search shares it, 0097), found on or after the first day the 'narrative_back' ledger
 * lane spent anything (the day it first ran), and posted before the narrative was first shown —
 * the forward name search asks only from a few minutes before its first ask onwards, so it cannot
 * reach those. Before the backward search has run, the list is empty and it says so.
 *
 * What breaks if changed carelessly: nothing is written here and nothing may be. The early-post
 * flag (0100) is read only when the column exists, so this runs before and after that migration.
 */

import type { Db } from '../../store/src/index.ts';
import { hm } from './narrative-times.ts';

const ms = (d: Date | null | undefined): number | null => (d === null || d === undefined ? null : d.getTime());
const minOf = (xs: readonly (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.min(...v);
};

export async function narrativeBackLines(db: Db, needle: string): Promise<string[]> {
  const found = await db.query<{ narrative_id: string; title: string | null; first_shown_at: Date | null; shown: boolean; state: string; n: string }>(
    `select n.narrative_id, n.title, n.first_shown_at, n.shown, n.state, (select count(*) from internal.narrative_member m where m.narrative_id = n.narrative_id) as n
       from internal.narrative n
      where n.narrative_id = $1 or (n.state = 'open' and n.title ilike '%' || $1 || '%')
      order by (n.narrative_id = $1) desc, n.shown desc, 6 desc
      limit 6`,
    [needle],
  );
  const nar = found[0];
  if (nar === undefined) return [`No narrative with the id or an open one with a title containing "${needle}".`];
  const lines = [`## ${nar.title ?? '(untitled)'} — ${nar.narrative_id}`, ''];
  if (found.length > 1) lines.push(`Also matching: ${found.slice(1).map((f) => `${f.narrative_id} "${f.title ?? ''}" (${f.n} posts)`).join('; ')}.`, '');

  const hasEarly = (await db.query<{ n: string }>(
    `select count(*) as n from information_schema.columns where table_schema = 'internal' and table_name = 'narrative_member' and column_name = 'early'`,
  ))[0]?.n !== '0';
  const members = await db.query<{ item_id: string; posted_at: Date | null; first_seen_at: Date | null; early: boolean; name_found_at: Date | null }>(
    `select m.item_id, i.posted_at, i.first_seen_at, ${hasEarly ? 'm.early' : 'false'} as early,
            (select min(f.found_at) from internal.item_found_by f where f.item_id = m.item_id and f.lane = 'narrative_name') as name_found_at
       from internal.narrative_member m left join public.item i using (item_id)
      where m.narrative_id = $1`,
    [nar.narrative_id],
  );
  const ledger = await db.query<{ day: string; usd: number }>(`select day::text as day, usd from internal.lane_spend where lane = 'narrative_back' order by day`);
  const firstDay = ledger[0]?.day ?? null;
  const shownAt = ms(nar.first_shown_at);

  lines.push(
    `${nar.state}, ${nar.shown ? 'shown' : 'not shown'}, first shown ${hm(shownAt)}; ${members.length} posts${hasEarly ? `, ${members.filter((m) => m.early).length} of them early` : ' (early posts not stored yet: 0100 not applied)'}.`,
    firstDay === null
      ? 'The backward search has not run yet: the narrative_back lane has spent nothing on any day.'
      : `The backward search's lane (narrative_back, every narrative together): ${ledger.map((l) => `${l.day} $${l.usd.toFixed(3)}`).join(', ')}.`,
  );

  const back = firstDay === null ? [] : members.filter((m) => m.name_found_at !== null && m.name_found_at.toISOString().slice(0, 10) >= firstDay && shownAt !== null && (ms(m.posted_at) ?? Infinity) < shownAt);
  lines.push('', `Posts the backward search brought into it: ${back.length}.`);
  if (back.length > 0) {
    lines.push(`Earliest posted ${hm(minOf(back.map((m) => ms(m.posted_at))))}; earliest found ${hm(minOf(back.map((m) => ms(m.name_found_at))))}.`, '', '| post | posted | found | early |', '|---|---|---|---|');
    for (const m of [...back].sort((a, b) => (ms(a.posted_at) ?? 0) - (ms(b.posted_at) ?? 0))) lines.push(`| ${m.item_id} | ${hm(ms(m.posted_at))} | ${hm(ms(m.name_found_at))} | ${m.early ? 'yes' : 'no'} |`);
  }

  const page = (await db.query<{ payload: Record<string, unknown> }>(`select payload from public.story_view where story_id = $1`, [nar.narrative_id]))[0]?.payload;
  const evidence = Array.isArray(page?.['evidence']) ? (page['evidence'] as { postedAt?: { at?: number | null } }[]) : [];
  const shownFirst = minOf(evidence.map((e) => (typeof e.postedAt?.at === 'number' ? e.postedAt.at : null)));
  const shownFound = (page?.['foundAt'] as { at?: unknown } | undefined)?.at;
  lines.push(
    '',
    page === undefined ? 'Its page is not projected (no public.story_view row).' : `Its page shows: First post ${hm(shownFirst)}, We found it ${hm(typeof shownFound === 'number' ? shownFound : null)}.`,
    `Its stored posts say: first post ${hm(minOf(members.map((m) => ms(m.posted_at))))}, first found ${hm(minOf(members.map((m) => ms(m.first_seen_at))))}.`,
  );
  return lines;
}
