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
 * ★ FOR YOU GOES IN BY TIME (the owner, 2026-10-17: "new at the top old at the bottom"). Given its
 * order (feed-order.ts, newest posted first), a new post goes in where its time puts it — at the
 * top when it is the newest, lower when it passed the bar late — and the shown cards keep their
 * order among themselves; useLiveFeed.ts holds the card being looked at still either way. Without
 * an order (the Narratives tab) new rows go in at the top, as before.
 *
 * ★ OFF UNLESS THE BUILD SAYS EXACTLY `VITE_LIVE_FEED=on`. Until the owner approves, a deployed
 * build reads For You exactly as before: on opening, on pull to refresh and on coming back.
 *
 * The owner's hidden posts are left out again where the list is drawn (Feed.tsx `withoutHidden`), so
 * a post held in the list before it was hidden goes too, and comes back on "Is a meme".
 *
 * What breaks if changed carelessly: letting `merge` drop or reorder rows brings back cards that
 * jump under a thumb; letting it re-announce a row the list already holds replays its slide-in.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import { mergeInOrder, type Order } from './feed-order.ts';

export function liveFeedOn(env: { readonly VITE_LIVE_FEED?: string | undefined }): boolean {
  return env.VITE_LIVE_FEED === 'on';
}

export const LIVE_FEED = liveFeedOn({ VITE_LIVE_FEED: import.meta.env?.['VITE_LIVE_FEED'] as string | undefined });

/** How often the backup asks for the feed's number while For You is open and on screen. */
export const BACKUP_CHECK_MS = 30_000;

/** Several new posts slide in one after another, this far apart; past a handful they all go together. */
export const STAGGER_MS = 120;
export const STAGGER_MAX = 6;

export interface Merged<T extends { readonly id: string } = RisingPost> {
  readonly rows: readonly T[];
  /** The ids that are new to the list, top first. Empty when the read added nothing. */
  readonly arrived: readonly string[];
}

/**
 * A newer read, merged in at the top only (see the header). A post the owner hid (`hidden`,
 * features/owner/owner-store.ts) never arrives: the server keeps serving it until the projector's
 * next run, and it must not slide in, move the list, or count as new in the meantime.
 */
export function merge<T extends { readonly id: string }>(shown: readonly T[], incoming: readonly T[], hidden: ReadonlySet<string> = new Set(), order: Order<T> | null = null): Merged<T> {
  const held = new Set(shown.map((p) => p.id));
  const fresh = new Map(incoming.map((p) => [p.id, p] as const));
  const arrivals = incoming.filter((p) => !held.has(p.id) && !hidden.has(p.id));
  if (order !== null) {
    /* In order: each new post at its time, the shown ones in theirs (feed-order.ts). */
    const rows = mergeInOrder(shown, arrivals, order, { fresh: true, unplaced: 'top' }).map((p) => fresh.get(p.id) ?? p);
    return { rows, arrived: rows.filter((p) => !held.has(p.id)).map((p) => p.id) };
  }
  return {
    rows: [...arrivals, ...shown.map((p) => fresh.get(p.id) ?? p)],
    arrived: arrivals.map((p) => p.id),
  };
}

/** The list rebuilt from the server's read: its order, its removals. No slide-ins. */
export function reconcile<T extends { readonly id: string }>(incoming: readonly T[]): Merged<T> {
  return { rows: incoming, arrived: [] };
}

/** How long a card waits before it slides in: one after another, from the top. */
export function staggerDelay(index: number): number {
  return Math.min(index, STAGGER_MAX) * STAGGER_MS;
}
