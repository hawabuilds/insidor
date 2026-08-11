/**
 * The React edge of the ordering machine, and nothing more.
 *
 * Three hooks against three subscription sets. The split is the performance story: the list
 * subscribes to ORDER, each row subscribes to ITSELF, and the status pill subscribes to
 * META. A value arriving for one row re-renders one row.
 *
 * `useSyncExternalStore` rather than a state library because the store already exists and is
 * about 150 lines; wrapping it in a library would mean writing the same 150 lines inside
 * someone else's abstraction.
 */

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

import type { BoardRow } from '../wire/board.ts';
import type { BoardMeta, BoardStore, Listener } from './boardStore.ts';

const BoardStoreContext = createContext<BoardStore | null>(null);

export const BoardStoreProvider = BoardStoreContext.Provider;

export function useBoardStore(): BoardStore {
  const store = useContext(BoardStoreContext);
  /* A missing provider is a wiring mistake, not a runtime condition to render around. */
  if (!store) throw new Error('useBoardStore: no BoardStoreProvider above this component');
  return store;
}

/* The subscribe callbacks are annotated rather than inferred: `useCallback` erases the
   contextual type `useSyncExternalStore` would otherwise supply, and an unannotated
   parameter here would be an implicit any in the one place the subscription plumbing lives. */
type Subscribe = (onChange: Listener) => () => void;

export function useBoardOrder(): readonly string[] {
  const store = useBoardStore();
  const subscribe = useCallback<Subscribe>((l) => store.subscribeOrder(l), [store]);
  return useSyncExternalStore(subscribe, () => store.getOrder());
}

export function useBoardRow(id: string): BoardRow | undefined {
  const store = useBoardStore();
  const subscribe = useCallback<Subscribe>((l) => store.subscribeRow(id, l), [store, id]);
  return useSyncExternalStore(subscribe, () => store.getRow(id));
}

export function useBoardMeta(): BoardMeta {
  const store = useBoardStore();
  const subscribe = useCallback<Subscribe>((l) => store.subscribeMeta(l), [store]);
  return useSyncExternalStore(subscribe, () => store.getMeta());
}
