/**
 * THE RANKED BOARD.
 *
 * Two properties this component must not lose:
 *
 *   - It renders `order.map(id => <FeedRow key={id}/>)` and never sorts, filters or slices.
 *     The server commits `(tick, order)`; a client that re-sorts has silently replaced the
 *     ranking design with whatever the component author thought was reasonable.
 *   - Keying by story id means React MOVES existing DOM nodes on a reorder rather than
 *     recreating them, so hover, focus and text selection survive a reorder that is applied.
 *
 * The freeze is attached here, to this element, because "inside the board" is what holds the
 * order. Values keep patching while frozen; the pill says how many frames are waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoardStore } from '../../shared/api/index.ts';
import { fetchBoard, useBoardMeta, useBoardOrder, useFreezeWhileInteracting } from '../../shared/api/index.ts';
import type { BuyAction } from './row-action.ts';
import { FeedRow } from './FeedRow.tsx';
import styles from './feed.module.css';

/** How often the age column re-reads the clock. Ages are coarse; a second is plenty. */
const CLOCK_MS = 1_000;

export interface FeedProps {
  readonly viewId: string;
  readonly store: BoardStore;
  readonly onOpenStory: (storyId: string) => void;
  readonly onBuy: (action: BuyAction) => void;
}

export function Feed({ viewId, store, onOpenStory, onBuy }: FeedProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const order = useBoardOrder();
  const meta = useBoardMeta();
  const [now, setNow] = useState(() => Date.now());

  useFreezeWhileInteracting(boardRef, store);

  /* The clock is state, ticked here and passed down, so that every row in one paint agrees
     on what time it is and a test can state the time. */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  /* The authoritative read. The live channel has no replay, so this is also what runs on
     every reconnect and on every detected gap — see App.tsx, which owns that wiring. */
  useEffect(() => {
    const ac = new AbortController();
    fetchBoard(viewId, ac.signal)
      .then((tick) => store.reset(tick))
      .catch(() => {
        /* Left to the transport status line rather than an error boundary: a failed read
           means the board is stale, and a stale board is still worth looking at. */
      });
    return () => ac.abort();
  }, [viewId, store]);

  const handleCompare = useCallback((storyId: string) => onOpenStory(storyId), [onOpenStory]);
  const handleCreate = useCallback((storyId: string) => onOpenStory(storyId), [onOpenStory]);

  return (
    <>
      <div className={styles['status']}>
        <span className={`${styles['dot']} ${meta.connected ? '' : styles['dotOff']}`} />
        <span>{meta.connected ? 'live' : 'reconnecting'}</span>
        {meta.pendingCount > 0 ? (
          <button
            type="button"
            className={styles['pill']}
            onClick={() => store.setFrozen(false)}
          >
            {meta.pendingCount} update{meta.pendingCount === 1 ? '' : 's'} waiting
          </button>
        ) : null}
      </div>

      <div className={styles['board']} ref={boardRef} role="table" aria-label="ranked stories">
        <div className={styles['header']} role="row">
          <span />
          <span>story</span>
          <span className={styles['headerRight']}>views</span>
          <span>activity</span>
          <span className={styles['headerRight']}>age</span>
          <span />
        </div>

        {order.length === 0 ? (
          <div className={styles['empty']}>nothing on the board yet</div>
        ) : (
          order.map((id) => (
            <FeedRow
              key={id}
              id={id}
              now={now}
              onOpen={onOpenStory}
              onBuy={onBuy}
              onCompare={handleCompare}
              onCreate={handleCreate}
            />
          ))
        )}
      </div>
    </>
  );
}
