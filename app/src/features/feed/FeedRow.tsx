/**
 * ONE ROW of Hawa's narratives table. Exactly eight cells, in this order:
 *
 *   1. #          2. narrative (picture, title, two lines of plain English)
 *   3. activity   4. views        5. gain 24h
 *   6. age        7. market cap   8. one button — or, when the match is unsure, none
 *
 * There is no ninth cell and adding one is a product decision, not a styling one: the
 * previous board's patch path addressed its last two columns POSITIONALLY, so adding a column
 * wrote into the wrong div after the first live tick, in production, on real data. A fixed
 * grid declared once in the stylesheet and a fixed cell list declared once here is the cheap
 * version of not doing that again — which is also why the responsive drops hide cells with a
 * class instead of rendering fewer of them.
 *
 * `momentum` tints the graph and `isNew` marks the row; neither is a cell of its own.
 *
 * This component subscribes to ITSELF. A value arriving for one row re-renders one row, not
 * sixty — which is what the per-row listener sets in the board store are for.
 */

import { memo } from 'react';

import { useBoardRow } from '../../shared/api/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatCount, formatUsd } from '../../shared/format/number.ts';
import { Button, Delta, Num, Sparkline, Thumb } from '../../shared/ui/index.ts';
import type { BuyAction } from './row-action.ts';
import { actionLabel, rowAction } from './row-action.ts';
import styles from './feed.module.css';

export interface FeedRowProps {
  readonly id: string;
  /**
   * ★ The array index at render time, plus one. Passed in — never read from the row, because
   * there is no position field on `BoardRow` and there must never be one. A rank that arrives
   * on the wire is a rank the client can disagree with, and then two things claim to know the
   * ordering. The one that knows is `BoardTick.order`, and this is where we are in it.
   */
  readonly rank: number;
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

function FeedRowInner({ id, rank, now, onOpen, onBuy, onCompare, onCreate }: FeedRowProps) {
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
      {/* 1 — # */}
      <span className={styles['rank']}>{rank}</span>

      {/* 2 — narrative: picture, title, two lines of plain English */}
      <div className={styles['narrCell']}>
        <span className={styles['narrThumb']}>
          <Thumb url={row.thumbUrl} alt={row.title} />
        </span>
        <div className={styles['narrMeta']}>
          <div className={styles['narrTitle']}>{row.title}</div>
          <div className={styles['narrBlurb']}>{row.summary[0]}</div>
          <div className={`${styles['narrBlurb']} ${styles['narrBlurbSecond']}`}>
            {row.summary[1]}
          </div>
        </div>
      </div>

      {/* 3 — activity. A censored reading breaks the line rather than dropping to the floor;
             fewer than two readings says so instead of drawing a flat line at zero. Both
             behaviours live in the Sparkline primitive. `.h` hides this cell below 900px. */}
      <div className={`${styles['pulse']} ${styles['h']}`}>
        <Sparkline
          points={row.spark.points}
          windowMs={row.spark.windowMs}
          tone={row.momentum}
          label={`activity for ${row.title}`}
        />
      </div>

      {/* 4 — views. Absent renders as a dim dash with the reason on hover, never as 0: "this
             source keeps no view count" and "nobody looked at it" are different facts. */}
      <div className={styles['numCell']}>
        <Num rendered={formatCount(row.reach)} />
      </div>

      {/* 5 — gain 24h. What the story's COIN'S price did over the last day, as a signed
             percentage, and only when the story has exactly one settled coin: across
             several, an average describes a portfolio nobody holds and the biggest riser
             is a choice about which coin is real wearing a percentage sign. Absent is the
             ordinary state — a coin minted this hour has no day behind it, and a reading
             too old to be current is withheld by the server rather than shown as live.

             `<Delta>` colours by SIGN and takes no numeric prop, so the size of the move
             cannot influence the treatment. That is the structural version of not
             writing `gain >= 150000 ? 'up' : 'down'` in a component again.

             The tempting fill is reach: it is on the row and it moves. It is a different
             quantity — how many more people saw a story, not what a coin's price did —
             and labelling one as the other under a head that says GAIN, in the column a
             user is most likely to trade on, is the most expensive lie this board could
             tell. */}
      <div className={`${styles['numCell']} ${styles['gainCell']}`}>
        <Delta value={row.priceChange24h} unit="percent" />
      </div>

      {/* 6 — age. An unknown start time stays unknown: a dash, never "brand new", which is the
             worst direction to be wrong in on a product whose pitch is earliness. */}
      <div className={styles['numCell']}>
        <Num rendered={formatAge(row.firstSeenAt, now)} dim />
      </div>

      {/* 7 — market cap. Derived from the coin, so it is absent for every branch except a
             single settled coin — including `several`, deliberately. `.h` hides it below
             900px. */}
      <div className={`${styles['numCell']} ${styles['h']}`}>
        <Num rendered={formatUsd(row.marketCapUsd)} />
      </div>

      {/* 8 — one button, or, when the match is unsure, none at all */}
      <div
        className={`${styles['act']} ${action.kind === 'buy' ? styles['actBuy'] : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {action.kind === 'none' ? (
          /* ★ No element that can be pressed, and none that can be greyed out. The row says
             what is true and stops. */
          <span
            className={styles['noAction']}
            title={
              action.reason === 'match_unsure'
                ? 'More than one coin claims this story and none of them is settled, so there is nothing to buy.'
                : 'This coin cannot be quoted, so there is nothing to buy.'
            }
          >
            {action.reason === 'match_unsure' ? (
              <>
                {action.claimCount === null ? 'no coin' : `${action.claimCount} claim this`}
                <span className={styles['noActionSub']}>none settled</span>
              </>
            ) : (
              'not tradable yet'
            )}
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
 * re-rendering because the ORDER changed does not re-render sixty rows' worth of cells —
 * except for the rows whose `rank` actually moved, which is correct: a row that changed
 * position has to repaint its # cell.
 */
export const FeedRow = memo(FeedRowInner);
