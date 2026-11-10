/**
 * GET /rising/fyp/sorted?by=trending&window=now | by=most_viewed&window=today|week [&cursor=N] —
 * For You's Trending and Most viewed chips (the owner, 2026-10-17, redesigned 2026-10-18). New is the
 * frame and its scroll (feed-page.ts), unchanged.
 *
 * ★ THE LISTS THE APP OFFERS (the owner's third design, 2026-10-18; Policy.rising.forYouSorts):
 *   Trending now      one list, no window chips (core `riserPlace`, `trendingList`): the RISERS, views
 *                     a minute over the last 30 minutes at least 1.15 times those over the hour before
 *                     (30 to 90 minutes ago), over the 300-a-minute floor, read under 30 minutes ago,
 *                     ranked by how many times faster. Under 5 risers, the list is filled to 10 with
 *                     the 1h rule's fresh picks over its floor (later half against earlier half). Per
 *                     post `speeds`: `now` and `before` in REAL views a minute, a short video's too
 *                     (the scale only decides the floor), from whichever rule listed it, so a filled
 *                     card says its own flat or slowing speed honestly.
 *   Most viewed       Today and This week: views GAINED in the last 24 hours / 7 days from each post's
 *                     own readings (the first reading's count a reading like any other), any For You
 *                     post with a reading in the window, stale below fresh; `gained` per post. All
 *                     time: every For You post by its total, the card's own `reach`. `views` carries
 *                     each post's total on all three; `undated` is 0 and kept only for the app built
 *                     before this design.
 *   Both are sent `pageSize` at a time (`cursor` the place to start, `next` the next one, null at
 *   the end), from one ranking kept per tick, so pages of one tick never overlap.
 * ★ THE OLD WINDOWS (`1h` `6h` `24h`, the 2026-10-17 lists, with `gained`) are still answered as they
 *   were, for the app built before the redesign until it is reloaded; nothing new asks for them.
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
 *                 for posts gaining at least the window's `trendFloorsPerMin` views a minute now; posts under the
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
import { riserPlace, sortGainIn, sortOrder, sortPlace, sortRunsOf, trendingList, viewedPlace, type SortPlace, type SortReading } from '@insidor/core';

import type { Db, Row } from './queries.ts';
import { RISING_VIEW_SQL } from './queries.ts';
import { withCurrentMarket } from './feed-page.ts';
import { withPictureFiles } from './post-pics.ts';
import { withQuoteFaces } from './quote-faces.ts';
import { withStoryTags } from './story-tags.ts';
import { withTranslations } from './translations.ts';
import { withCardVideos } from './card-video.ts';

export type SortBy = 'trending' | 'most_viewed';

/** The 2026-10-17 windows, still answered for the app built before the redesign. */
export const SORT_WINDOWS = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000 } as const;
export type LegacyWindow = keyof typeof SORT_WINDOWS;
/** The lists the app offers now: Trending's one, Most viewed's three. */
export type ListWindow = 'now' | 'today' | 'week' | 'all';
export type SortWindow = LegacyWindow | ListWindow;
const LIST_WINDOWS: Readonly<Record<SortBy, readonly ListWindow[]>> = { trending: ['now'], most_viewed: ['today', 'week', 'all'] };
const isLegacy = (w: SortWindow): w is LegacyWindow => Object.hasOwn(SORT_WINDOWS, w);

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
select f.item_id, coalesce(f.payload #> '{sheet,counts}', f.payload #> '{sheet,views}') as views, f.payload #>> '{postedAt,at}' as posted_ms, i.source, f.payload #>> '{reach,v}' as total
  from public.feed_post f
  left join public.item i on i.item_id = f.item_id
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload is not null
   and f.payload_at >= $1::timestamptz`;

/**
 * Most viewed over a span: For You's members posted inside it (first seen when the posted time is
 * unknown), with the card's own total and when it was read. No card is read here.
 */
export const SORT_VIEWED_SQL = `
select f.item_id, f.payload #>> '{reach,v}' as views, f.payload #>> '{readAt,at}' as read_ms, i.posted_at, i.first_seen_at, i.source
  from public.feed_post f
  join public.item i on i.item_id = f.item_id
 where f.feed_id = 'fyp'
   and f.withdrawn_at is null
   and f.payload is not null
   and coalesce(i.posted_at, i.first_seen_at) >= $1::timestamptz`;

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

/**
 * The sort, its window and where to start. With no window: Trending now, Most viewed Today. An old
 * window (1h 6h 24h) is answered the old way; a cursor that is not a whole number is refused.
 */
export function parseSort(rawUrl: string): { readonly by: SortBy; readonly window: SortWindow; readonly cursor: number } | null {
  const q = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  const by = q.get('by');
  if (by !== 'trending' && by !== 'most_viewed') return null;
  const w = q.get('window') ?? (by === 'trending' ? 'now' : 'today');
  const c = q.get('cursor') ?? '0';
  if (!/^\d{1,6}$/.test(c)) return null;
  const known = Object.hasOwn(SORT_WINDOWS, w) || (LIST_WINDOWS[by] as readonly string[]).includes(w);
  return known ? { by, window: w as SortWindow, cursor: Number(c) } : null;
}

/** A post's views a minute in the later and earlier half of Trending's window, real views. */
export interface Speeds {
  readonly now: number;
  readonly before: number;
}

export interface SortReply {
  readonly tick: number;
  readonly by: SortBy;
  readonly window: SortWindow;
  readonly posts: readonly unknown[];
  /** Old windows, and Most viewed Today and This week. Per post id: its views gained in the window, rounded. */
  readonly gained?: Readonly<Record<string, number>>;
  /** Trending now only. Per post id: its two speeds. Every listed post has them. */
  readonly speeds?: Readonly<Record<string, Speeds>>;
  /** Most viewed only. Per post id: its total views, the card's own number. */
  readonly views?: Readonly<Record<string, number>>;
  /** Most viewed only: always 0 now; kept for the app built before the third design, which requires it. */
  readonly undated?: number;
  /** New lists only: the cursor of the next page, null when this was the last. */
  readonly next?: string | null;
}

/** Speeds to one decimal under 10 a minute, whole above: what a card can say without false precision. */
const perMin = (v: number): number => (v < 10 ? Math.round(v * 10) / 10 : Math.round(v));

/**
 * The route's work, kept per sort and window until For You's tick moves (the projector's run, about
 * a minute), so many phones on the chip cost one read a run, and every page of one tick is cut from
 * the same ranking. `now` is injected for tests.
 */
export function createSorts(now: () => number = Date.now, policy: Policy = DEFAULT_POLICY) {
  type Kept = { readonly tick: number; readonly at: number; readonly list: readonly Ranked[]; readonly scales: ReadonlyMap<string, number>; readonly totals: ReadonlyMap<string, number> };
  const kept = new Map<string, Kept>();
  return async function sorted(db: Db, by: SortBy, window: SortWindow, cursor = 0): Promise<SortReply | null> {
    const ticks = await db.query(RISING_VIEW_SQL, ['fyp']);
    const view = ticks[0];
    if (view === undefined) return null;
    const tick = Number(view['tick']);
    const nowMs = now();
    const key = `${by}:${window}`;
    let hit = kept.get(key);
    if (hit === undefined || hit.tick !== tick || nowMs - hit.at >= KEEP_MS) {
      hit = { tick, at: nowMs, ...(await rankAll(db, by, window, nowMs, policy)) };
      kept.set(key, hit);
    }
    const legacy = isLegacy(window);
    const page = legacy ? hit.list.slice(0, SHOWN) : hit.list.slice(cursor, cursor + policy.rising.forYouSorts.pageSize);
    const ids = page.map((x) => x.id);
    const cards = ids.length === 0 ? [] : await db.query(SORT_CARDS_SQL, [ids]);
    const byId = new Map(cards.flatMap((c) => (typeof c['item_id'] === 'string' && c['payload'] != null ? [[c['item_id'], withCurrentMarket(c['payload'], msOf(c['payload_at']), nowMs)] as const] : [])));
    const shown = page.filter((x) => byId.has(x.id));
    const posts = await withCardVideos(db, await withQuoteFaces(db, await withPictureFiles(db, await withStoryTags(db, await withTranslations(db, shown.map((x) => byId.get(x.id)))))));
    if (legacy) return { tick, by, window, posts, gained: Object.fromEntries(shown.map((x) => [x.id, Math.round(x.gained)])) };
    const end = cursor + page.length;
    const next = end < hit.list.length ? String(end) : null;
    const scales = hit.scales;
    if (by === 'trending') {
      const speeds = Object.fromEntries(shown.flatMap((x) => {
        const scale = scales.get(x.id) ?? 1;
        return x.speed === null || x.before === null ? [] : [[x.id, { now: perMin(x.speed * scale), before: perMin(x.before * scale) }] as const];
      }));
      return { tick, by, window, posts, speeds, next };
    }
    const totals = hit.totals;
    const views = Object.fromEntries(shown.flatMap((x) => {
      const t = totals.get(x.id);
      return t === undefined ? [] : [[x.id, Math.round(t)] as const];
    }));
    if (window === 'all') return { tick, by, window, posts, views, undated: 0, next };
    return { tick, by, window, posts, views, gained: Object.fromEntries(shown.map((x) => [x.id, Math.round(x.gained)])), undated: 0, next };
  };
}

/** The whole list for a sort and window, in order, with each post's ranking scale and its total views. */
/** How far behind the clock Trending may be ranked (see `rankAll`): longer than a slow full frame, short of an outage. */
const TRENDING_AS_OF_MAX_LAG_MS = 60 * 60_000;

async function rankAll(db: Db, by: SortBy, window: SortWindow, nowMs: number, policy: Policy): Promise<{ readonly list: readonly Ranked[]; readonly scales: ReadonlyMap<string, number>; readonly totals: ReadonlyMap<string, number> }> {
  const p = policy.rising.forYouSorts;
  const scales = new Map<string, number>();
  const totals = new Map<string, number>();
  const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  if (by === 'most_viewed' && window === 'all') {
    /* Every For You post, by its total at its newest reading. */
    const rows = await db.query(SORT_VIEWED_SQL, [new Date(0).toISOString()]);
    const places = rows.flatMap((r: Row) => {
      if (typeof r['item_id'] !== 'string') return [];
      const v = num(r['views']);
      if (v !== null) totals.set(r['item_id'], v);
      const one = viewedPlace(r['item_id'], v, msOf(r['read_ms']), msOf(r['posted_at']), msOf(r['first_seen_at']), Infinity, nowMs, policy);
      return one === null ? [] : [one];
    });
    /* ★ Most viewed is by views alone (the owner, 2026-10-31: "fyp week most viewed doesnt show full week"):
       an older post read less recently is not listed after newer ones, or a 97M-view post sank to 88th. */
    return { list: sortOrder(places, places.length, true), scales, totals };
  }
  const legacy = isLegacy(window);
  const r = p.risers;
  const windowMs = legacy
    ? SORT_WINDOWS[window]
    : by === 'most_viewed'
      ? (window === 'week' ? p.mostViewedSpansMs.week : p.mostViewedSpansMs.today)
      /* Trending now reads back over both spans and the 1h rule's window, whichever is longer. */
      : Math.max(r.nowSpanMs + r.beforeSpanMs, trendingFillWindowMs(policy)) + r.maxMarkGapMs;
  const trendingNow = !legacy && by === 'trending';
  const rows = await db.query(SORT_READINGS_SQL, [new Date(nowMs - windowMs - (trendingNow ? TRENDING_AS_OF_MAX_LAG_MS : 0)).toISOString()]);
  /* ★ TRENDING AS OF THE NEWEST READING THE CARDS HOLD, NOT THE CLOCK (2026-11-03, the owner: "trending
     fyp broke again why"). The cards' readings are the projector's, as of each full frame's start; a
     frame took about 19 minutes that evening, so ten minutes after one landed the last 30 minutes had
     no reading in them and Trending emptied until the next. Ranked as of the newest reading instead,
     the list says what was rising at that moment, which stays true. Past TRENDING_AS_OF_MAX_LAG_MS the
     projector has stalled, and the clock is used again: an empty list, never old risers as current. */
  let rankAt = nowMs;
  if (trendingNow) {
    let newest = Number.NEGATIVE_INFINITY;
    for (const row of rows) for (const x of readingsOf(row['views'])) if (x.atMs > newest && x.atMs <= nowMs) newest = x.atMs;
    if (Number.isFinite(newest) && nowMs - newest <= TRENDING_AS_OF_MAX_LAG_MS) rankAt = newest;
  }
  const risers: Ranked[] = [];
  const places = rows.flatMap((row: Row) => {
    const id = row['item_id'];
    if (typeof id !== 'string') return [];
    const scale = rankScale(row['source'], policy.rising.shortVideoReachScale);
    scales.set(id, scale);
    const t = num(row['total']);
    if (t !== null) totals.set(id, t);
    const readings = readingsOf(row['views']);
    if (legacy || by === 'most_viewed') {
      const one = rankPost(id, readings, msOf(row['posted_ms']), by, windowMs, nowMs, scale, policy);
      return one === null ? [] : [one];
    }
    /* Trending now: fresh posts only, a riser or the 1h rule's pick. */
    const riser = riserPlace(id, readings, msOf(row['posted_ms']), rankAt, policy, scale);
    if (riser !== null && riser.fresh) risers.push(riser);
    const fill = rankPost(id, readings, msOf(row['posted_ms']), 'trending', trendingFillWindowMs(policy), rankAt, scale, policy);
    return fill === null || !fill.fresh ? [] : [fill];
  });
  if (!legacy && by === 'trending') return { list: trendingList(risers, places, policy), scales, totals };
  /* Most viewed Today and This week: by views alone, as All time (above). The old windows keep freshness. */
  return { list: sortOrder(places, places.length, !legacy && by === 'most_viewed'), scales, totals };
}

/** The 1h rule's window, the one the fill comes from: the trending floor's 1h entry. */
function trendingFillWindowMs(policy: Policy): number {
  return policy.rising.forYouSorts.trendFloorsPerMin[0]?.windowMs ?? SORT_WINDOWS['1h'];
}
