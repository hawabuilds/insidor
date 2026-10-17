/**
 * GET /rising/fyp/sorted?by=trending|most_viewed&window=1h|6h|24h — For You's Trending and Most
 * viewed chips (the owner, 2026-10-17). New is the frame and its scroll (feed-page.ts), unchanged.
 *
 * WHO IS ELIGIBLE: For You's members (public.feed_post, `fyp`, not withdrawn), the posts the judge
 * passed onto For You. No other post can reach these lists.
 *
 * HOW A POST'S VIEWS GAINED ARE COUNTED: from its own readings only, the ones the projector already
 * stored on its card (`payload.sheet.views`, measured counts; a censored reading is null and is
 * skipped). No new read of anything. The rule is the narrative chart's (core/src/group/narrative.ts
 * `narrativeReach`): between two readings the gain is spread evenly over the time between them, a
 * lower count than the one before adds nothing, and before the first reading or after the last it
 * adds nothing, never a guess forward. post-sorts.test.ts holds this file to that function.
 *
 * ★ THE RANKING KEYS, EXACTLY. W is the chosen window, H = W / 2, now is the request's time.
 *   gain(a, b)    the post's views gained in [a, b), by the rule above
 *   read(a, b)    how much of [a, b) lies between its first and last reading
 *   rate(a, b)    gain(a, b) / read(a, b), views a minute; unknown when read(a, b) < W / 12
 *
 *   Most viewed   key = gain(now - W, now). Eligible when the post was read at all inside the window
 *                 (read > 0). Views gained, not lifetime views: "Most viewed 24h" is the last day's.
 *   Trending      now  = rate(now - H, now)       how fast it is gaining in the window's second half
 *                 then = rate(now - W, now - H)   how fast it was gaining in the first half
 *                 speedUp = (now + 1) / (then + 1), held between 1/4 and 4; 1 when `then` is unknown
 *                 (a post too new to have a before is neither rewarded nor marked down for it)
 *                 key = now × speedUp. Eligible when `now` is known.
 *                 So a post gaining 400 a minute that was gaining 50 (×4, key 1,600) passes one gaining
 *                 1,000 a minute that was gaining 1,500 (×0.67, key 667): picking up beats being big.
 *                 A two-hour-old post that suddenly takes off goes to the top of 1h.
 *   Ties: the newer post first, then the id in byte order. The top SHOWN are sent.
 *
 * ★ A SHORT VIDEO IS RANKED IN A TEXT POST'S VIEWS. The short-video source's views run an order of
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
 * the window (`gained`), a fact true whether or not Insidor exists; the speed, the speed-up and the
 * key stay in this process. A post with no reading in the window is not on either list, rather than
 * listed at zero: an unread post is not a post nobody watched.
 *
 * WHY THIS COMPUTES, in a service whose rule is that nothing here does: the projector was the other
 * place, and it would have meant a ranked table per sort and window written every run for a chip few
 * people press. Everything this needs is already on the public cards, the work is a few hundred
 * small arrays, and it is done once per projector run per sort and window (the reply is kept until
 * the feed's tick moves), so it costs the database one indexed-size read a minute at most.
 *
 * What breaks if changed carelessly: dropping the coverage test lets a post read once in the last
 * minute claim a speed from one interval; counting past the last reading invents views; and sending
 * `key` puts the system's reasoning on a screen.
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
/** The speed-up is held inside [1/4, 4] so one quiet interval cannot make a post rank on its ratio alone. */
const SPEED_UP_MAX = 4;
/** One view a minute added to both sides of the speed-up, so 0 to 3 a minute is not "infinitely faster". */
const SPEED_UP_EASE = 1;
const MINUTE_MS = 60_000;
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
 */
export const SORT_READINGS_SQL = `
select f.item_id, f.payload #> '{sheet,views}' as views, f.payload #>> '{postedAt,at}' as posted_ms, i.source
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
export function runsOf(readings: readonly Reading[]): { readonly runs: readonly Run[]; readonly first: number | null; readonly last: number | null } {
  const pts = readings.filter((r): r is { atMs: number; value: number } => r.value !== null && Number.isFinite(r.value)).sort((a, b) => a.atMs - b.atMs);
  const runs: Run[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined || b.atMs <= a.atMs) continue;
    runs.push([a.atMs, b.atMs, Math.max(0, b.value - a.value)]);
  }
  return { runs, first: pts[0]?.atMs ?? null, last: pts[pts.length - 1]?.atMs ?? null };
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
  readonly postedMs: number | null;
}

/**
 * One post's place on a list, or null when it is not on it (see the header for the exact keys).
 * `scale` divides its gains for the key alone (rankScale); `gained` stays its real views.
 */
export function rankPost(id: string, readings: readonly Reading[], postedMs: number | null, by: SortBy, windowMs: number, nowMs: number, scale: number = 1): Ranked | null {
  const { runs, first, last } = runsOf(readings);
  const from = nowMs - windowMs;
  const read = readIn(first, last, from, nowMs);
  if (read <= 0) return null;
  const gained = gainIn(runs, from, nowMs);
  if (by === 'most_viewed') return { id, gained, key: gained, postedMs };
  const half = from + windowMs / 2;
  const minRead = windowMs / MIN_READ_SHARE;
  const rate = (a: number, b: number): number | null => {
    const r = readIn(first, last, a, b);
    return r < minRead ? null : gainIn(runs, a, b) / scale / (r / MINUTE_MS);
  };
  const now = rate(half, nowMs);
  if (now === null) return null;
  const then = rate(from, half);
  const speedUp = then === null ? 1 : Math.min(SPEED_UP_MAX, Math.max(1 / SPEED_UP_MAX, (now + SPEED_UP_EASE) / (then + SPEED_UP_EASE)));
  return { id, gained, key: now * speedUp, postedMs };
}

/** The list in order: key, then newer first, then id in byte order. */
export function ranked(rows: readonly Ranked[], shown: number = SHOWN): readonly Ranked[] {
  return [...rows]
    .sort((a, b) => b.key - a.key || (b.postedMs ?? -Infinity) - (a.postedMs ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
