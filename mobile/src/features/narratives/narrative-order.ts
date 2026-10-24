/**
 * The Narratives tab's rules, apart from the screen so `node --test` holds them: which narratives
 * are listed, the sorts and pills the tab offers, the words on each card, and the choice the phone
 * remembers.
 *
 * ★ FOR YOU'S SORTS (the owner, 2026-10-18: "the Narratives tab works exactly like For You's
 * sorts"). The same chips in the same order (features/feed feed-sort.ts SORTS): New, Trending, Most
 * viewed; Most viewed's Today / Week / All at the right end of the All / X / TikTok row. The ORDER is
 * the server's (services/read narrative-sorts.ts, which says exactly how each is ranked), read 20 at
 * a time; this file only decides which list is showing and words the facts a card carries:
 *
 *   Listed       only real narratives: the server says the story was observed (`provenance`), never
 *                a seeded or hand-written one, and it lists at least one post
 *   New          newest first by when we found its first post, dead ones too, marked Dead
 *   Trending     right now, no window: "394 views a minute, up 1.4x in the last hour" (For You's
 *                own words, feed-sort.ts speedLine), from the narrative's posts' speeds added up
 *   Most viewed  Today and Week: its views and "+8.1M today" / "+X this week" under them; All: views
 *   All X TikTok the narratives with a post on that site, on every sort
 *   No coin yet  beside them, for creators (the owner, 2026-10-18): only the narratives whose card
 *                says "No coin yet" (searched, no coin found, no top coin; never one still being
 *                checked), with any site pill and on every sort. The server decides which
 *
 * ★ AN UNKNOWN IS NEVER 0. Views no post reported are a dash, a gain the server could not say is
 * left out of the line, never "+0".
 *
 * ★ THE CHOICE IS REMEMBERED on this phone (localStorage), under the key the tab always used, so a
 * choice stored before this design keeps its sort (Trending, Most viewed, New) and Most viewed's
 * All time stays All; any other old window falls back to Today. A phone that cannot keep it (a
 * private window) gets the defaults, never an error.
 */

import type { NarrativeListSort, PostSpeeds, Story } from '../../shared/api/index.ts';
import { formatDuration } from '../../shared/format/duration.ts';
import { compact } from '../../shared/format/number.ts';
import { DEFAULT_CHOICE as FOR_YOU_DEFAULT, type PostSort, type ViewedSpan } from '../feed/feed-sort.ts';

export type Site = 'all' | 'x' | 'tiktok';
/** The site pills, plain words (the owner, 2026-10-18). */
export const SITES: readonly { readonly key: Site; readonly label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'x', label: 'X' },
  { key: 'tiktok', label: 'TikTok' },
];

export interface Choice {
  readonly sort: PostSort;
  /** Most viewed's span; the other sorts have none. */
  readonly span: ViewedSpan;
  readonly site: Site;
  /** The "No coin yet" pill, on or off; it combines with the site. */
  readonly noCoin: boolean;
}
export const DEFAULT_CHOICE: Choice = { sort: FOR_YOU_DEFAULT.sort, span: FOR_YOU_DEFAULT.span, site: 'all', noCoin: false };
/** The pill's words, the card's own. */
export const NO_COIN_PILL = 'No coin yet';

/**
 * The card's "See N coins", left of Create: null when none were made after its oldest post or the
 * server did not count (the button is then not drawn, never "See 0 coins").
 */
export function seeCoinsText(n: number | null): string | null {
  if (n === null || n <= 0) return null;
  return n === 1 ? 'See 1 coin' : `See ${n} coins`;
}

/** The server's list for the choice (GET /narratives/:view/all?sort=…). */
export function listOf(c: Choice): NarrativeListSort {
  if (c.sort === 'new') return 'new';
  if (c.sort === 'trending') return 'trending';
  return c.span === 'today' ? 'today' : c.span === 'week' ? 'week' : 'viewed';
}

/** Only narratives the server says happened, with a post to show. */
export function realNarratives(list: readonly Story[]): readonly Story[] {
  return list.filter((s) => s.provenance.kind === 'observed' && s.evidence.length > 0);
}

const foundOf = (s: Story): number | null => (s.foundAt !== null && s.foundAt.known ? s.foundAt.at : s.firstSeenAt.known ? s.firstSeenAt.at : null);
/** Its views, all its posts' newest counts added up; null when the server could not say. */
const viewsOf = (s: Story): number | null => (s.viewsTotal !== null && s.viewsTotal.known ? s.viewsTotal.amount : null);

/** "3.4M", its views; null when no post reported any. */
export function viewsText(s: Story): string | null {
  const v = viewsOf(s);
  return v === null ? null : compact(v);
}

