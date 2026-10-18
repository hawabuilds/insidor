/**
 * The Narratives tab's rules, apart from the screen so `node --test` holds them: which narratives
 * are listed, the three orders behind its chips, the window beside them, the words on each card,
 * and the choice the phone remembers.
 *
 *   Listed       only real narratives: the server says the story was observed (`provenance`), never
 *                a seeded or hand-written one, and it lists at least one post
 *   Trending     the default (the owner, 2026-10-17): the server's trending place for the window
 *                (services/project narrative-trend.ts) — how fast the story is picking up, not how
 *                big it is. Only the place reaches the phone; the number behind it never does.
 *                ★ A dead narrative (no new post in 48 hours, the owner 2026-10-18) is never here
 *   Most viewed  views gained IN the window ("Most viewed 24h" is the last 24 hours, not lifetime);
 *                on All time, every narrative ever made, dead ones too, by its views, from the
 *                server 20 at a time (GET /narratives/:view/all?sort=viewed)
 *   New          first found (`foundAt`, the earliest save of any post it lists), newest first: every
 *                narrative ever made, dead ones too, from the server 20 at a time (sort=new)
 *   Window       1h 6h 24h on Trending; 1h 6h 24h All time on Most viewed: 1h for Trending, 24h for
 *                Most viewed until the user picks another. New has none
 *
 * ★ AN UNKNOWN NEVER SORTS AS ZERO. A narrative whose number the server did not send, or could not
 * say, goes after every one that has it, in the board's order among themselves, so a missing number
 * can neither promote a card nor bury it as the slowest.
 *
 * ★ THE CHOICE IS REMEMBERED on this phone (localStorage), the chip and each chip's window; a phone
 * that cannot keep it (a private window) gets the defaults, never an error.
 */

import type { Story } from '../../shared/api/index.ts';
import { formatDuration } from '../../shared/format/duration.ts';
import { compact } from '../../shared/format/number.ts';

export const ORDERS = ['trending', 'viewed', 'new'] as const;
export type Order = (typeof ORDERS)[number];
export const ORDER_LABEL: Readonly<Record<Order, string>> = { trending: 'Trending', viewed: 'Most viewed', new: 'New' };

export const WINDOWS = [1, 6, 24] as const;
export type WindowHours = (typeof WINDOWS)[number];
/** Every narrative ever made: Most viewed's last window. */
export const ALL_TIME = 'all' as const;
export type Window = WindowHours | typeof ALL_TIME;
/** The windows each chip offers: Trending is what is picking up now, so it has no All time. */
export const VIEWED_WINDOWS: readonly Window[] = [...WINDOWS, ALL_TIME];
export const WINDOW_LABEL: Readonly<Record<Window, string>> = { 1: '1h', 6: '6h', 24: '24h', all: 'All time' };

/** The chip and each windowed chip's window, as the user last left them. */
export interface Choice {
  readonly order: Order;
  readonly windows: { readonly trending: WindowHours; readonly viewed: Window };
}
export const DEFAULT_CHOICE: Choice = { order: 'trending', windows: { trending: 1, viewed: 24 } };

/** The window the chosen chip uses; New has none. */
export const windowOf = (c: Choice): Window | null => (c.order === 'new' ? null : c.windows[c.order]);

/** The windows the chosen chip offers; New has none. */
export const windowsOf = (o: Order): readonly Window[] => (o === 'trending' ? WINDOWS : o === 'viewed' ? VIEWED_WINDOWS : []);

/**
 * Which of the server's whole lists the choice reads, 20 at a time: Most viewed on All time by views,
 * New by when we found it. Null: the board (Trending, and Most viewed over 1h, 6h or 24h).
 */
export function allTimeOf(c: Choice): 'viewed' | 'new' | null {
  if (c.order === 'new') return 'new';
  if (c.order === 'viewed' && c.windows.viewed === ALL_TIME) return 'viewed';
  return null;
}

/** Only narratives the server says happened, with a post to show. */
export function realNarratives(list: readonly Story[]): readonly Story[] {
  return list.filter((s) => s.provenance.kind === 'observed' && s.evidence.length > 0);
}

const placeOf = (s: Story, h: WindowHours): number | null => s.inWindow?.get(h)?.trendingPlace ?? null;
/** Views gained in the window, or null when the server did not send it or could not say. */
export const gainedIn = (s: Story, h: WindowHours): number | null => {
  const g = s.inWindow?.get(h)?.viewsGained;
  if (g !== undefined) return g.known ? g.amount : null;
  /* A server from before the windows: its last hour is the same number for 1h. */
  return h === 1 && s.viewsGained1h !== null && s.viewsGained1h.known ? s.viewsGained1h.amount : null;
};
const foundOf = (s: Story): number | null => (s.foundAt !== null && s.foundAt.known ? s.foundAt.at : s.firstSeenAt.known ? s.firstSeenAt.at : null);

