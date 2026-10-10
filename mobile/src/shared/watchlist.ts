/**
 * THE STORIES SOMEBODY HAS STARRED, kept on this device.
 *
 * Local because there is no account yet — the desktop watchlist makes the same call
 * (app/src/features/watchlist/watchlist-store.ts) — and inventing a server-side one to hold a
 * list of ids would be the largest thing in this package. Its own key, so the two apps on one
 * machine do not quietly edit each other's lists.
 *
 * Storage can throw (private mode, blocked site data) or come back empty. Every read and write
 * is guarded, and a failure degrades to "nothing starred" rather than to a broken screen.
 */

const KEY = 'insidor.mobile.watchlist.v1';

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Listener = () => void;

export interface Watchlist {
  ids(): readonly string[];
  has(id: string): boolean;
  toggle(id: string): void;
  subscribe(l: Listener): () => void;
}

export function createWatchlist(storage: Storage | null): Watchlist {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    ids = [];
  }
  const listeners = new Set<Listener>();
  return {
    ids: () => ids,
    has: (id) => ids.includes(id),
    toggle(id) {
      ids = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      try {
        storage?.setItem(KEY, JSON.stringify(ids));
      } catch {
        /* Kept for this session only; nothing else to do about a store that refuses. */
      }
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The one watchlist the app uses. */
export const watchlist = createWatchlist(browserStorage());
