/**
 * GET /story/:id/sheet — what the phone's narrative page needs beyond the story's own projected
 * page (`GET /story/:id`): each post the page lists, as the feed projected it (so the page draws the
 * same card as For You), with that post's own view readings and when it went up, and the
 * narrative's coins, its own coin first, then the other coins written beside it, each priced as the
 * post sheet prices them.
 *
 * Its own file beside post-sheet.ts because it answers about a set of posts, not one, and the bound
 * on that set lives here. It shares the post sheet's coin pricing (`coinsFor`, passed in), so one
 * coin reads the same on the post sheet and on the narrative page.
 *
 * ★ READINGS ARE ONLY THE ONES ALREADY PROJECTED. This process runs as the app role, which has no
 * grant on public.observation; a post's readings reach it only inside the feed's projected card
 * (`payload.sheet.views`, on public.rising_row or public.feed_post). A listed post that was never on
 * a feed has none, and its `views` is an empty list with `post: null`; it is never given a zero. The
 * phone's chart (mobile/src/features/narrative/story-views.ts) treats such a post as unknown, which
 * is exactly what it is. Nothing here adds readings up: the total is the phone's, under its rule.
 *
 * ★ BOUNDED: at most MEMBERS_MAX posts, in the page's own order, and `more` says when the page lists
 * more than that. A story never makes this one statement unbounded.
 *
 * What breaks if changed carelessly: dropping a post with no readings from `members` would make the
 * phone's total look complete when it is not; it must stay, with its empty readings.
 */

import type { Db, Row } from './queries.ts';
import { withTranslations } from './translations.ts';

/** The most posts one narrative's sheet carries. */
export const MEMBERS_MAX = 60;

/**
 * The page's listed posts in its order, each with its feed card when a feed holds it (For You
 * first, the frame before the infinite scroll's copy). One statement; `$2` is the bound.
 */
export const STORY_MEMBERS_SQL = `
select e.value ->> 'evidenceId' as item_id,
       (e.value -> 'postedAt' ->> 'at')::double precision as posted_at,
       coalesce(
         (select r.payload from public.rising_row r where r.item_id = e.value ->> 'evidenceId' order by (r.feed_id = 'fyp') desc limit 1),
         (select f.payload from public.feed_post f where f.item_id = e.value ->> 'evidenceId' and f.payload is not null order by (f.feed_id = 'fyp') desc limit 1)
       ) as post,
       jsonb_array_length(coalesce(v.payload -> 'evidence', '[]'::jsonb)) as listed,
       v.payload -> 'coins' as coins
  from public.story_view v
  cross join lateral jsonb_array_elements(coalesce(v.payload -> 'evidence', '[]'::jsonb)) with ordinality as e(value, ord)
 where v.story_id = $1
 order by e.ord
 limit $2`;

