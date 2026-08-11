/**
 * ONE ROW. Exactly seven things:
 *
 *   1. picture      2. title       3. two lines of plain English
 *   4. views        5. a small line graph
 *   6. age          7. one button
 *
 * There is no eighth cell and adding one is a product decision, not a styling one — the
 * previous board's patch path addressed its last two columns positionally, so adding a
 * column wrote into the wrong div after the first live tick, in production, on real data.
 * A fixed grid and a fixed cell list is the cheap version of not doing that again.
 *
 * `momentum` tints the graph and `isNew` marks the row; neither is a cell of its own.
 *
 * This component subscribes to ITSELF. A value arriving for one row re-renders one row, not
 * sixty — which is what the per-row listener sets in the board store are for.
 */

import { memo } from 'react';

import { useBoardRow } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount } from '../../shared/format/number.ts';
import { Button, Num, Sparkline, Thumb } from '../../shared/ui/index.ts';
import type { BuyAction } from './row-action.ts';
import { actionLabel, rowAction } from './row-action.ts';
import styles from './feed.module.css';

export interface FeedRowProps {
  readonly id: string;
  /** Injected, never read from a clock in here: every row in one paint must agree on now. */
  readonly now: number;
  readonly onOpen: (storyId: string) => void;
  /**
   * Typed to `BuyAction`, so the only thing that can ever be handed up from this row is a
   * confirmed, tradable coin. An unsure match cannot be widened into this parameter.
   */
  readonly onBuy: (action: BuyAction) => void;
  readonly onCompare: (storyId: string) => void;
  readonly onCreate: (storyId: string) => void;
}

function FeedRowInner({ id, now, onOpen, onBuy, onCompare, onCreate }: FeedRowProps) {
  const row = useBoardRow(id);
  /* A row in the committed order that we have no data for yet is a hole, not a zero row.
     Rendering a skeleton keeps the ordering honest while the refetch lands. */
  if (!row) return <div className={styles['row']} aria-hidden="true" />;

  const action = rowAction(row);

  return (
    <div
      className={`${styles['row']} ${row.isNew ? styles['rowNew'] : ''}`}
      role="row"
      tabIndex={0}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(row.id);
      }}
    >
      {/* 1 — picture */}
      <Thumb url={row.thumbUrl} alt={row.title} />

      {/* 2 and 3 — title, then two lines of plain English */}
      <div>
        <div className={styles['title']}>{row.title}</div>
        <div className={styles['summary']}>{row.summary[0]}</div>
        <div className={`${styles['summary']} ${styles['summarySecond']}`}>{row.summary[1]}</div>
      </div>

      {/* 4 — views */}
      <div className={styles['cellRight']}>
        <Num rendered={formatCount(row.reach)} />
      </div>

      {/* 5 — the small line graph */}
      <Sparkline
        points={row.spark.points}
        windowMs={row.spark.windowMs}
        tone={row.momentum}
        label={`activity for ${row.title}`}
      />

      {/* 6 — age */}
      <div className={styles['cellRight']}>
        <Num rendered={formatAge(row.firstSeenAt, now)} dim />
      </div>

      {/* 7 — one button, or, when the match is unsure, none */}
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {action.kind === 'none' ? (
          <span className={styles['noAction']}>
            {action.reason === 'match_unsure'
              ? action.candidateCount === null
                ? 'coin not settled'
                : `${action.candidateCount} candidates, none settled`
              : 'not tradable yet'}
          </span>
        ) : (
          <Button
            tone={action.kind === 'buy' ? 'primary' : 'default'}
            onClick={() => {
              switch (action.kind) {
                case 'buy':
                  onBuy(action);
                  return;
                case 'compare':
                  onCompare(action.storyId);
                  return;
                case 'create':
                  onCreate(action.storyId);
              }
            }}
          >
            {actionLabel(action)}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Memoised on props alone. The row's data comes from its own subscription, so the parent
 * re-rendering because the ORDER changed does not re-render sixty rows' worth of cells.
 */
export const FeedRow = memo(FeedRowInner);
