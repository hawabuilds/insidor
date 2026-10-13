/**
 * One single post on the For You or Popular feed, as a card (the owner's design, 2026-10-13).
 *
 * Top: the post's own picture or video still with its platform badge, its words on one line, who
 * posted it and how long ago, and its views with how many it gained lately ("751K views +38K").
 * Bottom, under a rule: where the post's coin stands, in one of the design's states, with one
 * button. Tapping the card anywhere else opens the post sheet (features/post-sheet).
 *
 * ★ THE COIN AREA IS THE SERVER'S ANSWER, WORDED HERE (`cardFoot`, post-sheet/sheet-view.ts):
 *
 *   one / matched → "$VOID $86K" and why it is the post's ("Links this post"), and a purple Buy
 *                   that opens the post sheet, where the coin is bought
 *   unsure        → "8 coins, none proven" and Choose coin, which opens the post sheet
 *   none          → "No coin yet" and Create, which opens the Create sheet from this post
 *   several       → how many, and View coins, which opens the narrative
 *   pending       → "Still checking for a coin", no button
 *   unchecked     → "Couldn't check for a coin", no button: nothing is guessed
 *
 * ★ THE GAIN IS BETWEEN TWO OF OUR READINGS (`recentGain`): "+38K" when they are about five minutes
 * apart, and with its real span ("+38K 9m") when they are not. No gain is drawn without two.
 *
 * `extra` is a strip under the coin area that the card does not decide (the owner's controls, an
 * older coin trading on the subject).
 */

import type { ReactNode } from 'react';
import type { RisingPost } from '../api/index.ts';
import { evidenceFacts } from '../coin-status.ts';
import { formatAge } from '../format/duration.ts';
import { formatCount, formatUsd } from '../format/number.ts';
import { platformOf } from '../platform.ts';
import { cardFoot, gainText, recentGain } from '../../features/post-sheet/sheet-view.ts';
import { CoinLogo } from './CoinLogo.tsx';
import { Thumb } from './Thumb.tsx';
import { Value } from './Value.tsx';
import styles from './post-card.module.css';

export interface PostHandlers {
  /** Opens the post sheet: a tap on the card, its Buy, or its Choose coin. */
  readonly open: () => void;
  /** Opens the Create sheet from this post. */
  readonly create: () => void;
  /** Opens the narrative whose coins these are. */
  readonly viewCoins: () => void;
}

/** Readings this close to five minutes apart are said as the five-minute change, without a span. */
const FIVE_MINUTES_SAID = [4, 6] as const;

export function PostRow({ post, now, handlers, extra = null }: { post: RisingPost; now: number; handlers: PostHandlers; extra?: ReactNode }) {
  const foot = cardFoot(post.coins, evidenceFacts);
  const gain = recentGain(post.spark.points.map((p) => ({ atMs: p.atMs, value: p.value })));
  const gainSaid = gainText(gain);
  const span = gain !== null && (gain.minutes < FIVE_MINUTES_SAID[0] || gain.minutes > FIVE_MINUTES_SAID[1]) ? ` ${gain.minutes}m` : '';
  const tap = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };

  return (
    <article className={styles['card']} onClick={handlers.open}>
      <div className={styles['top']}>
        <Thumb
          url={post.thumbUrl}
          video={post.thumbIsVideo}
          width={72}
          height={84}
          radius={16}
          platform={platformOf(post.sourceLabel)}
          platformLabel={post.sourceLabel}
        />
        <div className={styles['facts']}>
          <a
            className={styles['title']}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handlers.open();
            }}
          >
            {post.excerpt === '' ? 'Post' : post.excerpt}
          </a>
          <span className={styles['grey']}>
            <span>{post.authorLabel}</span>
            <Value r={formatAge(post.postedAt, now)} />
          </span>
          <span className={styles['grey']}>
            <span><Value r={formatCount(post.reach)} /> views</span>
            {gainSaid !== null && gain !== null ? <span className={gain.gain >= 0 ? styles['up'] : styles['down']}>{gainSaid}{span}</span> : null}
          </span>
        </div>
      </div>

      <div className={styles['foot']}>
        {foot.kind === 'proven' ? (
          <>
            <span className={styles['coin']}>
              <CoinLogo address={foot.coin.address} ticker={foot.coin.ticker} imageUrl={foot.coin.imageUrl} size={30} />
              <span className={styles['coinText']}>
                <b>
                  ${foot.coin.ticker}
                  {foot.coin.marketCapUsd.known ? <Value r={formatUsd(foot.coin.marketCapUsd)} className={styles['capText']} /> : null}
                </b>
                <span className={styles['grey']}>{foot.why}</span>
              </span>
            </span>
            <button type="button" className={styles['buy']} onClick={tap(handlers.open)}>Buy</button>
          </>
        ) : null}
        {foot.kind === 'choose' ? (
          <>
            <span className={styles['grey']}>{foot.line}</span>
            <button type="button" className={styles['quiet']} onClick={tap(handlers.open)}>Choose coin</button>
          </>
        ) : null}
        {foot.kind === 'create' ? (
          <>
            <span className={styles['grey']}>No coin yet</span>
            <button type="button" className={styles['quiet']} onClick={tap(handlers.create)}>Create</button>
          </>
        ) : null}
        {foot.kind === 'several' ? (
          <>
            <span className={styles['grey']}>{foot.line}</span>
            <button type="button" className={styles['quiet']} onClick={tap(handlers.viewCoins)}>View coins</button>
          </>
        ) : null}
        {foot.kind === 'line' ? <span className={styles['grey']}>{foot.line}</span> : null}
      </div>
      {extra}
    </article>
  );
}
