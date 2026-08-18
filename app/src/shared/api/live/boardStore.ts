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

/**
 * What the live channel is doing, in three states rather than a boolean.
 *
 * ★ A BOOLEAN CANNOT TELL THE TRUTH HERE, AND THAT IS WHY THIS IS A UNION. "Not connected"
 * covers two situations that must never render the same: a board with no transport behind
 * it at all, which was read once and is honestly a snapshot, and a board whose live channel
 * was working and has stopped, which is showing numbers that have quietly gone wrong. The
 * second is the dangerous one — it looks exactly like a quiet market — and it is the one
 * the status line has to be able to say out loud.
 *
 *   idle     nothing has ever subscribed. No transport, or none configured.
 *   live     the server has said it can deliver, and is delivering.
 *   dropped  it was live and is not. Every frame since is a frame this board never saw.
 *
 * "Reconnecting" is deliberately NOT a fourth state: it is `dropped` plus how long, and how
 * long is a question about the clock rather than about the channel. features/feed/link-status.ts
 * makes that call in one place, against `linkChangedAt`.
 */
export type LinkState = 'idle' | 'live' | 'dropped';

export interface BoardMeta {
  readonly tick: number;
  readonly frozen: boolean;
  /** How many committed frames are waiting behind the freeze. Renders as the pill. */
  readonly pendingCount: number;
  readonly link: LinkState;
  /** When `link` last changed, on the injected clock. 0 while nothing has ever happened. */
  readonly linkChangedAt: number;
  /**
   * When a committed frame last ARRIVED. Null before the first one.
   *
   * Arrived, not applied: a frame held behind the freeze still proves the channel is
   * delivering, and the pill beside this already says how many are waiting. On screen this
   * is what separates a live board that is quiet from a live board that has silently
   * stopped being fed — the pip and the label describe the CHANNEL, and this describes
   * whether anything is actually coming down it.
   *
   * ★ AND ARRIVED MEANS A FRAME WE DID NOT ALREADY HAVE. An authoritative refetch runs on
   * every subscribe; over a dead projector it returns the tick this store is already
   * showing, and counting that as an arrival would reset the only number on the board that
   * can contradict the word "live".
   */
  readonly lastFrameAt: number | null;
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
  /**
   * The live channel's own report. `true` on every subscribe, `false` on every drop.
   *
   * Kept as a boolean because that is exactly what the transport knows — it can say "I am
   * subscribed" and "I am not", and nothing else. Turning that into the three-state `link`
   * is this store's job, and it needs one fact the transport does not have: whether we were
   * ever subscribed in the first place.
   */
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
  /**
   * The clock, injected. Only ever used to stamp WHEN something happened, never to decide
   * anything — the decisions are all in the caller, against these stamps, so a test can
   * state the time instead of sleeping through it.
   */
  readonly now?: () => number;
}

export function createBoardStore(options: BoardStoreOptions = {}): BoardStore {
  const now = options.now ?? Date.now;

  let order: readonly string[] = [];
  let tickNo = 0;
  let frozen = false;
  let link: LinkState = 'idle';
  let linkChangedAt = 0;
  let lastFrameAt: number | null = null;
  /**
   * The tick `lastFrameAt` belongs to. −1 before any frame, so tick 0 would still stamp.
   *
   * Separate from `tickNo` because `reset` zeroes that before applying, and the question
   * this answers — "is the frame in front of us one we have already had?" — has to survive
   * the zeroing. See the stamp in `applyTick`.
   */
  let lastFrameTick = -1;
  let held: BoardTick | null = null;
  let heldCount = 0;

  const rows = new Map<string, BoardRow>();
  const orderListeners = new Set<Listener>();
  const metaListeners = new Set<Listener>();
  const rowListeners = new Map<string, Set<Listener>>();

  /* A cached meta object, because useSyncExternalStore compares snapshots by identity and a
     fresh object every read is an infinite render loop. It is replaced only when something
     in it actually changed. */
  let meta: BoardMeta = { tick: 0, frozen: false, pendingCount: 0, link: 'idle', linkChangedAt: 0, lastFrameAt: null };

  function emit(set: Set<Listener> | undefined): void {
    if (!set) return;
    for (const l of set) l();
  }

  function refreshMeta(): void {
    const next: BoardMeta = { tick: tickNo, frozen, pendingCount: heldCount, link, linkChangedAt, lastFrameAt };
    if (
      next.tick === meta.tick &&
      next.frozen === meta.frozen &&
      next.pendingCount === meta.pendingCount &&
      next.link === meta.link &&
      next.linkChangedAt === meta.linkChangedAt &&
      next.lastFrameAt === meta.lastFrameAt
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

    /* ★ STAMPED ONLY FOR A FRAME WE HAVE NOT ALREADY HAD, and that condition is the whole
       value of the field. `lastFrameAt` is the one thing on screen that separates a live
       board on a quiet market from a live board that has silently stopped being fed — the
       pip and the label describe the CHANNEL and both stay green in the second case. An
       authoritative refetch fires on every subscribe, and on a healthy channel over a dead
       projector it comes back with the board we already hold; restamping on it would reset
       "12m ago" to "0s ago" without a single new frame existing, which is the same lie the
       status line was rebuilt to stop telling, one field to the right. Measured: ten minutes
       of silence, one reconnect, and the readout said the board had just moved. */
    if (lastFrameTick !== next.tick) {
      lastFrameTick = next.tick;
      lastFrameAt = now();
    }
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
        /* Stamped even though nothing was applied. The freeze is OURS — the channel did
           deliver — and a status line reading "no update in 4m" while four frames sit in the
           pill beside it would be blaming the transport for a decision this store made.
           The tick is recorded with it so that thawing, which re-applies this same frame
           through `applyTick`, does not stamp it a second time at the later instant: it
           arrived when it arrived. */
        lastFrameTick = next.tick;
        lastFrameAt = now();
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
      /* `idle → dropped` is not a transition, and refusing it is the whole point of having
         three states. A transport that fails on its very first connect never subscribed, so
         nothing was lost; saying "the connection dropped" about a connection that never
         existed would put a broken-stream warning over a board that is simply not
         streaming, which is a different and much less alarming fact. */
      const wanted: LinkState = next ? 'live' : link === 'idle' ? 'idle' : 'dropped';
      if (link === wanted) return;
      link = wanted;
      linkChangedAt = now();
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
