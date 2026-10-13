/**
 * FOR YOU, LIVE — the rule for merging a newer read of the feed into the list somebody is looking
 * at. Pure, so the rule is tested rather than watched (feed.test.ts); useLiveFeed.ts does the
 * listening and the scrolling, LiveCard.tsx the slide-in.
 *
 * ★ NEW POSTS GO IN AT THE TOP, AND NOTHING ELSE MOVES. The owner's rule (2026-10-14): "never
 * reorder or remove cards while I'm looking at them." So a newer read may only ADD: posts the list
 * does not hold go in above everything, in the server's order among themselves; a post the list
 * holds keeps its place and takes the newer copy of its facts (views, coin line); a post the server
 * no longer lists stays where it is. The server's own order and its removals are taken whole only
 * when the list is rebuilt (`reconcile`), and useLiveFeed.ts rebuilds it only when nobody can be
 * looking at a card: pull to refresh, coming back to the app, opening the FYP tab, first load.
 * A post that passed the bar late can be older than the one above it; it still goes in at the top,
 * where it is seen, and takes its place by age at the next rebuild.
 *
 * ★ OFF UNLESS THE BUILD SAYS EXACTLY `VITE_LIVE_FEED=on`. Until the owner approves, a deployed
 * build reads For You exactly as before: on opening, on pull to refresh and on coming back.
 *
 * What breaks if changed carelessly: letting `merge` drop or reorder rows brings back cards that
 * jump under a thumb; letting it re-announce a row the list already holds replays its slide-in.
 */

import type { RisingPost } from '../../shared/api/index.ts';

export function liveFeedOn(env: { readonly VITE_LIVE_FEED?: string | undefined }): boolean {
  return env.VITE_LIVE_FEED === 'on';
}

export const LIVE_FEED = liveFeedOn({ VITE_LIVE_FEED: import.meta.env?.['VITE_LIVE_FEED'] as string | undefined });

/** How often the backup asks for the feed's number while For You is open and on screen. */
export const BACKUP_CHECK_MS = 30_000;

/** Several new posts slide in one after another, this far apart; past a handful they all go together. */
export const STAGGER_MS = 120;
export const STAGGER_MAX = 6;

export interface Merged {
  readonly rows: readonly RisingPost[];
  /** The ids that are new to the list, top first. Empty when the read added nothing. */
  readonly arrived: readonly string[];
}

/** A newer read, merged in at the top only (see the header). */
export function merge(shown: readonly RisingPost[], incoming: readonly RisingPost[]): Merged {
  const held = new Set(shown.map((p) => p.id));
  const fresh = new Map(incoming.map((p) => [p.id, p] as const));
  const arrivals = incoming.filter((p) => !held.has(p.id));
  return {
    rows: [...arrivals, ...shown.map((p) => fresh.get(p.id) ?? p)],
    arrived: arrivals.map((p) => p.id),
  };
}

/** The list rebuilt from the server's read: its order, its removals. No slide-ins. */
export function reconcile(incoming: readonly RisingPost[]): Merged {
  return { rows: incoming, arrived: [] };
}

/** How long a card waits before it slides in: one after another, from the top. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_MS;
}
