/**
 * GET /rising/fyp/sorted?by=trending|most_viewed&window=1h|6h|24h — For You's Trending and Most
 * viewed chips (the owner, 2026-10-17). New is the frame and its scroll (feed-page.ts), unchanged.
 *
 * WHO IS ELIGIBLE: For You's members (public.feed_post, `fyp`, not withdrawn), the posts the judge
 * passed onto For You. No other post can reach these lists.
 *
 * HOW A POST'S VIEWS GAINED ARE COUNTED: from its own readings only, the ones the projector stored
 * on its card (`payload.sheet.counts`: the chart's readings plus the first reading's count, rising.ts
 * `firstCount`; a card projected before that field falls back to `sheet.views`, which lacks it and
 * so loses the gain between a post's first and second reading). No new read of anything. The rule
 * is the narratives' (core/src/group/narrative.ts `narrativeReach`): between two readings the gain
 * is spread evenly over the time between them, a lower count than the one before adds nothing, and
 * before the first reading or after the last it adds nothing, never a guess forward.
 * post-sorts.test.ts holds this file to that function.
 *
 * ★ THE RANKING KEYS ARE CORE'S (core/src/rank/post-sorts.ts, which says them exactly), with their
 * thresholds in Policy.rising.forYouSorts, because the runner's readings loop keeps the text source's
 * posts that would top these lists read (work/sort-top.ts) and must pick the same posts. In short:
 *   Most viewed   views gained in the window, never a total. On the list only with a reading inside
 *                 the window; a post last read before it is left off, never listed at zero (the phone
 *                 drops a card with no number), which puts it below every post that is on the list.
 *   Trending      how many times faster it gains in the window's later half than its earlier half,
 *                 for posts gaining at least `trendFloorPerMin` views a minute now; posts under the
 *                 floor by their speed, below every post over it; a post with no trend yet (one
 *                 reading, or one long gap across both halves) below those, by views gained.
 *   Freshness     (the owner, 2026-10-18: "a post can only rank in the top 20 of either sort if its
 *                 latest reading is less than 30 minutes old") a post last read `freshMs` ago or more
 *                 is listed after every post read since, on both sorts and every window.
 *   The top SHOWN are sent.
 *
 * ★ A SHORT VIDEO IS RANKED IN A TEXT POST'S VIEWS ON TRENDING. The short-video source's views run an order of
 * magnitude above a text post's (Policy.rising.shortVideoReachScale, measured 2026-10-13: x12.5),
 * so on raw views every Trending list would be short videos. Its gains are divided by that same scale before
 * the Trending key is taken — the very factor For You's reach bars, the judge and the narrative's single
 * post bar already apply to it, never a number of this file's own — so a short video gaining 12,500
 * a minute ranks with a text post gaining 1,000 (the owner, 2026-10-17: "TikTok in For You's
 * Trending sort: whatever is best"). Trending only: Most viewed ranks raw views gained, short videos
 * and all (the owner, 2026-10-17: "keep most viewed raw for tiktok"). Only the ORDER is scaled: `gained`, the number on the card, is
 * its real views gained. The source comes from the post's item row; a post whose source cannot be
 * read is ranked as a text post.
 *
 * ★ THE KEY IS NEVER SENT. The reply carries the cards in order and, per card, its views gained in
 * the window (`gained`), a fact true whether or not Insidor exists; the speeds, the ratio and the group
 * stay in this process. A post with no reading in the window is not on either list, rather than
 * listed at zero: an unread post is not a post nobody watched.
 *
 * WHY THIS COMPUTES, in a service whose rule is that nothing here does: the projector was the other
 * place, and it would have meant a ranked table per sort and window written every run for a chip few
 * people press. Everything this needs is already on the public cards, the work is a few hundred
 * small arrays, and it is done once per projector run per sort and window (the reply is kept until
 * the feed's tick moves), so it costs the database one indexed-size read a minute at most.
 *
 * What breaks if changed carelessly: dropping the coverage test lets a post read once in the last
 * minute claim a speed from one interval; letting a half's rate stand on no reading of its own gives
 * a post read hourly a ratio of exactly 1 instead of no trend; ranking a stale post by its key alone puts
 * yesterday's climb at the top of today's list; counting past the last reading invents views; and
 * sending `key` puts the system's reasoning on a screen.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { sortGainIn, sortOrder, sortPlace, sortRunsOf, type SortPlace, type SortReading } from '@insidor/core';

import type { Db, Row } from './queries.ts';
import { RISING_VIEW_SQL } from './queries.ts';
import { withCurrentMarket } from './feed-page.ts';
import { withStoryTags } from './story-tags.ts';
import { withTranslations } from './translations.ts';

export type SortBy = 'trending' | 'most_viewed';

export const SORT_WINDOWS = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 } as const;
export type SortWindow = keyof typeof SORT_WINDOWS;

/** Posts sent per list: a screen and a half of scrolling; the rest of For You is under New. */
export const SHOWN = 50;
/** A reply is kept no longer than this even when the tick has not moved (a stalled projector). */
const KEEP_MS = 120_000;
/** The source held to the short-video scale, as the runner and the projector name it (score-posts.ts, rising.ts). */
const SHORT_VIDEO_SOURCE = 'tiktok';

