/**
 * ONE STORY AS A CARD — the feed's card and the Narratives list's card are this component.
 *
 * A fixed 84x98 portrait picture on the left, its top level with the title's, with the platform badge on its corner (the feed only: a
 * narrative spans several sites, so the Narratives list passes no platform). Beside it the
 * title, who posted it and how long ago, a purple views line and the views figure on the
 * title row, and the plain-English description under them. Across the bottom of the card,
 * the coin status on the left and at most one button on the right. Every figure goes
 * through `Value`, so an absence is a dash with its reason.
 *
 * The button is decided by `coinStatus` and nothing here can add one: an unsure match renders
 * its sentence and no button at all. Buy and Create do not trade or mint — they reach the
 * Coming-soon toast through the callbacks the screen passes in.
 */

import type { ReactNode } from 'react';
import type { Story, BoardRow } from '../api/index.ts';
import { coinStatus, type CoinAction } from '../coin-status.ts';
import { formatAge } from '../format/duration.ts';
import { formatCount } from '../format/number.ts';
import type { Platform } from '../platform.ts';
import { Button } from './Button.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Thumb } from './Thumb.tsx';
import { Value } from './Value.tsx';
import styles from './row.module.css';
import { tickerText } from '../format/ticker.ts';

export interface RowHandlers {
  readonly open: () => void;
  readonly viewCoins: () => void;
  readonly create: () => void;
  readonly buy: (ticker: string) => void;
}

export function StoryRow({
  item,
  now,
  byline,
  platform,
  platformLabel,
  handlers,
}: {
  item: BoardRow | Story;
  now: number;
  /** Under the title, before the age: a handle on the feed, "9 posts on X, TikTok" on Narratives. */
  byline: ReactNode;
  platform: Platform | null;
  platformLabel: string;
  handlers: RowHandlers;
}) {
  const status = coinStatus(item.coins);
  const views = formatCount(item.reach);

  return (
    <article className={styles['card']} onClick={handlers.open}>
      <div className={styles['body']}>
        <Thumb url={item.thumbUrl} width={84} height={98} radius={14} platform={platform} platformLabel={platformLabel} />
        <div className={styles['content']}>
          {/* A grid, so nothing on the title row can overlap anything else: title, views
              line and count on the first row; who posted it and when under the title and
              the line, never squeezed beside the count — a handle broken mid-word on a
              narrow phone reads as two different accounts. */}
          <div className={styles['top']}>
            <a
              className={styles['title']}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlers.open();
              }}
            >
              {item.title}
            </a>
            <span className={styles['spark']}>
              <Sparkline points={item.spark.points} windowMs={item.spark.windowMs} width={44} label={`Views over time for ${item.title}`} />
            </span>
            <div className={styles['views']}>
              <Value r={views} className={styles['viewsN']} />
              <span className={styles['viewsL']}>views</span>
            </div>
            <div className={styles['byline']}>
              {byline}
              <Value r={formatAge(item.firstSeenAt, now)} className={styles['age']} />
            </div>
          </div>
          <p className={styles['summary']}>{item.summary.join(' ')}</p>
        </div>
      </div>

      <div className={styles['foot']}>
        <span className={styles['status']}>{status.line}</span>
        <ActionButton action={status.action} handlers={handlers} />
      </div>
    </article>
  );
}

/** At most one button, and never one the coin status did not ask for. */
function ActionButton({ action, handlers }: { action: CoinAction | null; handlers: RowHandlers }) {
  if (action === null) return null;
  const tap = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  switch (action.kind) {
    case 'create':
      return <Button look="primary" onClick={tap(handlers.create)}>Create coin</Button>;
    case 'buy':
      return <button type="button" className={styles['buy']} aria-label={`Buy ${tickerText(action.coin.ticker)}`} onClick={tap(() => handlers.buy(action.coin.ticker))}>Buy</button>;
    case 'view':
      return <Button look="quiet" onClick={tap(handlers.viewCoins)}>View coins</Button>;
  }
}
