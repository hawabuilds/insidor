/**
 * GET /narratives/:viewId/all?sort=…&offset=N[&on=x|tiktok][&coin=none] — the Narratives tab's lists, as For
 * You's sorts (the owner, 2026-10-18: "the Narratives tab works exactly like For You's sorts"),
 * 20 at a time with `next` the offset of the next page, null on the last.
 *
 *   new       newest first by when we found its first post, all time, dead ones included
 *   trending  one list, right now: core rank/narrative-sorts.ts `narrativeTrending` over each live
 *             narrative's speeds (its posts' For You speeds added up, written on its page by the
 *             projector), risers by how many times faster, filled when fewer than 5: first with
 *             the others over the floor, then with the fresh pages' measured last-hour gains
 *             (`narrativeTrendingIds`, for when readings are too thin for speeds). Dead ones and
 *             pages made `freshMs` ago or more are not on it
 *   today     views gained over the last 24 hours, the posts' gains added up (the page's
 *   week      `viewsGainedDay` / `viewsGainedWeek`); a page that does not say is left off, never 0,
 *             and so is a page measured `GAIN_FRESH_MS` ago or more (`gainNow`)
 *   viewed    every narrative by its views, dead ones included (Most viewed, All)
 *   `on`      only narratives with a post on X, or on TikTok (any of its posts); absent: all of them
 *   `coin`    `none`: only the narratives whose card says "No coin yet" (the owner, 2026-10-18, for
 *             creators), with `on` and on every sort. See `NO_COIN_YET` for exactly which
 *
 * ★ new AND viewed READ THROUGH story_view's 0106 INDEXES, a page at a time. trending, today and
 * week order by numbers on the pages, so they read every observed page's few numbers (one narrow
 * statement, about 400 rows and 25 ms on 18 Oct), rank them once per board tick, and cut each page
 * from that one ranking, so pages of one tick never overlap.
 *
 * ★ THE ORDER IS NEVER SENT. The reply is the pages in order; the speeds and gains on each page are
 * facts a reader can check. The ratio, the floor and the list's groups stay in this process.
 *
 * What breaks if changed carelessly: the site labels are the page's own `sourceLabel` ("X",
 * "TikTok", services/project db.ts `sourceLabel`); renaming one there empties that filter here. And `NO_COIN_YET` must stay the card's "No coin
 * yet": widen it to `pending` and the pill offers Create on names nobody has searched.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { narrativeTrendingIds, type NarrativeSpeeds } from '@insidor/core';

import { rankScale } from './post-sorts.ts';
import type { Db, Row } from './queries.ts';

export const NARRATIVE_SORTS = ['new', 'trending', 'today', 'week', 'viewed'] as const;
export type NarrativeSort = (typeof NARRATIVE_SORTS)[number];
/** The site pills, by the page's own label for the site. */
export const SITE_LABELS = { x: 'X', tiktok: 'TikTok' } as const;
export type Site = keyof typeof SITE_LABELS;

/** How deep a list pages: past this an offset is a malformed request, not a slow scan. */
const MAX_OFFSET = 100_000;
/** A ranking is kept no longer than this even when the board's tick has not moved (a stalled projector). */
const KEEP_MS = 120_000;
/**
 * ★ A PAGE'S GAIN IS "TODAY" ONLY WHILE IT IS FRESH. The projector measures `viewsGainedDay` and
 * `viewsGainedWeek` over the span ending when it wrote the page, and a page it has not written
 * again keeps that number. On 23 Oct the top of Today was pages written 4 and 5 days before
 * ("Meguro Clinic Baby Exposure", +11.5M, its posts last read on 19 Oct): their "today" was the
 * day they were found. A page written longer ago than this does not know what its posts gained
 * since, so it is left off Today and Week (as one with no gain), never ranked on an old day. The
 * board's pages are rewritten every minute and the rest a few a minute in turn (narrative-frame.ts,
 * `narrative.dead.pagesPerFrame`), so a narrative still being read is back once its turn comes.
 * Widen this and an old day reads as today again; narrow it under that turn and live ones go.
 */
export const GAIN_FRESH_MS = 3_600_000;

export interface NarrativeListAsk {
  readonly sort: NarrativeSort;
  readonly offset: number;
  readonly on: Site | null;
  /** True: only the narratives with no coin yet (`NO_COIN_YET`). */
  readonly noCoin: boolean;
}

/** The sort (New when absent), where to start, the site and the coin pill; null for anything else. */
export function parseNarrativeList(rawUrl: string): NarrativeListAsk | null {
  const q = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  const sort = q.get('sort') ?? 'new';
  const raw = q.get('offset') ?? '0';
  const on = q.get('on');
  const coin = q.get('coin');
  if (!(NARRATIVE_SORTS as readonly string[]).includes(sort) || !/^\d{1,6}$/.test(raw) || Number(raw) > MAX_OFFSET) return null;
  if (on !== null && on !== 'x' && on !== 'tiktok') return null;
  if (coin !== null && coin !== 'none') return null;
  return { sort: sort as NarrativeSort, offset: Number(raw), on, noCoin: coin === 'none' };
}