/** What a post's views are divided by for ranking: the short-video scale for that source, else 1. */
export function rankScale(source: unknown, shortVideoScale: number = DEFAULT_POLICY.rising.shortVideoReachScale): number {
  return source === SHORT_VIDEO_SOURCE ? shortVideoScale : 1;
}

/**
 * The live members' readings, narrow: no card is read here. A member projected before the window
 * began has no reading in it (a card's readings end where it was projected), so it is left out.
 * The card's `counts` where it has them, else its `views`.
 */
export const SORT_READINGS_SQL = `
select f.item_id, coalesce(f.payload #> '{sheet,counts}', f.payload #> '{sheet,views}') as views, f.payload #>> '{postedAt,at}' as posted_ms, i.source
  from public.feed_post f
  left join public.item i on i.item_id = f.item_id
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload is not null
   and f.payload_at >= $1::timestamptz`;

/** The chosen posts' cards, whole, with their posters' pictures, as the scroll reads them. */
export const SORT_CARDS_SQL = `
select f.item_id, (f.payload - 'sheet') || jsonb_build_object('authorPictureUrl', to_jsonb(a) ->> 'picture_url', 'authorPictureFile', to_jsonb(a) ->> 'picture_copy') as payload, f.payload_at
  from public.feed_post f
  left join public.item i on i.item_id = f.item_id
  left join public.author a on a.author_key = i.author_key
 where f.feed_id = 'fyp' and f.item_id = any($1)`;

export type Reading = SortReading;
export type Ranked = SortPlace;
export const runsOf = sortRunsOf;
export const gainIn = sortGainIn;

/** One post's place on a list under the policy's thresholds, or null when it is not on it (core `sortPlace`). */
export function rankPost(id: string, readings: readonly Reading[], postedMs: number | null, by: SortBy, windowMs: number, nowMs: number, scale: number = 1, policy: Policy = DEFAULT_POLICY): Ranked | null {
  return sortPlace(id, readings, postedMs, by, windowMs, nowMs, policy, scale);
}

/** The list in order (core `sortOrder`), the top `shown`. */
export function ranked(rows: readonly Ranked[], shown: number = SHOWN): readonly Ranked[] {
  return sortOrder(rows, shown);
}

function readingsOf(raw: unknown): readonly Reading[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (typeof r !== 'object' || r === null) return [];
    const at = (r as Record<string, unknown>)['atMs'];
    const v = (r as Record<string, unknown>)['value'];
    return typeof at === 'number' ? [{ atMs: at, value: typeof v === 'number' ? v : null }] : [];
  });
}

const msOf = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function parseSort(rawUrl: string): { readonly by: SortBy; readonly window: SortWindow } | null {
  const q = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  const by = q.get('by');
  const w = q.get('window') ?? (by === 'most_viewed' ? '24h' : '1h');
  if (by !== 'trending' && by !== 'most_viewed') return null;
  if (!Object.hasOwn(SORT_WINDOWS, w)) return null;
  return { by, window: w as SortWindow };
}

export interface SortReply {
  readonly tick: number;
  readonly by: SortBy;
  readonly window: SortWindow;
  readonly posts: readonly unknown[];
  /** Per post id: its views gained in the window, rounded. */
  readonly gained: Readonly<Record<string, number>>;
}

/**
 * The route's work, kept per sort and window until For You's tick moves (the projector's run, about
 * a minute), so many phones on the chip cost one read a run. `now` and `cache` are injected for tests.
 */
export function createSorts(now: () => number = Date.now) {
  const kept = new Map<string, { readonly tick: number; readonly at: number; readonly reply: SortReply }>();
  return async function sorted(db: Db, by: SortBy, window: SortWindow): Promise<SortReply | null> {
    const views = await db.query(RISING_VIEW_SQL, ['fyp']);
    const view = views[0];
    if (view === undefined) return null;
    const tick = Number(view['tick']);
    const nowMs = now();
    const key = `${by}:${window}`;
    const hit = kept.get(key);
    if (hit !== undefined && hit.tick === tick && nowMs - hit.at < KEEP_MS) return hit.reply;

    const windowMs = SORT_WINDOWS[window];
    const rows = await db.query(SORT_READINGS_SQL, [new Date(nowMs - windowMs).toISOString()]);
    const list = ranked(rows.flatMap((r: Row) => {
      if (typeof r['item_id'] !== 'string') return [];
      const one = rankPost(r['item_id'], readingsOf(r['views']), msOf(r['posted_ms']), by, windowMs, nowMs, rankScale(r['source']));
      return one === null ? [] : [one];
    }));
    const ids = list.map((x) => x.id);
    const cards = ids.length === 0 ? [] : await db.query(SORT_CARDS_SQL, [ids]);
    const byId = new Map(cards.flatMap((c) => (typeof c['item_id'] === 'string' && c['payload'] != null ? [[c['item_id'], withCurrentMarket(c['payload'], msOf(c['payload_at']), nowMs)] as const] : [])));
    const shown = list.filter((x) => byId.has(x.id));
    const posts = await withStoryTags(db, await withTranslations(db, shown.map((x) => byId.get(x.id))));
    const reply: SortReply = { tick, by, window, posts, gained: Object.fromEntries(shown.map((x) => [x.id, Math.round(x.gained)])) };
    kept.set(key, { tick, at: nowMs, reply });
    return reply;
  };
}
