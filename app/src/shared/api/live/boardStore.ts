/**
 * THE ORDERING MACHINE.
 *
 * The server commits `(tick, order)` and the client never sorts. This store's whole job is to
 * honour that while solving one product problem: the board must not reorder under the
 * cursor. A row that moves as you click it is worse than an order a few seconds old.
 *
 * Two subscription sets are the point, and they are why no store library is used here:
 *   - ORDER changes are held while the user is touching the board.
 *   - VALUES patch always, even while held. Freezing the numbers would be lying, and the
 *     board would be stale rather than merely deferred.
 *
 * Per-row listeners mean one row re-renders when one row changes, not sixty. The build this
 * replaces diffed with `JSON.stringify` per row per tick across five hand-invalidated caches.
 *
 * No React in this file. It is plain state so it can be tested with node:test and so the
 * ordering rules are readable without knowing hooks.
 */

import type { BoardRow, BoardTick, RowPatch } from '../wire/board.ts';

export type Listener = () => void;

export interface BoardMeta {
  readonly tick: number;
  readonly frozen: boolean;
  /** How many committed frames are waiting behind the freeze. Renders as the pill. */
  readonly pendingCount: number;
  readonly connected: boolean;
}

export interface BoardStore {
  getOrder(): readonly string[];
  getRow(id: string): BoardRow | undefined;
  getMeta(): BoardMeta;

  subscribeOrder(l: Listener): () => void;
  subscribeRow(id: string, l: Listener): () => void;
  subscribeMeta(l: Listener): () => void;

  /** A committed frame. Held if frozen. */
  tick(next: BoardTick): void;
  /** A value change for one row. Applied immediately, frozen or not. */
  patch(p: RowPatch): void;
  setFrozen(next: boolean): void;
  setConnected(next: boolean): void;
  /** Replace everything — used after a reconnect or a detected gap. */
  reset(next: BoardTick): void;
}

export interface BoardStoreOptions {
  /**
   * Called when the tick sequence skips. Broadcast has no replay, so a hole means rows
   * changed while we were not listening and the only correct response is an authoritative
   * refetch. Silence here is the reconnect bug from the previous build.
   */
  readonly onGap?: (expected: number, saw: number) => void;
}

export function createBoardStore(options: BoardStoreOptions = {}): BoardStore {
  let order: readonly string[] = [];
  let tickNo = 0;
  let frozen = false;
  let connected = false;
  let held: BoardTick | null = null;
  let heldCount = 0;

  const rows = new Map<string, BoardRow>();
  const orderListeners = new Set<Listener>();
  const metaListeners = new Set<Listener>();
  const rowListeners = new Map<string, Set<Listener>>();

  /* A cached meta object, because useSyncExternalStore compares snapshots by identity and a
     fresh object every read is an infinite render loop. It is replaced only when something
     in it actually changed. */
  let meta: BoardMeta = { tick: 0, frozen: false, pendingCount: 0, connected: false };

  function emit(set: Set<Listener> | undefined): void {
    if (!set) return;
    for (const l of set) l();
  }

  function refreshMeta(): void {
    const next: BoardMeta = { tick: tickNo, frozen, pendingCount: heldCount, connected };
    if (
      next.tick === meta.tick &&
      next.frozen === meta.frozen &&
      next.pendingCount === meta.pendingCount &&
      next.connected === meta.connected
    ) {
      return;
    }
    meta = next;
    emit(metaListeners);
  }

  /**
   * `force` exists for exactly one caller: an authoritative refetch, whose frame is correct
   * by definition even if its tick number is not newer than what we already had.
   */
  function applyTick(next: BoardTick, force = false): void {
    /* Sockets deliver out of order. An older frame is not a correction, it is an echo. */
    if (!force && next.tick <= tickNo) return;
    if (!force && tickNo !== 0 && next.tick > tickNo + 1) options.onGap?.(tickNo + 1, next.tick);

    tickNo = next.tick;
    for (const row of next.rows) {
      rows.set(row.id, row);
      emit(rowListeners.get(row.id));
    }
    /* `order` gets a new array reference ONLY here. That is what lets the list component
       subscribe to ordering alone and ignore every value change. */
    order = next.order;
    held = null;
    heldCount = 0;
    emit(orderListeners);
    refreshMeta();
  }

  return {
    getOrder: () => order,
    getRow: (id) => rows.get(id),
    getMeta: () => meta,

    subscribeOrder(l) {
      orderListeners.add(l);
      return () => orderListeners.delete(l);
    },

    subscribeRow(id, l) {
      let set = rowListeners.get(id);
      if (!set) {
        set = new Set();
        rowListeners.set(id, set);
      }
      set.add(l);
      return () => {
        const current = rowListeners.get(id);
        if (!current) return;
        current.delete(l);
        if (current.size === 0) rowListeners.delete(id);
      };
    },

    subscribeMeta(l) {
      metaListeners.add(l);
      return () => metaListeners.delete(l);
    },

    tick(next) {
      if (!frozen) {
        applyTick(next);
        return;
      }
      /* Held frames collapse: only the newest order is worth applying, but the count of
         what the user is missing is worth showing, so it is tracked separately. */
      if (held === null || next.tick > held.tick) {
        held = next;
        heldCount += 1;
        refreshMeta();
      }
    },

    patch(p) {
      const current = rows.get(p.id);
      /* A patch for a row we do not have is not an error and not an insert: inserting would
         put a row on the board that no committed order references. The next tick brings it. */
      if (!current) return;
      rows.set(p.id, { ...current, ...p.fields });
      emit(rowListeners.get(p.id));
    },

    setFrozen(next) {
      if (frozen === next) return;
      frozen = next;
      if (!next && held !== null) applyTick(held);
      else refreshMeta();
    },

    setConnected(next) {
      if (connected === next) return;
      connected = next;
      refreshMeta();
    },

    reset(next) {
      /* An authoritative refetch supersedes everything, including a held frame — the user
         is not owed a stale order that the server has already replaced. Ordering is still
         only applied through applyTick, so the freeze contract holds on the next frame. */
      const stale = [...rows.keys()];
      tickNo = 0;
      held = null;
      heldCount = 0;
      rows.clear();
      applyTick(next, true);
      /* Rows the refetch dropped: their subscribers are told, so a component still mounted
         during the same paint re-reads and finds them gone rather than showing old numbers. */
      for (const id of stale) if (!rows.has(id)) emit(rowListeners.get(id));
    },
  };
}