/**
 * ★ "NO COIN YET" IS THE CARD'S OWN STATE, NOT A GUESS ABOUT ONE. A narrative is on the pill's list
 * exactly when its card says "No coin yet" with Create (mobile narrative/story-coin.ts): the
 * projector searched its name and found no coin (`coins.kind = 'none'`) and there is no top coin.
 * Left off, each for its own reason:
 *
 *   pending   its name has not been searched yet ("still checking"): no coin is a claim not checked
 *   unsure    coins with its name exist and none is settled: not "no coin", only not a sure one
 *   one/several, or a top coin   it has a coin
 *
 * So the pill never offers Create on a name that may already be taken.
 */
const NO_COIN_YET = `(payload #>> '{coins,kind}' = 'none' and coalesce(jsonb_typeof(payload -> 'topCoin'), 'null') = 'null')`;

/** Only observed pages, as Search; `$3` the site's label or null for every site. */
const ON_SITE = `($3::text is null or payload -> 'evidence' @> jsonb_build_array(jsonb_build_object('sourceLabel', $3::text)))`;
/** `$4` true: only the narratives with no coin yet. */
const NO_COIN = `($4::boolean is not true or ${NO_COIN_YET})`;
export const LIST_VIEWED_SQL = `select payload from public.story_view
  where payload #>> '{provenance,kind}' = 'observed' and ${ON_SITE} and ${NO_COIN}
  order by views_total desc nulls last, story_id limit $1 offset $2`;
export const LIST_NEW_SQL = `select payload from public.story_view
  where payload #>> '{provenance,kind}' = 'observed' and ${ON_SITE} and ${NO_COIN}
  order by found_at desc nulls last, story_id limit $1 offset $2`;

/** Every observed page's few numbers, narrow: no page is read whole here. */
export const LIST_NUMBERS_SQL = `select story_id, dead, projected_at, views_total,
       payload -> 'viewsPerMinute' as speeds,
       payload #>> '{viewsGainedDay,v}' as day, payload #>> '{viewsGainedWeek,v}' as week,
       payload #>> '{viewsGained1h,v}' as hour,
       payload -> 'evidence' @> '[{"sourceLabel":"X"}]' as on_x,
       payload -> 'evidence' @> '[{"sourceLabel":"TikTok"}]' as on_tiktok,
       ${NO_COIN_YET} as no_coin
  from public.story_view where payload #>> '{provenance,kind}' = 'observed'`;
export const LIST_PAGES_SQL = `select story_id, payload from public.story_view where story_id = any($1::text[])`;

export interface NumbersRow {
  readonly id: string;
  readonly dead: boolean;
  readonly projectedMs: number | null;
  readonly views: number | null;
  readonly speeds: NarrativeSpeeds | null;
  readonly day: number | null;
  readonly week: number | null;
  /** Views gained in the last hour, as the page measured it; null when it did not. */
  readonly hour: number | null;
  readonly on: ReadonlySet<Site>;
  readonly noCoin: boolean;
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const msOf = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/** A page's speeds as the projector wrote them, or null when it wrote none or not this shape. */
export function speedsOf(raw: unknown): NarrativeSpeeds | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const now = num(o['now']);
  const before = num(o['before']);
  const posts = num(o['posts']);
  const by = o['nowBySource'];
  if (now === null || before === null || posts === null || typeof by !== 'object' || by === null) return null;
  const nowBySource = Object.fromEntries(Object.entries(by as Record<string, unknown>).flatMap(([k, v]) => (num(v) === null ? [] : [[k, num(v) as number]])));
  return { now, before, posts, nowBySource };
}

export function numbersOf(r: Row): NumbersRow | null {
  if (typeof r['story_id'] !== 'string') return null;
  const on = new Set<Site>();
  if (r['on_x'] === true) on.add('x');
  if (r['on_tiktok'] === true) on.add('tiktok');
  return { id: r['story_id'], dead: r['dead'] === true, projectedMs: msOf(r['projected_at']), views: num(r['views_total']), speeds: speedsOf(r['speeds']), day: num(r['day']), week: num(r['week']), hour: num(r['hour']), on, noCoin: r['no_coin'] === true };
}

/** The page's gain over Today's or Week's span as of `nowMs`, or null: none measured, or measured too long ago (`GAIN_FRESH_MS`). */
export function gainNow(r: NumbersRow, span: 'today' | 'week', nowMs: number): number | null {
  if (r.projectedMs === null || nowMs - r.projectedMs >= GAIN_FRESH_MS) return null;
  return span === 'today' ? r.day : r.week;
}