/** Views gained in Most viewed's span, Today or Week; null on All or when the server could not say. */
export function gainedIn(s: Story, span: ViewedSpan): number | null {
  const g = span === 'today' ? s.viewsGainedDay : span === 'week' ? s.viewsGainedWeek : null;
  return g !== null && g.known ? g.amount : null;
}

/** Trending's two speeds, as For You's card takes them. */
export const speedsOf = (s: Story): PostSpeeds | null => s.viewsPerMinute;

/** The last hour's gain, "+12K": Home's Watchlist card. Null when the server did not say. */
export function hourGainText(s: Story): string | null {
  const g = s.inWindow?.get(1)?.viewsGained;
  const amount = g !== undefined ? (g.known ? g.amount : null) : s.viewsGained1h !== null && s.viewsGained1h.known ? s.viewsGained1h.amount : null;
  return amount === null ? null : `${amount >= 0 ? '+' : ''}${compact(amount)}`;
}

/** The window Trending lists a story by its viral posts in (the server's `narrative.trend.listWindowHours`), said "today". */
const VIRAL_WINDOW_HOURS = 24;

/**
 * "Posts over 40K views from 8 accounts today": the accounts whose post went up in the last 24 hours
 * and has at least the views the server names, added up over `stories` (one card, or every meme war
 * under the umbrella) — the fact Trending lists them by (policy.v162). Null when no story says, or none.
 */
export function viralLine(stories: readonly Story[]): string | null {
  const said = stories.flatMap((s) => {
    const w = s.inWindow?.get(VIRAL_WINDOW_HOURS);
    return w === undefined || w.viralAccounts === null || w.viralMinViews === null ? [] : [{ n: w.viralAccounts, bar: w.viralMinViews }];
  });
  const n = said.reduce((sum, x) => sum + x.n, 0);
  const bar = said[0]?.bar ?? null;
  if (n <= 0 || bar === null) return null;
  return `Posts over ${compact(bar)} views from ${n} account${n === 1 ? '' : 's'} today`;
}

/** The card's line under the title: its post count, its age since we found it, "28m old", and Dead. Facts only. */
export function cardLine(s: Story, now: number): readonly string[] {
  const n = s.postCount ?? s.evidence.length;
  const found = foundOf(s);
  /* ★ Dead is said: no new post in 48 hours. */
  return [n === 1 ? '1 post' : `${n} posts`, ...(found !== null && now >= found ? [`${formatDuration(now - found)} old`] : []), ...(s.dead ? ['Dead'] : [])];
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
 * holds. An id the list does not hold is left out, never drawn as an empty card.
 */
export function starredNarratives(list: readonly Story[], starred: readonly string[]): readonly Story[] {
  const byId = new Map(realNarratives(list).map((s) => [s.id, s]));
  return starred.flatMap((id) => {
    const s = byId.get(id);
    return s === undefined ? [] : [s];
  });
}

const KEY = 'insidor.narratives.order';
const isSort = (v: unknown): v is PostSort => v === 'new' || v === 'trending' || v === 'most_viewed';
const isSpan = (v: unknown): v is ViewedSpan => v === 'today' || v === 'week' || v === 'all';
const isSite = (v: unknown): v is Site => v === 'all' || v === 'x' || v === 'tiktok';
/** The sort a choice stored before this design meant. */
const OLD_ORDER: Readonly<Record<string, PostSort>> = { trending: 'trending', viewed: 'most_viewed', new: 'new' };

/** The remembered choice, or the defaults part by part when there is none or it cannot be read. */
export function loadChoice(store: Pick<Storage, 'getItem'> | null): Choice {
  try {
    const raw = store?.getItem(KEY);
    if (raw === null || raw === undefined) return DEFAULT_CHOICE;
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return DEFAULT_CHOICE;
    const r = o as Record<string, unknown>;
    if ('order' in r) {
      /* Stored before this design: { order, windows: { trending, viewed } }. */
      const order = typeof r['order'] === 'string' ? OLD_ORDER[r['order']] : undefined;
      const w = r['windows'];
      const viewed = typeof w === 'object' && w !== null ? (w as Record<string, unknown>)['viewed'] : undefined;
      return { sort: order ?? DEFAULT_CHOICE.sort, span: viewed === 'all' ? 'all' : 'today', site: 'all', noCoin: false };
    }
    return { sort: isSort(r['sort']) ? r['sort'] : DEFAULT_CHOICE.sort, span: isSpan(r['span']) ? r['span'] : DEFAULT_CHOICE.span, site: isSite(r['site']) ? r['site'] : DEFAULT_CHOICE.site, noCoin: r['noCoin'] === true };
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
