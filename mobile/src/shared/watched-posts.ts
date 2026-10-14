/**
 * THE POSTS I WATCH (the owner, 2026-10-14: a Watch star on For You cards and the post sheet; watched
 * posts in the Watchlist tab; "the moment a coin matching a watched post launches or is found …
 * notify me within seconds").
 *
 * Unlike the starred narratives (watchlist.ts, kept on this device), a watched post lives on the
 * alert service (people.post_watch, services/notify/src/post-watch.ts): the alert has to go out while
 * the app is closed, so the server must know. This keeps the list for the screens: read once signed
 * in, changed at once on a tap (the star fills before the server answers) and put back if the
 * server refuses, with the refusal said by the caller.
 *
 * Newest watch first, as the server lists them. What breaks if changed carelessly: the optimistic
 * change must be undone on a refusal, or the star says "watching" while no alert will ever come.
 */

import { notifyCall } from './api/people.ts';

type Listener = () => void;

export interface WatchedPost {
  readonly itemId: string;
  readonly since: number;
}

const path = (itemId: string) => `/post-watch/${encodeURIComponent(itemId)}`;

function createWatchedPosts() {
  let posts: readonly WatchedPost[] = [];
  let ids: readonly string[] = [];
  let state: 'loading' | 'ready' | 'failed' = 'loading';
  /** Moves on every change, list or state: what a screen subscribes to. */
  let version = 0;
  const listeners = new Set<Listener>();
  const changed = () => {
    version += 1;
    for (const l of listeners) l();
  };
  const set = (next: readonly WatchedPost[]) => {
    posts = next;
    ids = next.map((p) => p.itemId);
    changed();
  };
  return {
    ids: () => ids,
    posts: () => posts,
    /** Whether the list has been read from the alert service: still reading, read, or it could not be. */
    state: () => state,
    version: () => version,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    /** Read from the server (signed in). A failure leaves the list as it was. */
    load(): void {
      void notifyCall('GET', '/post-watch').then(
        (r) => {
          const list = (r as { posts?: unknown }).posts;
          state = 'ready';
          set(Array.isArray(list) ? list.flatMap((p: unknown) => (typeof (p as WatchedPost).itemId === 'string' ? [{ itemId: (p as WatchedPost).itemId, since: Number((p as WatchedPost).since) || 0 }] : [])) : []);
        },
        () => {
          state = 'failed';
          changed();
        },
      );
    },
    /** Watch or stop watching; resolves when the server agrees, rejects (and undoes the change) when it does not. */
    async set(itemId: string, on: boolean): Promise<void> {
      const before = posts;
      set(on ? [{ itemId, since: Date.now() }, ...posts.filter((p) => p.itemId !== itemId)] : posts.filter((p) => p.itemId !== itemId));
      try {
        await notifyCall(on ? 'PUT' : 'DELETE', path(itemId));
      } catch (e) {
        set(before);
        throw e;
      }
    },
  };
}

/** The one list the app uses. */
export const watchedPosts = createWatchedPosts();
