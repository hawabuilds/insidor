/**
 * SAVED STORIES.
 *
 * Rows come from the same board store the feed uses, so a watched story shows the same
 * numbers as the board without a second fetch and without a second shape that can drift.
 * A watched story that has fallen off the current board shows as pending rather than
 * disappearing — "we are not tracking this right now" is information; a silently shorter
 * list is not.
 */

import { useSyncExternalStore } from 'react';

import { useBoardRow } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { pending, pendingInstant } from '../../shared/format/measure.ts';
import { Card, Num, Thumb } from '../../shared/ui/index.ts';
import type { WatchStore } from './watchlist-store.ts';
import styles from './watchlist.module.css';

function WatchRow({
  storyId,
  now,
  onOpen,
}: {
  storyId: string;
  now: number;
  onOpen: (storyId: string) => void;
}) {
  const row = useBoardRow(storyId);
  return (
    <div
      className={styles['item']}
      role="row"
      tabIndex={0}
      onClick={() => onOpen(storyId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(storyId);
      }}
    >
      <Thumb url={row?.thumbUrl ?? null} alt={row?.title ?? storyId} />
      <div>
        <div className={styles['title']}>{row?.title ?? 'not on the board right now'}</div>
        <div className={styles['sub']}>{row?.summary[0] ?? 'no current reading'}</div>
      </div>
      {/* A watched story that is off the board has no reading — which is a pending state
          with a reason, never a zero and never an age of "just now". */}
      <Num rendered={formatCount(row?.reach ?? pending('not_read_yet'))} />
      <Num rendered={formatAge(row?.firstSeenAt ?? pendingInstant('not_read_yet'), now)} dim />
      <span />
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
    <Card title={`Watching · ${ids.length}`}>
      {ids.length === 0 ? (
        <div className={styles['empty']}>
          nothing saved yet — open a story and press watch, and you will be told when it gets a
          coin
        </div>
      ) : (
        <div className={styles['list']}>
          {ids.map((id) => (
            <WatchRow key={id} storyId={id} now={now} onOpen={onOpen} />
          ))}
        </div>
      )}
    </Card>
  );
}