/** The same, on a database from before the infinite scroll's table (0075): the frame only. */
export const STORY_MEMBERS_FRAME_SQL = STORY_MEMBERS_SQL.replace(
  /\n\s+\(select f\.payload[^\n]+\n/,
  '\n         null::jsonb\n',
);

/** Whether the story has a page at all: a story with no listed posts is still a story. */
export const STORY_EXISTS_SQL = `select payload -> 'coins' as coins from public.story_view where story_id = $1`;

/** The other coins written beside the narrative, in the projector's order. */
export const STORY_COINS_SQL = `select address from public.same_name_coin where subject_kind = 'story' and subject_id = $1 order by position asc`;

/** The most coins the page lists, as for the post sheet. */
export const STORY_COINS_MAX = 30;

/**
 * When we found the narrative: the moment it was first grouped (public.story.created_at), the
 * chart's Found marker. Not the earliest post's time, which the page already has as `firstSeenAt`.
 */
export const STORY_FOUND_SQL = `select created_at from public.story where story_id = $1`;

type Reply = { readonly status: number; readonly body: string };
type CoinsFor = (addresses: readonly string[], proven: string | null, linkCoin: Row) => Promise<{ readonly coins: readonly { readonly proven: boolean }[]; readonly marketDown: boolean }>;

const rec = (v: unknown): Row => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const json = (status: number, value: unknown): Reply => ({ status, body: JSON.stringify(value) });

/** One post's readings from its projected card: time and value, a rounded-away value kept as null. */
export function readingsOf(post: unknown): readonly { readonly atMs: number; readonly value: number | null }[] {
  const views = rec(rec(post)['sheet'])['views'];
  return (Array.isArray(views) ? views : []).flatMap((p) => {
    const atMs = num(rec(p)['atMs']);
    return atMs === null ? [] : [{ atMs, value: num(rec(p)['value']) }];
  });
}

/** The narrative's own coin (`one`), and every address its link names. */
function storyLink(coins: unknown): { readonly proven: string | null; readonly addresses: readonly string[]; readonly coin: Row } {
  const c = rec(coins);
  if (c['kind'] === 'one') {
    const a = str(rec(c['coin'])['address']);
    return { proven: a, addresses: a === null ? [] : [a], coin: rec(c['coin']) };
  }
  if (c['kind'] === 'several') return { proven: null, addresses: (Array.isArray(c['coins']) ? c['coins'] : []).flatMap((x) => str(rec(x)['address']) ?? []), coin: {} };
  return { proven: null, addresses: [], coin: {} };
}

async function members(db: Db, storyId: string): Promise<readonly Row[]> {
  try {
    return await db.query(STORY_MEMBERS_SQL, [storyId, MEMBERS_MAX]);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '42P01') return db.query(STORY_MEMBERS_FRAME_SQL, [storyId, MEMBERS_MAX]);
    throw e;
  }
}

export async function buildStorySheet(storyId: string, deps: { readonly db: Db; readonly coinsFor: CoinsFor }): Promise<Reply> {
  const rows = await members(deps.db, storyId);
  const head = rows[0] ?? (await deps.db.query(STORY_EXISTS_SQL, [storyId]))[0];
  if (head === undefined) return json(404, { error: 'not found' });

  /* The English of each post written in another language, as the feed shows it (translations.ts). */
  const cards = await withTranslations(deps.db, rows.map((r) => r['post'] ?? null).filter((p) => p !== null));
  const byId = new Map(cards.map((p) => [str(rec(p)['id']) ?? '', p] as const));
  const out = rows.flatMap((r) => {
    const itemId = str(r['item_id']);
    if (itemId === null) return [];
    const post = r['post'] === null || r['post'] === undefined ? null : (byId.get(itemId) ?? r['post']);
    const at = num(r['posted_at']);
    return [{
      itemId,
      postedAt: at === null ? { at: null, why: 'not_reported' } : { at },
      post,
      /* Only what a feed projected; a post never on a feed has none, never a zero. */
      views: readingsOf(post),
    }];
  });

  const link = storyLink(head['coins']);
  const listed = (await deps.db.query(STORY_COINS_SQL, [storyId])).flatMap((r) => str(r['address']) ?? []);
  const addresses = [...new Set([...link.addresses, ...listed])].slice(0, STORY_COINS_MAX);
  const { coins, marketDown } = await deps.coinsFor(addresses, link.proven, link.coin);
  /* The narrative's own coin first, then the rest by market cap as the post sheet orders them. */
  const ordered = [...coins.filter((c) => c.proven), ...coins.filter((c) => !c.proven)];

  const listedCount = num(head['listed']) ?? out.length;
  const found = (await deps.db.query(STORY_FOUND_SQL, [storyId]))[0]?.['created_at'];
  const foundMs = found instanceof Date ? found.getTime() : typeof found === 'string' ? Date.parse(found) : NaN;
  return json(200, {
    storyId,
    foundAt: Number.isFinite(foundMs) ? { at: foundMs } : { at: null, why: 'not_reported' },
    members: out,
    more: listedCount > out.length,
    coins: ordered,
    sourcesMissing: marketDown ? 1 : 0,
  });
}
