/**
 * One single post on the For You or Popular feed, as a card.
 *
 * The story card's layout (row.module.css) with a post's facts in it: the post's own picture
 * with its platform badge, its words as the title, who posted it and how long ago, its views
 * and views line. Tapping it opens the post where it was posted, or its narrative when it
 * has one.
 *
 * ★ EVERY CARD HAS A COIN LINE, AND IT IS THE SERVER'S ANSWER, NOT OURS (`postCoinStatus`):
 *
 *   one      → "$TICKER" and the coin's market cap when it has been read, and Buy, which opens
 *              the coin's page — only ever a narrative's confident coin (the decoder refuses a
 *              coin without its narrative)
 *   none     → "No coin yet" and Create, which opens the Create sheet with the post's picture
 *              and link; the post's name was searched and nothing came back
 *   pending  → a dash with its reason: nobody has searched yet, so neither claim is made
 *   unchecked → "Couldn't check", and NO button: the search failed for minutes, so neither
 *              claim is made and nothing is guessed
 *   unsure   → the sentence saying we cannot tell, then "See 3 coins" (the real count, "10+" when
 *              the search found more than it kept), which opens the list of coins that use the
 *              name, and Create — never Buy on an unsure match: a coin is bought from its own
 *              page, opened by the person from the list
 *   several  → how many, and View coins, which opens the narrative
 */

import type { ReactNode } from 'react';
import type { Coin, RisingPost } from '../api/index.ts';
import { postCoinStatus, seeCoinsLabel, type PostAction } from '../coin-status.ts';
import { formatAge } from '../format/duration.ts';
import { formatCount } from '../format/number.ts';
import { platformOf } from '../platform.ts';
import { Button } from './Button.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Thumb } from './Thumb.tsx';
import { Value } from './Value.tsx';
import styles from './row.module.css';

export interface PostHandlers {
  readonly open: () => void;
  /** Opens the coin's own page. */
  readonly buy: (coin: Coin) => void;
  /** Opens the Create sheet from this post. */
  readonly create: () => void;
  /** Opens the narrative whose coins these are. */
  readonly viewCoins: () => void;
  /** Opens the list of coins that use this post's name. */
  readonly seeCoins: () => void;
}

/** `extra`: a strip under the coin line that the card does not decide (the owner's controls). */
export function PostRow({ post, now, handlers, extra = null }: { post: RisingPost; now: number; handlers: PostHandlers; extra?: ReactNode }) {
  const status = postCoinStatus(post.coins);

  return (
    <article className={styles['card']} onClick={handlers.open}>
      <div className={styles['body']}>
        <Thumb
          url={post.thumbUrl}
          video={post.thumbIsVideo}
          width={84}
          height={98}
          radius={14}
          platform={platformOf(post.sourceLabel)}
          platformLabel={post.sourceLabel}
        />
        <div className={styles['content']}>
          <div className={styles['top']}>
            <a
              className={styles['postText']}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handlers.open();
              }}
            >
              {post.excerpt}
            </a>
            <span className={styles['spark']}>
              <Sparkline points={post.spark.points} windowMs={post.spark.windowMs} width={44} label={`Views over time for this post by ${post.authorLabel}`} />
            </span>
            <div className={styles['views']}>
              <Value r={formatCount(post.reach)} className={styles['viewsN']} />
              <span className={styles['viewsL']}>views</span>
            </div>
            <div className={styles['byline']}>
              <span>{post.authorLabel}</span>
              <Value r={formatAge(post.postedAt, now)} className={styles['age']} />
            </div>
          </div>
        </div>
      </div>

      <div className={status.actions.length > 1 ? `${styles['foot']} ${styles['footWrap']}` : styles['foot']}>
        <span className={styles['status']}>{status.line}</span>
        {status.actions.length > 0 ? (
          <span className={styles['actions']}>
            {status.actions.map((action) => <ActionButton key={action.kind} action={action} handlers={handlers} />)}
          </span>
        ) : null}
      </div>
      {extra}
    </article>
  );
}

/** One button the coin status asked for, and never one it did not. */
function ActionButton({ action, handlers }: { action: PostAction; handlers: PostHandlers }) {
  const tap = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  switch (action.kind) {
    case 'create':
      return <Button look="primary" onClick={tap(handlers.create)}>Create coin</Button>;
    case 'buy':
      return <Button look="buy" onClick={tap(() => handlers.buy(action.coin))}>Buy ${action.coin.ticker}</Button>;
    case 'view':
      return <Button look="quiet" onClick={tap(handlers.viewCoins)}>View coins</Button>;
    case 'see':
      return <Button look="quiet" onClick={tap(handlers.seeCoins)}>{seeCoinsLabel(action.count, action.more)}</Button>;
  }
}