/** Known first by `key` (`dir` 1: highest first, -1: lowest first); unknowns after, in the order they came. */
function by(list: readonly Story[], key: (s: Story) => number | null, dir: 1 | -1): readonly Story[] {
  const known = list.filter((s) => key(s) !== null);
  const unknown = list.filter((s) => key(s) === null);
  return [...known].sort((a, b) => dir * ((key(b) ?? 0) - (key(a) ?? 0))).concat(unknown);
}

/** Its views, all its posts' newest counts added up; null when the server could not say. */
const viewsOf = (s: Story): number | null => (s.viewsTotal !== null && s.viewsTotal.known ? s.viewsTotal.amount : null);

export function ordered(list: readonly Story[], choice: Choice): readonly Story[] {
  const h = windowOf(choice);
  if (choice.order === 'new' || h === null) return by(list, foundOf, 1);
  if (h === ALL_TIME) return by(list, viewsOf, 1);
  if (choice.order === 'viewed') return by(list, (s) => gainedIn(s, h), 1);
  /* ★ Trending is the stories still picking up: a dead one is never in it. */
  const live = list.filter((s) => !s.dead);
  /* A server from before the trending places: its board order is the last hour's gain. */
  if (!live.some((s) => placeOf(s, h) !== null)) return by(live, (s) => gainedIn(s, h), 1);
  return by(live, (s) => placeOf(s, h), -1);
}

/** "+12K" gained in the window, or on All time its views, "3.4M"; null when the server did not say. */
export function gainText(s: Story, h: Window): string | null {
  if (h === ALL_TIME) {
    const v = viewsOf(s);
    return v === null ? null : compact(v);
  }
  const g = gainedIn(s, h);
  return g === null ? null : `${g >= 0 ? '+' : ''}${compact(g)}`;
}

/**
 * The card's line under the title: on a windowed chip "3 new posts" in the window (or "No new
 * posts"), on New the post count; then the story's age since we found it, "28m old". Facts only.
 */
export function cardLine(s: Story, h: Window | null, now: number): readonly string[] {
  const n = s.postCount ?? s.evidence.length;
  const fresh = h === null || h === ALL_TIME ? null : (s.inWindow?.get(h)?.newPosts ?? null);
  const posts = fresh === null ? (n === 1 ? '1 post' : `${n} posts`) : fresh === 0 ? 'No new posts' : fresh === 1 ? '1 new post' : `${fresh} new posts`;
  const found = foundOf(s);
  /* ★ Dead is said: no new post in 48 hours. */
  return [posts, ...(found !== null && now >= found ? [`${formatDuration(now - found)} old`] : []), ...(s.dead ? ['Dead'] : [])];
}

/**
 * The Watchlist card's line (Home, features/feed): "12 posts   3.4M views" — the post count and the
 * narrative's views (its posts' newest views summed, as the narrative page counts them; the story's
 * reach from a server that sends no sum), both facts. Views nobody could report say so; never 0.
 */
export function watchLine(s: Story): readonly string[] {
  const n = s.postCount ?? s.evidence.length;
  const views = s.viewsTotal !== null && s.viewsTotal.known ? s.viewsTotal.amount : s.reach.known ? s.reach.amount : null;
  return [n === 1 ? '1 post' : `${n} posts`, views !== null ? `${compact(views)} views` : 'views not reported'];
}

/**
 * The narratives starred on this phone, in the order they were starred, from the real ones the list
 * holds. An id the list does not hold is left out, never drawn as an empty card: a story id starred
 * before the narrative rebuild (the old ids, not `n-…`) or a narrative no longer listed.
 */
export function starredNarratives(list: readonly Story[], starred: readonly string[]): readonly Story[] {
  const byId = new Map(realNarratives(list).map((s) => [s.id, s]));
  return starred.flatMap((id) => {
    const s = byId.get(id);
    return s === undefined ? [] : [s];
  });
}

const KEY = 'insidor.narratives.order';
const isWindow = (v: unknown): v is WindowHours => v === 1 || v === 6 || v === 24;
const isViewedWindow = (v: unknown): v is Window => isWindow(v) || v === ALL_TIME;

/** The remembered choice, or the defaults when there is none or it cannot be read. */
export function loadChoice(store: Pick<Storage, 'getItem'> | null): Choice {
  try {
    const raw = store?.getItem(KEY);
    if (raw === null || raw === undefined) return DEFAULT_CHOICE;
    const o = JSON.parse(raw) as { order?: unknown; windows?: { trending?: unknown; viewed?: unknown } };
    const order = ORDERS.find((x) => x === o.order) ?? DEFAULT_CHOICE.order;
    const t = o.windows?.trending;
    const v = o.windows?.viewed;
    return { order, windows: { trending: isWindow(t) ? t : DEFAULT_CHOICE.windows.trending, viewed: isViewedWindow(v) ? v : DEFAULT_CHOICE.windows.viewed } };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function saveChoice(store: Pick<Storage, 'setItem'> | null, c: Choice): void {
  try {
    store?.setItem(KEY, JSON.stringify(c));
  } catch {
    /* A phone that cannot keep it starts from the defaults next time. */
  }
}
