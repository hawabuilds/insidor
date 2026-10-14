/**
 * One single post on the For You or Popular feed, as a card.
 *
 * The story card's layout (row.module.css) with a post's facts in it: the post's own picture
 * with its platform badge, its words as the title, who posted it (with their profile picture) and
 * how long ago, its views and views line. This is the card as it looked before the post sheet was
 * built, kept that way on purpose: the owner asked for the old look back.
 * A post with no picture or video has no thumbnail box at all, so its words use the card's full
 * width; a card with media is unchanged. The picture is asked for at the card's size
 * (picture-size.ts), never the full posted size: a long feed decodes hundreds of them.
 *
 * ★ A TAP ON THE CARD OPENS THE POST SHEET (features/post-sheet): the card, its title, Buy and View
 * coins. Two buttons go straight to where they say: Create coin opens the create flow from the
 * post, and See N coins opens the sheet on Choose coin, with its quick buy. The button's WORDS come
 * from the coin line below, so the card says what the post's coin is before anyone taps.
 *
 * ★ EVERY CARD HAS A COIN LINE, AND IT IS THE SERVER'S ANSWER, NOT OURS (`postCoinStatus`):
 *
 *   matched  → the post's own coin, settled by evidence: as `one`, with why beneath it as facts
 *              ("Links this post, Same picture, Launched 12m after"), never how sure
 *   one      → "$TICKER" and the coin's market cap when it has been read, and Buy — only ever a
 *              narrative's confident coin (the decoder refuses a coin without its narrative)
 *   none     → "No coin yet" and Create coin; the post's name was searched and nothing came back
 *   pending  → a dash with its reason: nobody has searched yet, so neither claim is made
 *   unchecked → "Couldn't check", and NO button: the search failed for minutes, so neither
 *              claim is made and nothing is guessed
 *   unsure   → the sentence saying we cannot tell, then "See 3 coins" (the real count, "10+" when
 *              the search found more than it kept) and Create coin — never Buy on an unsure match
 *   several  → how many, and View coins
 *
 * What breaks if changed carelessly: a button that skips `stopPropagation` fires the card's tap
 * as well, and a card that opens anything but the post sheet sends the person out of the flow.
 */

import { useState, type ReactNode } from 'react';
import type { RisingPost } from '../api/index.ts';
import { postCoinStatus, seeCoinsLabel, type PostAction } from '../coin-status.ts';
import { useCoinCap } from '../useCoinCap.ts';
import { formatAge } from '../format/duration.ts';
import { formatCount } from '../format/number.ts';
import { tickerText } from '../format/ticker.ts';
import { platformOf } from '../platform.ts';
import { Button } from './Button.tsx';
import { CoinLogo } from './CoinLogo.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Thumb } from './Thumb.tsx';
import { cardPictureUrl } from './picture-size.ts';
import { Value } from './Value.tsx';
import styles from './row.module.css';

export interface PostHandlers {
  /** Opens the post sheet: a tap on the card, its title, Buy or View coins. */
  readonly open: () => void;
  /** Opens the create flow from this post. */
  readonly create: () => void;
  /** Opens the post sheet on Choose coin: every coin with the post's name. */
  readonly seeCoins: () => void;
}

const NO_COIN = { known: false, pending: 'not_minted' } as const;

/** `extra`: a strip under the coin line that the card does not decide (the owner's controls). */
export function PostRow({ post, now, handlers, extra = null }: { post: RisingPost; now: number; handlers: PostHandlers; extra?: ReactNode }) {
  /* The coin line's cap is the shared one (shared/coin-cap.ts): live while a fresh price is held,
     so the card says what the sheet and token page say. The card itself never polls. */
  const own = post.coins.kind === 'one' || post.coins.kind === 'matched' ? post.coins.coin : null;
  const cap = useCoinCap(own?.address ?? '', own?.marketCapUsd ?? NO_COIN, false, own?.priceUsd ?? null);
  const coins = own !== null && (post.coins.kind === 'one' || post.coins.kind === 'matched') ? { ...post.coins, coin: { ...own, marketCapUsd: cap } } : post.coins;
  const status = postCoinStatus(coins);

  return (
    <article className={styles['card']} onClick={handlers.open}>
      <div className={styles['body']}>
        {/* A post with no picture or video has no thumbnail box: its words take the card's width. */}
        {post.thumbUrl !== null || post.thumbIsVideo ? (
          <Thumb
            url={post.thumbUrl === null ? null : cardPictureUrl(post.thumbUrl)}
            video={post.thumbIsVideo}
            width={84}
            height={98}
            radius={14}
            platform={platformOf(post.sourceLabel)}
            platformLabel={post.sourceLabel}
          />
        ) : null}
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
              <span>
                <PosterPic key={post.authorPictureUrl ?? ''} url={post.authorPictureUrl} label={post.authorLabel} />
                {post.authorLabel}
              </span>
              <Value r={formatAge(post.postedAt, now)} className={styles['age']} />
            </div>
          </div>
        </div>
      </div>

      <div className={status.actions.length > 1 ? `${styles['foot']} ${styles['footWrap']}` : styles['foot']}>
        <span className={styles['status']}>
          {post.coins.kind === 'one' || post.coins.kind === 'matched' ? (
            <span className={styles['statusLogo']}>
              <CoinLogo address={post.coins.coin.address} ticker={post.coins.coin.ticker} imageUrl={post.coins.coin.imageUrl} size={22} />
            </span>
          ) : null}
          {status.line}
          {status.facts !== undefined && status.facts.length > 0 ? <span className={styles['facts']}>{status.facts.join(', ')}</span> : null}
        </span>
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

/**
 * The poster's own profile picture beside the handle (the owner, 2026-10-13). The handle's first
 * letter only when the account has no picture stored or the picture will not load.
 */
function PosterPic({ url, label }: { url: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  if (url !== null && !failed) return <img className={styles['posterPic']} src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
  return <span className={styles['posterLetter']} aria-hidden="true">{(label.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
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
      return <button type="button" className={styles['buy']} aria-label={`Buy ${tickerText(action.coin.ticker)}`} onClick={tap(handlers.open)}>Buy</button>;
    case 'view':
      return <Button look="quiet" onClick={tap(handlers.open)}>View coins</Button>;
    case 'see':
      return <Button look="quiet" onClick={tap(handlers.seeCoins)}>{seeCoinsLabel(action.count, action.more)}</Button>;
  }
}
