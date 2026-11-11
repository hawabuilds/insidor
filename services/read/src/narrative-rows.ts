/**
 * THE NARRATIVES TAB'S SWIPEABLE ROW: each narrative card carries `rowPosts`, its most viewed posts
 * (at most ROW_MAX), each with what the row draws for it: who posted it and where, when, its words,
 * its picture, its own views, the poster's face and, for a video, the file the phone can play.
 *
 * ★ A NEW FIELD, NOT A CHANGE TO `evidence`. The card keeps its one `evidence` entry exactly as
 * before (narrative-sorts.ts `cardOf`): the Watchlist, the World War counts and the site filters
 * read that list, and none of them may change because the tab grew a row. The row reads only
 * `rowPosts`, which an older phone ignores.
 *
 * ★ BUILT FROM THE PAGE'S OWN FACTS, PLUS ONE READ. Which posts, and their views, come from the
 * projected page (`evidence`, `postViews`, the numbers the narrative page already shows). The face
 * and the video come from one statement for the whole page of cards, the post sheet's media rule
 * (post-sheet.ts `sheetMedia`) and the narrative sheet's face read (story-sheet.ts). A post with no
 * views read has `views: null`, never 0, and sorts after every post that has them.
 *
 * What breaks if changed carelessly: ROW_MAX is also the reply's size. The list was trimmed to one
 * post a card because full pages made a page of 20 cards 413 KB; five short posts a card is what
 * the row needs and stays far under that.
 */

import { sheetMedia } from './post-sheet.ts';
import type { Db } from './queries.ts';
import { cardText } from './translations.ts';

/** The most posts one narrative's row carries. */
export const ROW_MAX = 5;
/** A row post's words, at most: the row shows two lines, so more is only bytes (translations.ts `cardText` cuts at a word). */
export const ROW_TEXT_MAX = 140;

/** The source's escaped characters as the characters themselves ("long press -&gt; copy" read as "->"). */
function unescaped(t: string): string {
  return t.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" })[e] ?? _);
}

export const ROW_POSTS_SQL = `
select i.item_id, i.media, to_jsonb(a) ->> 'picture_url' as picture_url, to_jsonb(a) ->> 'picture_copy' as picture_copy
  from public.item i left join public.author a on a.author_key = i.author_key
 where i.item_id = any($1::text[])`;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A narrative page's most viewed posts, as the row's entries without face or video yet. */
export function rowPostsOf(page: unknown): readonly Json[] {
  if (!isObj(page) || !Array.isArray(page['evidence'])) return [];
  const views = new Map<string, number | null>();
  if (Array.isArray(page['postViews'])) for (const p of page['postViews']) if (isObj(p) && typeof p['postId'] === 'string') views.set(p['postId'], num(p['views']));
  const posts = page['evidence'].flatMap((e, i) => {
    if (!isObj(e) || typeof e['evidenceId'] !== 'string') return [];
    return [{ i, v: views.get(e['evidenceId']) ?? null, row: {
      id: e['evidenceId'],
      sourceLabel: e['sourceLabel'],
      authorLabel: e['authorLabel'],
      permalink: e['permalink'],
      excerpt: typeof e['excerpt'] === 'string' ? cardText(unescaped(e['excerpt']), ROW_TEXT_MAX) : e['excerpt'],
      thumbUrl: e['thumbUrl'] ?? null,
      thumbFile: e['thumbFile'] ?? null,
      postedAt: e['postedAt'],
      views: views.get(e['evidenceId']) ?? null,
    } }];
  });
  posts.sort((a, b) => (a.v === null ? (b.v === null ? a.i - b.i : 1) : b.v === null ? -1 : b.v - a.v || a.i - b.i));
  return posts.slice(0, ROW_MAX).map((p) => p.row);
}

/** Each card's `rowPosts` with the poster's face and, for a video, its playable file; the cards as they were when the read fails. */
export async function withRowFaces(db: Db, cards: readonly unknown[]): Promise<readonly unknown[]> {
  const ids = cards.flatMap((c) => (isObj(c) && Array.isArray(c['rowPosts']) ? c['rowPosts'].flatMap((p) => (isObj(p) && typeof p['id'] === 'string' ? [p['id']] : [])) : []));
  if (ids.length === 0) return cards;
  let rows: readonly Record<string, unknown>[];
  try {
    rows = await db.query(ROW_POSTS_SQL, [[...new Set(ids)]]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return cards;
    throw e;
  }
  const byId = new Map<string, Json>();
  for (const r of rows) {
    if (typeof r['item_id'] !== 'string') continue;
    const m = sheetMedia(r['media']);
    const url = typeof r['picture_url'] === 'string' && r['picture_url'].startsWith('https://') ? r['picture_url'] : null;
    byId.set(r['item_id'], {
      authorPictureUrl: url,
      authorPictureFile: typeof r['picture_copy'] === 'string' ? r['picture_copy'] : null,
      thumbIsVideo: m !== null && (m.kind === 'video' || m.playUrl !== null),
      ...(m !== null && m.playUrl !== null ? { video: { playUrl: m.playUrl, loops: m.loops } } : {}),
    });
  }
  return cards.map((c) => {
    if (!isObj(c) || !Array.isArray(c['rowPosts'])) return c;
    return { ...c, rowPosts: c['rowPosts'].map((p) => (isObj(p) && typeof p['id'] === 'string' && byId.has(p['id']) ? { ...p, ...byId.get(p['id']) } : p)) };
  });
}
