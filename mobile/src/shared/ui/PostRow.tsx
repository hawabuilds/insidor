/**
 * One single post on the For You or Popular feed, as a card.
 *
 * The story card's layout (row.module.css) with a post's facts in it: the post's own picture
 * with its platform badge, its words as the title, who posted it and how long ago, its views
 * and views line. Tapping it opens the post where it was posted, or its narrative when it
 * has one.
 *
 * ★ NO COIN WORDS AND NO BUTTON UNLESS THE POST CARRIES A CONFIDENT COIN. A single post makes
 * no claim about coins either way — not "no coin yet", which would be a coin statement too.
 * The footer appears only when the post is part of a narrative with exactly one coin, and
 * then it is that narrative's own status and button.
 */

import type { RisingPost } from '../api/index.ts';
import { coinStatus } from '../coin-status.ts';
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
  readonly buy: (ticker: string) => void;
}

export function PostRow({ post, now, handlers }: { post: RisingPost; now: number; handlers: PostHandlers }) {
  const status = post.coin === null ? null : coinStatus({ kind: 'one', coin: post.coin });
  const action = status?.action ?? null;

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

      {status !== null ? (
        <div className={styles['foot']}>
          <span className={styles['status']}>{status.line}</span>
          {action !== null && action.kind === 'buy' ? (
            <Button
              look="buy"
              onClick={(e: { stopPropagation: () => void }) => {
                e.stopPropagation();
                handlers.buy(action.coin.ticker);
              }}
            >
              Buy ${action.coin.ticker}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
