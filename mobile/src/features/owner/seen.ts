/**
 * WHAT WAS ON THE OWNER'S SCREEN, BATCHED FOR THE SERVER (the owner, 2026-10-18: "Track what's on
 * my screen in the app to know this. Doesn't count: posts I never scrolled to.").
 *
 * Two facts are noted, the first time each happens to a post in this session:
 *   on screen  a For You or narrative-page card at least `VISIBLE_SHARE` visible for `ON_SCREEN_MS`
 *              without a break (useSeen.ts times it); the moment it came into view is sent
 *   opened     its post sheet was opened, from anywhere
 * They are sent every `SEND_EVERY_MS` and when the page is hidden (POST /owner/seen), at most
 * `MAX_BATCH` a request. Nothing is shown from them, on any card or screen.
 *
 * ★ THE OWNER ONLY. `isOwner` is asked when a fact is noted and again when a batch is sent: for
 * anyone else, or before the services have said, nothing is kept and nothing leaves the phone. The
 * server checks the owner from the sign-in token as well, and a 403 or a server without the route
 * (404) stops the sending for the session.
 *
 * Pure, with the sender and the owner check passed in, so it runs under `node --test`.
 *
 * What breaks if changed carelessly: re-sending a post already sent is harmless (the server keeps
 * the earliest time), but dropping a failed batch is not — a kept post would be one never seen, and
 * the owner's soft yes would lose exactly the posts he looked at while the network was down. A
 * failed batch goes back in the queue; only the batch sent as the page closes is not retried.
 */

import type { SeenPost, SeenSurface } from '../../shared/api/owner.ts';

/** On screen for this long, without a break, is "on my screen for at least 2 seconds". */
export const ON_SCREEN_MS = 2_000;
/** At least this share of the card in view counts as on screen. */
export const VISIBLE_SHARE = 0.5;
/** How often a card in view is measured while it is on screen. */
export const CHECK_EVERY_MS = 250;
/** A batch at most this often. */
export const SEND_EVERY_MS = 10_000;
/** The server's own limit on one request. */
export const MAX_BATCH = 200;

export type SendResult = 'ok' | 'gone' | 'failed';

export interface SeenBatch {
  onScreen(itemId: string, surface: Exclude<SeenSurface, 'sheet'>, atMs: number): void;
  opened(itemId: string, atMs: number): void;
  /** Sends what is waiting; `closing` as the page is hidden (sent once, not retried). */
  flush(closing?: boolean): Promise<void>;
  /** How many posts wait to be sent (for tests). */
  waiting(): number;
}

export function createSeenBatch(deps: { readonly send: (posts: readonly SeenPost[], closing: boolean) => Promise<SendResult>; readonly isOwner: () => boolean }): SeenBatch {
  const pending = new Map<string, { surface: SeenSurface; onScreenAt: number | undefined; openedAt: number | undefined }>();
  const sentOnScreen = new Set<string>();
  const sentOpened = new Set<string>();
  let stopped = false;
  let sending = false;

  /* The first time of each kind wins: a later sight of a post already waiting changes nothing. */
  const keep = (itemId: string, surface: SeenSurface, onScreenAt: number | undefined, openedAt: number | undefined) => {
    if (stopped || !deps.isOwner()) return;
    const had = pending.get(itemId);
    pending.set(itemId, { surface: had?.surface ?? surface, onScreenAt: had?.onScreenAt ?? onScreenAt, openedAt: had?.openedAt ?? openedAt });
  };

  return {
    onScreen(itemId, surface, atMs) {
      if (!sentOnScreen.has(itemId)) keep(itemId, surface, atMs, undefined);
    },
    opened(itemId, atMs) {
      if (!sentOpened.has(itemId)) keep(itemId, 'sheet', undefined, atMs);
    },
    async flush(closing = false) {
      if (!deps.isOwner()) {
        pending.clear();
        return;
      }
      if (stopped || sending || pending.size === 0) return;
      sending = true;
      try {
        while (pending.size > 0 && !stopped) {
          const batch = [...pending.entries()].slice(0, MAX_BATCH);
          for (const [id] of batch) pending.delete(id);
          const posts: SeenPost[] = batch.map(([itemId, p]) => ({ itemId, surface: p.surface, ...(p.onScreenAt === undefined ? {} : { onScreenAt: p.onScreenAt }), ...(p.openedAt === undefined ? {} : { openedAt: p.openedAt }) }));
          const r = await deps.send(posts, closing);
          if (r === 'gone') {
            stopped = true;
            pending.clear();
          } else if (r === 'failed') {
            if (!closing) for (const [id, p] of batch) if (!pending.has(id)) pending.set(id, p);
            return;
          } else {
            for (const p of posts) {
              if (p.onScreenAt !== undefined) sentOnScreen.add(p.itemId);
              if (p.openedAt !== undefined) sentOpened.add(p.itemId);
            }
          }
        }
      } finally {
        sending = false;
      }
    },
    waiting: () => pending.size,
  };
}
