/**
 * WHETHER A POST STARTED A NARRATIVE, for the one launch push (launch.ts): "$DOGZILLA launched from
 * the post that started Dogzilla". The owner, 2026-10-23: "find the posts that START the narratives
 * first, then be notified when they are coined."
 *
 * ★ ONE SMALL READ, SO THE DEFINITION CAN MOVE UNDER IT. A narrative's traced starting post is being
 * built separately (it may land as a column on internal.narrative). Until it does, the starting post
 * is the narrative's EARLIEST MEMBER by the post's own time (public.item.posted_at, then our first
 * sighting, then the id, so a tie has one answer). Measured 23 Oct: every one of 6,018 member posts
 * has a posted_at. When the traced column lands, `START_SQL`'s `start_item` is the one line to point
 * at it; nothing else here or in launch.ts changes.
 *
 * ★ ONLY WHAT IS TRUE AND PUBLIC. The push names the narrative by its page's own title (public.
 * story_view, observed pages only): a narrative with no public page is not named and the push keeps
 * its normal wording. A narrative of one post "started" nothing, so it needs at least two posts. And
 * we must have had the post before the coin launched (public.item.first_seen_at): a starting post we
 * found after its coin is not one we caught.
 *
 * Read-only, our own tables, only for the coins a pass is about to push: no cost, no extra push.
 *
 * What breaks if changed carelessly: ordering by first sighting before posted_at. Our sightings
 * follow what we happened to search, so the English chatter we found first would be called the
 * start of a story a Turkish post began.
 */

import type { Db } from './deliver.ts';

/** One post's narrative, as the read answers it. */
export interface StartRow {
  readonly itemId: string;
  /** The narrative's starting post (its earliest member until a traced one exists). */
  readonly startItem: string | null;
  /** The narrative's public page title; null when it has no observed page. */
  readonly title: string | null;
  readonly posts: number;
  /** When we first had this post. */
  readonly hadPostMs: number | null;
}

/** The narrative title to say, or null for the normal wording. Pure. */
export function startedTitle(r: StartRow | undefined, launchedMs: number | null): string | null {
  if (r === undefined || r.startItem !== r.itemId) return null;
  if (r.title === null || r.title.trim() === '' || r.posts < 2) return null;
  if (launchedMs === null || r.hadPostMs === null || r.hadPostMs > launchedMs) return null;
  return r.title.trim();
}

const START_SQL = `
  select m.item_id as "itemId", v.payload ->> 'title' as title, n.member_count as posts,
         (extract(epoch from i.first_seen_at) * 1000)::float8 as "hadPostMs",
         (select m2.item_id from internal.narrative_member m2 join public.item i2 on i2.item_id = m2.item_id
           where m2.narrative_id = n.narrative_id
           order by i2.posted_at nulls last, i2.first_seen_at, m2.item_id limit 1) as "startItem"
    from internal.narrative_member m
    join internal.narrative n on n.narrative_id = m.narrative_id and n.state = 'open'
    join public.item i on i.item_id = m.item_id
    left join public.story_view v on v.story_id = n.narrative_id and v.payload #>> '{provenance,kind}' = 'observed'
   where m.item_id = any($1::text[])`;

/** Each of these posts' narrative facts; a post in no narrative is absent. */
export async function startRows(db: Db, itemIds: readonly string[]): Promise<Map<string, StartRow>> {
  if (itemIds.length === 0) return new Map();
  try {
    const rows = await db.query<{ itemId: string; title: string | null; posts: number; hadPostMs: number | null; startItem: string | null }>(START_SQL, [[...new Set(itemIds)]]);
    return new Map(rows.map((r) => [r.itemId, { itemId: r.itemId, startItem: r.startItem, title: r.title, posts: Number(r.posts), hadPostMs: r.hadPostMs === null ? null : Number(r.hadPostMs) }] as const));
  } catch (e) {
    /* Not readable here (a grant missing): the push keeps its normal wording, never fails. */
    if ((e as { code?: unknown }).code === '42501') return new Map();
    throw e;
  }
}
