/**
 * THE NARRATIVE A FEED POST IS PART OF, beside the post: For You's small tag ("GTA 6 story, 12
 * posts") that opens the narrative page. Added to each card on the way out, the way translations.ts
 * adds a post's English, because a card's projected `storyId` is set only when the narrative names
 * the post's coin, and a post can be part of a narrative that names none.
 *
 * ★ ONLY A REAL NARRATIVE: promoted, not merged away, observed (never a seeded or hand-written
 * one), and with a projected page to open. The same test the post sheet's Narrative tile uses
 * (post-sheet.ts SHEET_STORY_SQL), so the tag and the tile name the same narrative. A post in
 * several takes the one it joined first.
 *
 * `inStory` on the wire: the screen's word is not a key the app's censor lets through.
 *
 * What breaks if changed carelessly: dropping the `origin = 'observed'` test would tag real posts
 * with an invented narrative. And a database without the narrative tables must still serve the feed:
 * a missing table leaves every card as it was.
 */

import type { Db } from './queries.ts';

/** One statement for the whole frame: each post's first-joined real narrative, its title and post count. */
export const STORY_TAGS_SQL = `
select distinct on (m.item_id) m.item_id, m.story_id, v.payload ->> 'title' as title,
       jsonb_array_length(coalesce(v.payload -> 'evidence', '[]'::jsonb)) as posts
  from public.story_member m
  join public.story s on s.story_id = m.story_id and s.state = 'promoted' and s.merged_into is null and s.origin = 'observed'
  join public.story_view v on v.story_id = m.story_id
 where m.item_id = any($1)
 order by m.item_id, m.joined_at asc`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Each card with the narrative it is part of beside it, when there is one; every other card untouched. */
export async function withStoryTags<T>(db: Db, payloads: readonly T[]): Promise<readonly T[]> {
  const ids = payloads.flatMap((p) => (isObj(p) && typeof p['id'] === 'string' ? [p['id']] : []));
  if (ids.length === 0) return payloads;
  let rows: readonly Json[];
  try {
    rows = await db.query(STORY_TAGS_SQL, [ids]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return payloads;
    throw e;
  }
  const byId = new Map<string, { storyId: string; title: string | null; posts: number | null }>();
  for (const r of rows) {
    if (typeof r['item_id'] !== 'string' || typeof r['story_id'] !== 'string') continue;
    const posts = typeof r['posts'] === 'number' ? r['posts'] : Number(r['posts']);
    byId.set(r['item_id'], {
      storyId: r['story_id'],
      title: typeof r['title'] === 'string' && r['title'].trim() !== '' ? r['title'] : null,
      posts: Number.isFinite(posts) ? posts : null,
    });
  }
  if (byId.size === 0) return payloads;
  return payloads.map((p) => {
    if (!isObj(p) || typeof p['id'] !== 'string') return p;
    const tag = byId.get(p['id']);
    return tag === undefined ? p : ({ ...p, inStory: tag } as T);
  });
}
