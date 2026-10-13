/**
 * WHAT THE OWNER JUST DID, HELD IN THE APP UNTIL THE SERVICES CATCH UP.
 *
 * The projector hides a post on its next run; the owner's tap must hide it now. So a post the owner
 * hid is held here and left out of every list the app draws (For You, Popular, a narrative's
 * posts) until the page is reloaded — by which time the projection has it. The newest hide is
 * also held for the bar that asks why, and every call the owner made this session is held so the
 * card says what was said without asking the server again.
 *
 * Pure, with a subscribe for React (hooks.ts), so it runs under `node --test`.
 *
 * What breaks if changed carelessly: a hide that the server refused must be undone here
 * (`showNow`), or the post vanishes from the owner's screen while staying on everyone else's.
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
  readonly hidden: ReadonlySet<string>;
  readonly justHidden: JustHidden | null;
  /** This session's calls, newest per key (`callKey`). */
  readonly calls: ReadonlyMap<string, SavedCall>;
  /** A call the services refused or never received, said in the owner's bar. */
  readonly problem: string | null;
}

const EMPTY: OwnerState = { owner: null, hidden: new Set(), justHidden: null, calls: new Map(), problem: null };

export const callKey = (c: { readonly kind: string; readonly itemId: string; readonly name?: string | null }): string =>
  `${c.kind}\u0000${c.itemId}\u0000${c.kind === 'name' ? (c.name ?? '') : ''}`;

export function createOwnerStore() {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const set = (next: OwnerState) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    get: (): OwnerState => state,
    subscribe(l: () => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setOwner(owner: boolean | null) {
      set(owner === true ? { ...state, owner } : { ...EMPTY, owner });
    },
    hideNow(item: JustHidden) {
      set({ ...state, hidden: new Set([...state.hidden, item.itemId]), justHidden: item, problem: null });
    },
    /** A call did not save: the hide is undone and the owner is told. */
    failed(itemId: string | null, problem: string) {
      const hidden = new Set(state.hidden);
      if (itemId !== null) hidden.delete(itemId);
      set({ ...state, hidden, justHidden: itemId !== null && state.justHidden?.itemId === itemId ? null : state.justHidden, problem });
    },
    showNow(itemId: string) {
      const hidden = new Set(state.hidden);
      hidden.delete(itemId);
      set({ ...state, hidden, justHidden: state.justHidden?.itemId === itemId ? null : state.justHidden });
    },
    dismissJustHidden() {
      set({ ...state, justHidden: null, problem: null });
    },
    remember(calls: readonly SavedCall[]) {
      const next = new Map(state.calls);
      for (const c of calls) {
        const held = next.get(callKey(c));
        if (held === undefined || held.at <= c.at) next.set(callKey(c), c);
      }
      set({ ...state, calls: next });
    },
  };
}

export type OwnerStore = ReturnType<typeof createOwnerStore>;

/** The one store the app uses. */
export const ownerStore = createOwnerStore();

/** A list without the posts the owner just hid. */
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