/** The list for a ranked sort, in order: ids only. */
export function rankNarratives(rows: readonly NumbersRow[], sort: 'trending' | 'today' | 'week', on: Site | null, nowMs: number, policy: Policy = DEFAULT_POLICY, noCoin = false): readonly string[] {
  const mine = rows.filter((r) => (on === null || r.on.has(on)) && (!noCoin || r.noCoin));
  if (sort === 'trending') {
    const fresh = (r: NumbersRow): boolean => r.projectedMs !== null && nowMs - r.projectedMs < policy.rising.forYouSorts.freshMs;
    const live = mine.flatMap((r) => (r.dead || r.speeds === null ? [] : [{ id: r.id, speeds: r.speeds, fresh: fresh(r) }]));
    const gains = mine.flatMap((r) => (r.dead ? [] : [{ id: r.id, gained: r.hour, fresh: fresh(r) }]));
    return narrativeTrendingIds(live, (s) => rankScale(s, policy.rising.shortVideoReachScale), policy, gains);
  }
  const key = (r: NumbersRow): number | null => gainNow(r, sort, nowMs);
  return mine
    .filter((r) => key(r) !== null)
    .sort((a, b) => (key(b) as number) - (key(a) as number) || (b.views ?? -1) - (a.views ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
}

/**
 * ★ A LIST SENDS EACH NARRATIVE AS ITS CARD, NOT ITS WHOLE PAGE. The tab's card (mobile
 * features/narratives Narratives.tsx) reads the title, picture, post count, age, Dead, views, the
 * day's and week's gains, the two speeds and the coin line; it never reads the page's chart series
 * (`viewsGained`, `viewsGainedAll`), its per-post views (`postViews`), its trend windows
 * (`inWindow`) or its discussion, and of its posts (`evidence`) only that there is one. Those were
 * four fifths of a page (18 Oct: a Most viewed Today page was 413 KB for 20 cards). The page itself,
 * GET /story/:id, still sends everything; a tap opens it.
 *
 * Each field cut is one the phone's decoder accepts as absent (a series or a map read as null) or
 * keeps as a list; nothing is renamed, and the payload's own `postCount` carries the count.
 */
const CARD_DROPS = ['viewsGained', 'viewsGainedAll', 'postViews', 'inWindow'] as const;

export function cardOf(page: unknown): unknown {
  if (typeof page !== 'object' || page === null || Array.isArray(page)) return page;
  const out: Record<string, unknown> = { ...(page as Record<string, unknown>) };
  for (const k of CARD_DROPS) delete out[k];
  if (Array.isArray(out['evidence'])) out['evidence'] = out['evidence'].slice(0, 1);
  if (Array.isArray(out['discussion'])) out['discussion'] = [];
  return out;
}

export interface ListPage {
  readonly stories: readonly unknown[];
  readonly next: number | null;
}

/**
 * The lists' work. A ranked sort is ranked once per board tick (and site), kept at most `KEEP_MS`;
 * `now` is injected for tests.
 */
export function createNarrativeLists(now: () => number = Date.now, policy: Policy = DEFAULT_POLICY) {
  const kept = new Map<string, { readonly tick: number; readonly at: number; readonly ids: readonly string[] }>();
  return async function list(db: Db, tick: number, ask: NarrativeListAsk): Promise<ListPage> {
    const size = policy.rising.forYouSorts.pageSize;
    const label = ask.on === null ? null : SITE_LABELS[ask.on];
    if (ask.sort === 'new' || ask.sort === 'viewed') {
      const rows = await db.query(ask.sort === 'viewed' ? LIST_VIEWED_SQL : LIST_NEW_SQL, [size, ask.offset, label, ask.noCoin]);
      return { stories: rows.map((r) => cardOf(r['payload'])), next: rows.length < size ? null : ask.offset + rows.length };
    }
    const nowMs = now();
    const key = `${ask.sort}:${ask.on ?? 'all'}:${ask.noCoin ? 'no-coin' : 'any'}`;
    let hit = kept.get(key);
    if (hit === undefined || hit.tick !== tick || nowMs - hit.at >= KEEP_MS) {
      const rows = (await db.query(LIST_NUMBERS_SQL, [])).flatMap((r) => numbersOf(r) ?? []);
      hit = { tick, at: nowMs, ids: rankNarratives(rows, ask.sort, ask.on, nowMs, policy, ask.noCoin) };
      kept.set(key, hit);
    }
    const ids = hit.ids.slice(ask.offset, ask.offset + size);
    const pages = ids.length === 0 ? [] : await db.query(LIST_PAGES_SQL, [ids]);
    const byId = new Map(pages.flatMap((p) => (typeof p['story_id'] === 'string' ? [[p['story_id'], p['payload']] as const] : [])));
    const end = ask.offset + ids.length;
    return { stories: ids.flatMap((id) => (byId.has(id) ? [cardOf(byId.get(id))] : [])), next: end < hit.ids.length ? end : null };
  };
}
