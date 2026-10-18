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
 * ★ THE RANKING KEYS, EXACTLY (the owner, 2026-10-18). W is the chosen window, H = W / 2, now is
 * the request's time.
 *   gain(a, b)    the post's views gained in [a, b), by the rule above
 *   read(a, b)    how much of [a, b) lies between its first and last reading
 *   rate(a, b)    gain(a, b) / read(a, b), views a minute; known only when the post has a reading
 *                 of its own inside [a, b) and read(a, b) >= W / 12
 *
 *   Most viewed   key = gain(now - W, now): views gained, never a total. On the list only with a
 *                 reading inside the window; a post last read before it has no gain in it we can
 *                 vouch for and is left off, never listed at zero (the phone drops a card with no
 *                 number), which puts it below every post that is on the list.
 *   Trending      key = rate(now - H, now) - rate(now - W, now - H): how many views a minute faster it
 *                 is gaining in the window's second half than in its first. Both halves must be known,
 *                 each from a reading of its own, so a post read once — or read either side of one
 *                 long gap spread across both halves, which makes the two rates equal by construction
 *                 — has no trend yet. Such a post, read in the window, is listed after every post with
 *                 a trend, by its views gained: it cannot top Trending. A post slowing down has a
 *                 negative key and sinks; a big post gaining steadily is near zero. So Trending is no
 *                 longer Most viewed over the last half window, which it was while the key was the
 *                 speed itself times a capped speed-up (2026-10-17 to 18).
 *
 * ★ FRESHNESS (the owner, 2026-10-18: "a post can only rank in the top 20 of either sort if its
 * latest reading is less than 30 minutes old"). A post whose newest counted reading is FRESH_MS old
 * or more is listed after every post read since, on both sorts and every window, so the top of each
 * list is posts read in the last half hour whenever there are that many. A post whose readings
 * stopped — one that left the live frame, which the readings loop no longer reads, or a short video
 * between its hourly reads — cannot sit at the top on a gain it made hours ago. Nothing is read to
 * keep posts fresh here: more reads are money, the owner's call.
 *
 *   Order: fresh with a key, stale with a key, then (Trending only) fresh with no trend, stale with
 *   no trend; inside each, the key; ties the newer post first, then the id in byte order. The top
 *   SHOWN are sent.
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
 * the window (`gained`), a fact true whether or not Insidor exists; the speeds, the key and the tier
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
 * a post read hourly a trend of zero instead of none; ranking a stale post by its key alone puts
 * yesterday's climb at the top of today's list; counting past the last reading invents views; and
 * sending `key` puts the system's reasoning on a screen.
 */

import { DEFAULT_POLICY } from '@insidor/contracts';

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
/** A half-window rate needs at least this share of the window read: W / 12 (5m of 1h, 2h of 24h). */
const MIN_READ_SHARE = 12;
const MINUTE_MS = 60_000;
/** A post last read this long ago or more is listed after every post read since (the owner, 2026-10-18: 30 minutes). */
export const FRESH_MS = 30 * MINUTE_MS;
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

export interface Reading {
  readonly atMs: number;
  readonly value: number | null;
}

type Run = readonly [number, number, number];

/** One post's gains as runs between consecutive counted readings, and when it was first and last read. */
export function runsOf(readings: readonly Reading[]): { readonly runs: readonly Run[]; readonly first: number | null; readonly last: number | null; readonly times: readonly number[] } {
  const pts = readings.filter((r): r is { atMs: number; value: number } => r.value !== null && Number.isFinite(r.value)).sort((a, b) => a.atMs - b.atMs);
  const runs: Run[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined || b.atMs <= a.atMs) continue;
    runs.push([a.atMs, b.atMs, Math.max(0, b.value - a.value)]);
  }
  return { runs, first: pts[0]?.atMs ?? null, last: pts[pts.length - 1]?.atMs ?? null, times: pts.map((p) => p.atMs) };
}

/** Views gained in [from, to): each run's gain spread evenly over its own time. */
export function gainIn(runs: readonly Run[], from: number, to: number): number {
  let sum = 0;
  for (const run of runs) {
    const overlap = Math.min(run[1], to) - Math.max(run[0], from);
    if (overlap > 0) sum += (run[2] * overlap) / (run[1] - run[0]);
  }
  return sum;
}

function readIn(first: number | null, last: number | null, from: number, to: number): number {
  return first === null || last === null ? 0 : Math.max(0, Math.min(last, to) - Math.max(first, from));
}

export interface Ranked {
  readonly id: string;
  /** Views gained in the window: the one number the card shows. */
  readonly gained: number;
  /** The ordering key. Never leaves this file's caller; never on the wire. */
  readonly key: number;
  /** 0 fresh with a key, 1 stale with a key, 2 fresh with no trend, 3 stale with no trend. Never on the wire. */
  readonly tier: 0 | 1 | 2 | 3;
  readonly postedMs: number | null;
  /** When its newest counted reading was taken. */
  readonly lastReadMs: number;
}

/**
 * One post's place on a list, or null when it is not on it (see the header for the exact keys).
 * `scale` divides its gains for the Trending key alone (rankScale); `gained` stays its real views.
 */
export function rankPost(id: string, readings: readonly Reading[], postedMs: number | null, by: SortBy, windowMs: number, nowMs: number, scale: number = 1): Ranked | null {
  const { runs, first, last, times } = runsOf(readings);
  const from = nowMs - windowMs;
  if (last === null || readIn(first, last, from, nowMs) <= 0) return null;
  const gained = gainIn(runs, from, nowMs);
  const fresh = nowMs - last < FRESH_MS;
  const base = { id, gained, postedMs, lastReadMs: last };
  if (by === 'most_viewed') return { ...base, key: gained, tier: fresh ? 0 : 1 };
  const half = from + windowMs / 2;
  const minRead = windowMs / MIN_READ_SHARE;
  /* A half's rate needs a reading of its own inside it, and enough of it read. */
  const rate = (a: number, b: number, inside: (t: number) => boolean): number | null => {
    const r = readIn(first, last, a, b);
    return r < minRead || !times.some(inside) ? null : gainIn(runs, a, b) / scale / (r / MINUTE_MS);
  };
  const now = rate(half, nowMs, (t) => t >= half && t <= nowMs);
  const then = rate(from, half, (t) => t >= from && t < half);
  if (now === null || then === null) return { ...base, key: gained / scale, tier: fresh ? 2 : 3 };
  return { ...base, key: now - then, tier: fresh ? 0 : 1 };
}

/** The list in order: tier, then key, then newer first, then id in byte order. */
export function ranked(rows: readonly Ranked[], shown: number = SHOWN): readonly Ranked[] {
  return [...rows]
    .sort((a, b) => a.tier - b.tier || b.key - a.key || (b.postedMs ?? -Infinity) - (a.postedMs ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, shown);
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
