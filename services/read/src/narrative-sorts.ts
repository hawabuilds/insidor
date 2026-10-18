/**
 * GET /narratives/:viewId/all?sort=…&offset=N[&on=x|tiktok] — the Narratives tab's lists, as For
 * You's sorts (the owner, 2026-10-18: "the Narratives tab works exactly like For You's sorts"),
 * 20 at a time with `next` the offset of the next page, null on the last.
 *
 *   new       newest first by when we found its first post, all time, dead ones included
 *   trending  one list, right now: core rank/narrative-sorts.ts `narrativeTrending` over each live
 *             narrative's speeds (its posts' For You speeds added up, written on its page by the
 *             projector), risers by how many times faster, filled when fewer than 5. Dead ones and
 *             pages whose speeds were made `freshMs` ago or more are not on it
 *   today     views gained over the last 24 hours, the posts' gains added up (the page's
 *   week      `viewsGainedDay` / `viewsGainedWeek`); a page that does not say is left off, never 0
 *   viewed    every narrative by its views, dead ones included (Most viewed, All)
 *   `on`      only narratives with a post on X, or on TikTok (any of its posts); absent: all of them
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
 * "TikTok", services/project db.ts `sourceLabel`); renaming one there empties that filter here.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts';
import { narrativeTrending, type NarrativeSpeeds } from '@insidor/core';

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

export interface NarrativeListAsk {
  readonly sort: NarrativeSort;
  readonly offset: number;
  readonly on: Site | null;
}

/** The sort (New when absent), where to start and the site; null for anything else. */
export function parseNarrativeList(rawUrl: string): NarrativeListAsk | null {
  const q = new URLSearchParams(rawUrl.split('?')[1] ?? '');
  const sort = q.get('sort') ?? 'new';
  const raw = q.get('offset') ?? '0';
  const on = q.get('on');
  if (!(NARRATIVE_SORTS as readonly string[]).includes(sort) || !/^\d{1,6}$/.test(raw) || Number(raw) > MAX_OFFSET) return null;
  if (on !== null && on !== 'x' && on !== 'tiktok') return null;
  return { sort: sort as NarrativeSort, offset: Number(raw), on };
}

/** Only observed pages, as Search; `$3` the site's label or null for every site. */
const ON_SITE = `($3::text is null or payload -> 'evidence' @> jsonb_build_array(jsonb_build_object('sourceLabel', $3::text)))`;
export const LIST_VIEWED_SQL = `select payload from public.story_view
  where payload #>> '{provenance,kind}' = 'observed' and ${ON_SITE}
  order by views_total desc nulls last, story_id limit $1 offset $2`;
export const LIST_NEW_SQL = `select payload from public.story_view
  where payload #>> '{provenance,kind}' = 'observed' and ${ON_SITE}
  order by found_at desc nulls last, story_id limit $1 offset $2`;

/** Every observed page's few numbers, narrow: no page is read whole here. */
export const LIST_NUMBERS_SQL = `select story_id, dead, projected_at, views_total,
       payload -> 'viewsPerMinute' as speeds,
       payload #>> '{viewsGainedDay,v}' as day, payload #>> '{viewsGainedWeek,v}' as week,
       payload -> 'evidence' @> '[{"sourceLabel":"X"}]' as on_x,
       payload -> 'evidence' @> '[{"sourceLabel":"TikTok"}]' as on_tiktok
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
  readonly on: ReadonlySet<Site>;
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
  return { id: r['story_id'], dead: r['dead'] === true, projectedMs: msOf(r['projected_at']), views: num(r['views_total']), speeds: speedsOf(r['speeds']), day: num(r['day']), week: num(r['week']), on };
}

/** The list for a ranked sort, in order: ids only. */
export function rankNarratives(rows: readonly NumbersRow[], sort: 'trending' | 'today' | 'week', on: Site | null, nowMs: number, policy: Policy = DEFAULT_POLICY): readonly string[] {
  const mine = rows.filter((r) => on === null || r.on.has(on));
  if (sort === 'trending') {
    const live = mine.flatMap((r) => (r.dead || r.speeds === null ? [] : [{ id: r.id, speeds: r.speeds, fresh: r.projectedMs !== null && nowMs - r.projectedMs < policy.rising.forYouSorts.freshMs }]));
    return narrativeTrending(live, (s) => rankScale(s, policy.rising.shortVideoReachScale), policy).map((x) => x.id);
  }
  const key = (r: NumbersRow): number | null => (sort === 'today' ? r.day : r.week);
  return mine
    .filter((r) => key(r) !== null)
    .sort((a, b) => (key(b) as number) - (key(a) as number) || (b.views ?? -1) - (a.views ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
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
      const rows = await db.query(ask.sort === 'viewed' ? LIST_VIEWED_SQL : LIST_NEW_SQL, [size, ask.offset, label]);
      return { stories: rows.map((r) => r['payload']), next: rows.length < size ? null : ask.offset + rows.length };
    }
    const nowMs = now();
    const key = `${ask.sort}:${ask.on ?? 'all'}`;
    let hit = kept.get(key);
    if (hit === undefined || hit.tick !== tick || nowMs - hit.at >= KEEP_MS) {
      const rows = (await db.query(LIST_NUMBERS_SQL, [])).flatMap((r) => numbersOf(r) ?? []);
      hit = { tick, at: nowMs, ids: rankNarratives(rows, ask.sort, ask.on, nowMs, policy) };
      kept.set(key, hit);
    }
    const ids = hit.ids.slice(ask.offset, ask.offset + size);
    const pages = ids.length === 0 ? [] : await db.query(LIST_PAGES_SQL, [ids]);
    const byId = new Map(pages.flatMap((p) => (typeof p['story_id'] === 'string' ? [[p['story_id'], p['payload']] as const] : [])));
    const end = ask.offset + ids.length;
    return { stories: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)] : [])), next: end < hit.ids.length ? end : null };
  };
}
