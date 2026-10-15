/**
 * WHAT THE OWNER JUST DID, HELD IN THE APP UNTIL THE SERVICES CATCH UP.
 *
 * The projector hides a post on its next run, which can be several minutes after the tap; the
 * owner's tap must hide it now. So every "Not a meme" and "Is a meme" on a post is held here, and a
 * post whose newest call is "Not a meme" is left out of every list the app draws (For You, Popular,
 * their older pages, the live list, a narrative's posts, search) whatever the server is still
 * serving. The newest hide is also held for the bar that asks why, and every call the owner made
 * this session is held so the card says what was said without asking the server again.
 *
 * ★ KEPT ON THE DEVICE, AND SEEDED FROM THE SERVER. The post calls are written to storage, so a
 * reload, a phone that killed the app in the background, or coming back the next morning does not
 * bring a hidden post back while the projector is still behind. And on every owner sign-in the
 * server's own list of hidden posts (`seed`, from GET /owner/hidden) is folded in, so a hide made on
 * another device or before storage was cleared is held too. The newest call per post wins, by its
 * date, whichever side it came from; "Is a meme" takes the post out of the set the same way.
 * A held call is kept on the device for a day (`KEEP_MS`): by then the projection has long caught
 * up, and the server's list re-seeds anything still hidden.
 *
 * Pure, with a subscribe for React (hooks.ts) and storage and clock passed in, so it runs under
 * `node --test`.
 *
 * What breaks if changed carelessly: a hide that the server refused must be undone here
 * (`failed`), or the post vanishes from the owner's screen while staying on everyone else's — and
 * now it would stay vanished across reloads. Clearing the held calls on a not-yet-known owner
 * (`setOwner(null)`, which a wallet reconnecting passes through) would bring hidden posts back on
 * every reconnect; only a sign-in the services say is NOT the owner forgets them.
 */

import type { RisingPost } from '../../shared/api/index.ts';
import type { SavedCall } from '../../shared/api/owner.ts';

export interface JustHidden {
  readonly itemId: string;
  /** The card's facts, sent again with a note so the "Hidden by me" list can draw it. */
  readonly shown: Readonly<Record<string, string | number | boolean | null>>;
}

export interface OwnerState {
  /** null until the services have answered whether this sign-in is the owner. */
  readonly owner: boolean | null;
  /** The posts whose newest call, here or on the server, is "Not a meme". */
  readonly hidden: ReadonlySet<string>;
  readonly justHidden: JustHidden | null;
  /** This session's calls, newest per key (`callKey`). */
  readonly calls: ReadonlyMap<string, SavedCall>;
  /** A call the services refused or never received, said in the owner's bar. */
  readonly problem: string | null;
}

/** The newest call on one post, and when it was made. */
export interface PostCall {
  readonly call: 'not' | 'meme';
  readonly at: number;
}

/** What the store needs of localStorage; every use is guarded, since storage can throw. */
export interface KeptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A held call is kept on the device this long; the server's own list re-seeds anything still hidden. */
export const KEEP_MS = 24 * 3_600_000;
const KEY = 'insidor.mobile.owner.posts.v1';

const EMPTY: OwnerState = { owner: null, hidden: new Set(), justHidden: null, calls: new Map(), problem: null };

export const callKey = (c: { readonly kind: string; readonly itemId: string; readonly name?: string | null }): string =>
  `${c.kind}\u0000${c.itemId}\u0000${c.kind === 'name' ? (c.name ?? '') : ''}`;

const hiddenOf = (posts: ReadonlyMap<string, PostCall>): ReadonlySet<string> =>
  new Set([...posts].filter(([, c]) => c.call === 'not').map(([id]) => id));

/** The held calls read back, the ones older than a day dropped. Anything malformed is skipped. */
export function readKept(raw: string | null, now: number): Map<string, PostCall> {
  const out = new Map<string, PostCall>();
  if (raw === null) return out;
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    if (!Array.isArray(r)) continue;
    const [id, call, at] = r as unknown[];
    if (typeof id !== 'string' || id === '' || (call !== 'not' && call !== 'meme') || typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (now - at > KEEP_MS) continue;
    out.set(id, { call, at });
  }
  return out;
}

