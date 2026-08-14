/**
 * SAVED STORIES, in Hawa's watchlist section (styles/index.css:686-695) over her panel.
 *
 * Rows come from the same board store the feed uses, so a watched story shows the same
 * numbers as the board without a second fetch and without a second shape that can drift.
 * A watched story that has fallen off the current board shows as pending rather than
 * disappearing — "we are not tracking this right now" is information; a silently shorter
 * list is not.
 *
 * The star un-watches. It is her star (index.css:682-685) and it stops the click from
 * reaching the row, because the row opens the story and losing a saved item to a mis-aimed
 * click is the one destructive thing this screen can do.
 */

import { useSyncExternalStore } from 'react';

import { useBoardRow } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { pending, pendingInstant } from '../../shared/format/measure.ts';
import { Num, Thumb } from '../../shared/ui/index.ts';
import type { WatchStore } from './watchlist-store.ts';
import styles from './watchlist.module.css';

function WatchRow({
  storyId,
  now,
  onOpen,
  onUnwatch,
}: {
  storyId: string;
  now: number;
  onOpen: (storyId: string) => void;
  onUnwatch: (storyId: string) => void;
}) {
  const row = useBoardRow(storyId);
  return (
    <div
      className={`${styles['item']} ${row === undefined ? styles['gone'] : ''}`}
      role="row"
      tabIndex={0}
      onClick={() => onOpen(storyId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(storyId);
      }}
    >
      <div className={styles['thumb']}>
        <Thumb url={row?.thumbUrl ?? null} alt={row?.title ?? storyId} />
      </div>

      <div>
        <div className={styles['title']}>{row?.title ?? 'not on the board right now'}</div>
        <div className={styles['sub']}>{row?.summary[0] ?? 'no current reading'}</div>
      </div>

      {/* A watched story that is off the board has no reading — which is a pending state
          with a reason, never a zero and never an age of "just now". */}
      <div className={styles['num']}>
        <Num rendered={formatCount(row?.reach ?? pending('not_read_yet'))} />
      </div>
      <div className={styles['num']}>
        <Num rendered={formatAge(row?.firstSeenAt ?? pendingInstant('not_read_yet'), now)} dim />
      </div>

      <button
        type="button"
        className={styles['star']}
        aria-label="stop watching this story"
        title="stop watching"
        onClick={(e) => {
          e.stopPropagation();
          onUnwatch(storyId);
        }}
      >
        ★
      </button>
    </div>
  );
}

export function Watchlist({
  store,
  now,
  onOpen,
}: {
  store: WatchStore;
  now: number;
  onOpen: (storyId: string) => void;
}) {
  const ids = useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.ids(),
  );

  return (
    <div className={styles['section']}>
      <div className={styles['sectionHd']}>
        {/* The page title above this says "Watchlist" (App.tsx). This is her section head
            inside it, so it names the section rather than echoing the page. */}
        <div className={styles['sectionTitle']}>Saved stories</div>
        <div className={styles['sectionCount']}>{ids.length}</div>
      </div>

      <div className={styles['table']}>
        {ids.length === 0 ? (
          <div className={styles['empty']}>
            <b>Nothing saved yet.</b>
            Open a story and press the star. You will be told once — and only once — if a coin
            we can name is minted from it.
          </div>
        ) : (
          <>
            {/* Labels. Not sort controls: this list renders in the order it is given. */}
            <div className={styles['hd']} role="row">
              <span />
              <span>story</span>
              <span className={styles['num']}>views</span>
              <span className={styles['num']}>age</span>
              <span />
            </div>
            {ids.map((id) => (
              <WatchRow
                key={id}
                storyId={id}
                now={now}
                onOpen={onOpen}
                onUnwatch={(storyId) => store.toggle(storyId)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
