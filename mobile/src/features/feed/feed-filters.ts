/**
 * WHAT THE FEED'S FILTERS KEEP, AND WHAT THEY CANNOT DECIDE.
 *
 * ★ THE VIEW STEPS ARE NAMED HERE AND PASSED IN. A number like 100K written inside a
 * component is a product call made by whoever was typing (tools/check-app-vocabulary.mjs
 * fails a comparison against one in a `.tsx`). These are the steps the filter offers, they
 * are a menu rather than a judgement about any row, and they live in one named constant that
 * the panel is handed — so the day the read service serves its own list, this constant is
 * replaced by that and nothing in a component changes.
 *
 * ★ AN UNKNOWN NEVER PASSES A FILTER, AND IS COUNTED. A row whose views were not reported
 * cannot be called "50K+"; a row whose start nobody read cannot be called "last hour"; a row
 * whose site we have not learned cannot be called "TikTok". Each is left out — and the count
 * of rows left out for that reason is returned, so the feed can say "3 hidden: we can't tell"
 * rather than look as if they did not exist.
 */

import type { Platform } from '../../shared/platform.ts';
import type { BoardRow } from '../../shared/api/index.ts';
import type { RisingPost } from '../../shared/api/index.ts';
import { platformOf } from '../../shared/platform.ts';
import type { LeadPost } from './lead-post.ts';

const HOUR = 3_600_000;

export interface ViewStep {
  readonly label: string;
  readonly atLeast: number;
}

/** The view steps the filter offers. A menu, not a judgement about any row. */
export const VIEW_STEPS: readonly ViewStep[] = [
  { label: '50K+', atLeast: 50_000 },
  { label: '100K+', atLeast: 100_000 },
  { label: '500K+', atLeast: 500_000 },
  { label: '1M+', atLeast: 1_000_000 },
];

export interface PostedWindow {
  readonly label: string;
  readonly withinMs: number;
}

export const POSTED_WINDOWS: readonly PostedWindow[] = [
  { label: 'Last hour', withinMs: HOUR },
  { label: '6 hours', withinMs: 6 * HOUR },
  { label: '24 hours', withinMs: 24 * HOUR },
];

export type CoinFilter = 'any' | 'none' | 'has';

export interface FeedFilters {
  /** Empty means every site. */
  readonly sites: readonly Platform[];
  readonly views: ViewStep | null;
  readonly posted: PostedWindow | null;
  readonly coin: CoinFilter;
}

export const NO_FILTERS: FeedFilters = { sites: [], views: null, posted: null, coin: 'any' };

export function isFiltered(f: FeedFilters): boolean {
  return f.sites.length > 0 || f.views !== null || f.posted !== null || f.coin !== 'any';
}

export interface Filtered {
  readonly rows: readonly BoardRow[];
  /** Left out because a value the filter needs is not known — not because it failed. */
  readonly unknown: number;
}

type Match = 'keep' | 'drop' | 'unknown';

function bySite(f: FeedFilters, lead: LeadPost | null | undefined): Match {
  if (f.sites.length === 0) return 'keep';
  if (lead === undefined || lead === null || lead.platform === null) return 'unknown';
  return f.sites.includes(lead.platform) ? 'keep' : 'drop';
}

function byViews(f: FeedFilters, row: BoardRow): Match {
  if (f.views === null) return 'keep';
  if (!row.reach.known) return 'unknown';
  return row.reach.amount >= f.views.atLeast ? 'keep' : 'drop';
}

function byPosted(f: FeedFilters, row: BoardRow, now: number): Match {
  if (f.posted === null) return 'keep';
  if (!row.firstSeenAt.known) return 'unknown';
  const age = now - row.firstSeenAt.at;
  if (age < 0) return 'unknown';
  return age <= f.posted.withinMs ? 'keep' : 'drop';
}

/** "Has a coin" includes an unsure match: coins exist, we only cannot say which is the one. */
function byCoin(f: FeedFilters, row: BoardRow): Match {
  if (f.coin === 'any') return 'keep';
  const none = row.coins.kind === 'none';
  return (f.coin === 'none') === none ? 'keep' : 'drop';
}

export function applyFilters(
  rows: readonly BoardRow[],
  leads: ReadonlyMap<string, LeadPost | null>,
  f: FeedFilters,
  now: number,
): Filtered {
  const kept: BoardRow[] = [];
  let unknown = 0;
  for (const row of rows) {
    const answers = [bySite(f, leads.get(row.id)), byViews(f, row), byPosted(f, row, now), byCoin(f, row)];
    if (answers.includes('drop')) continue;
    if (answers.includes('unknown')) {
      unknown += 1;
      continue;
    }
    kept.push(row);
  }
  return { rows: kept, unknown };
}

/* ── the same filters, on single posts ────────────────────────────────── */

export interface FilteredPosts {
  readonly rows: readonly RisingPost[];
  /** Left out because a value the filter needs is not known — not because it failed. */
  readonly unknown: number;
}

/**
 * The feed filters applied to single posts. The site comes from the post's own label, the
 * views and the age from its own facts.
 *
 * ★ THE COIN FILTER SAYS "NO COIN" ONLY ABOUT A POST WHOSE NAME WAS SEARCHED. `none` is "no
 * coin"; `one`, `several` and `unsure` are "has a coin" (coins exist, as on a narrative); a post
 * not searched yet (`pending`) is counted as unknown under either — never as a match.
 */
export function applyPostFilters(posts: readonly RisingPost[], f: FeedFilters, now: number): FilteredPosts {
  const kept: RisingPost[] = [];
  let unknown = 0;
  for (const post of posts) {
    const platform = platformOf(post.sourceLabel);
    const site: Match = f.sites.length === 0 ? 'keep' : platform === null ? 'unknown' : f.sites.includes(platform) ? 'keep' : 'drop';
    const views: Match = f.views === null ? 'keep' : !post.reach.known ? 'unknown' : post.reach.amount >= f.views.atLeast ? 'keep' : 'drop';
    let posted: Match = 'keep';
    if (f.posted !== null) {
      if (!post.postedAt.known || now - post.postedAt.at < 0) posted = 'unknown';
      else posted = now - post.postedAt.at <= f.posted.withinMs ? 'keep' : 'drop';
    }
    const coin: Match =
      f.coin === 'any' ? 'keep' : post.coins.kind === 'pending' || post.coins.kind === 'unchecked' ? 'unknown' : (f.coin === 'none') === (post.coins.kind === 'none') ? 'keep' : 'drop';
    const answers = [site, views, posted, coin];
    if (answers.includes('drop')) continue;
    if (answers.includes('unknown')) {
      unknown += 1;
      continue;
    }
    kept.push(post);
  }
  return { rows: kept, unknown };
}