function defaultStorage(): KeptStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createOwnerStore(opts: { readonly storage?: KeptStorage | null; readonly now?: () => number } = {}) {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  let posts = new Map<string, PostCall>();
  try {
    posts = readKept(storage?.getItem(KEY) ?? null, now());
  } catch {
    /* Storage refused: the set starts empty, and the server's list fills it at sign-in. */
  }
  let state: OwnerState = { ...EMPTY, hidden: hiddenOf(posts) };
  const listeners = new Set<() => void>();
  const set = (next: OwnerState) => {
    state = next;
    for (const l of listeners) l();
  };
  const keep = () => {
    const t = now();
    const rows = [...posts].filter(([, c]) => t - c.at <= KEEP_MS).map(([id, c]) => [id, c.call, c.at]);
    try {
      if (rows.length === 0) storage?.removeItem(KEY);
      else storage?.setItem(KEY, JSON.stringify(rows));
    } catch {
      /* Storage refused: the calls are still held for this session. */
    }
  };
  /** Takes a post call when it is newer than the one held. True when anything changed. */
  const take = (itemId: string, c: PostCall): boolean => {
    const held = posts.get(itemId);
    if (held !== undefined && held.at > c.at) return false;
    if (held !== undefined && held.call === c.call && held.at === c.at) return false;
    posts.set(itemId, c);
    return true;
  };
  const withPosts = (next: Omit<OwnerState, 'hidden'>): OwnerState => {
    keep();
    return { ...next, hidden: hiddenOf(posts) };
  };
  return {
    get: (): OwnerState => state,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /**
     * true keeps everything; null (not known yet, or the wallet reconnecting) forgets the session's
     * calls but keeps the held post calls; false (the services said this is not the owner) forgets
     * all of it, on the device too.
     */
    setOwner(owner: boolean | null) {
      if (owner === true) return set({ ...state, owner });
      if (owner === false) {
        posts = new Map();
        return set(withPosts({ ...EMPTY, owner }));
      }
      set({ ...EMPTY, owner, hidden: hiddenOf(posts) });
    },
    hideNow(item: JustHidden) {
      posts.set(item.itemId, { call: 'not', at: Math.max(now(), (posts.get(item.itemId)?.at ?? 0) + 1) });
      set(withPosts({ ...state, justHidden: item, problem: null }));
    },
    /** A call did not save: the hide is undone and the owner is told. */
    failed(itemId: string | null, problem: string) {
      if (itemId !== null) posts.delete(itemId);
      set(withPosts({ ...state, justHidden: itemId !== null && state.justHidden?.itemId === itemId ? null : state.justHidden, problem }));
    },
    /** "Is a meme": the post is back in every list now. */
    showNow(itemId: string) {
      posts.set(itemId, { call: 'meme', at: Math.max(now(), (posts.get(itemId)?.at ?? 0) + 1) });
      set(withPosts({ ...state, justHidden: state.justHidden?.itemId === itemId ? null : state.justHidden }));
    },
    dismissJustHidden() {
      set({ ...state, justHidden: null, problem: null });
    },
    /** The server's own list of hidden posts (GET /owner/hidden): held unless a newer call is. */
    seed(hidden: readonly { readonly itemId: string; readonly at: number }[]) {
      let changed = false;
      for (const h of hidden) changed = take(h.itemId, { call: 'not', at: h.at }) || changed;
      if (changed) set(withPosts(state));
    },
    remember(calls: readonly SavedCall[]) {
      const next = new Map(state.calls);
      for (const c of calls) {
        const held = next.get(callKey(c));
        if (held === undefined || held.at <= c.at) next.set(callKey(c), c);
        /* A saved post call carries the server's date: it replaces the tap's own. */
        if (c.kind === 'post' && (c.call === 'not' || c.call === 'meme')) {
          const mine = posts.get(c.itemId);
          if (mine === undefined || mine.call === c.call || mine.at <= c.at) posts.set(c.itemId, { call: c.call, at: c.at });
        }
      }
      set(withPosts({ ...state, calls: next }));
    },
  };
}

export type OwnerStore = ReturnType<typeof createOwnerStore>;

/** The one store the app uses. */
export const ownerStore = createOwnerStore();

/** A list without the posts the owner hid (the store's `hidden`). Every list the app draws goes through it. */
export function withoutHidden<T>(rows: readonly T[], hidden: ReadonlySet<string>, idOf: (row: T) => string): readonly T[] {
  return hidden.size === 0 ? rows : rows.filter((r) => !hidden.has(idOf(r)));
}

/** The card's facts as the owner saw them, saved beside a "Not a meme". */
export function cardOf(post: Pick<RisingPost, 'excerpt' | 'authorLabel' | 'sourceLabel' | 'permalink' | 'thumbUrl' | 'thumbIsVideo'>): JustHidden['shown'] {
  return {
    excerpt: post.excerpt,
    authorLabel: post.authorLabel,
    sourceLabel: post.sourceLabel,
    permalink: post.permalink,
    thumbUrl: post.thumbUrl,
    thumbIsVideo: post.thumbIsVideo,
  };
}
