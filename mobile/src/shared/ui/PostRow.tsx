/**
 * One single post on the For You or Popular feed, as a card.
 *
 * The story card's layout (row.module.css) with a post's facts in it: the post's own picture
 * with its platform badge, its words as the title, who posted it (with their profile picture) and
 * how long ago, its views and views line. This is the card as it looked before the post sheet was
 * built, kept that way on purpose: the owner asked for the old look back.
 * A post with no picture or video has no thumbnail box at all, so its words use the card's full
 * width; a card with media is unchanged. The picture is asked for at the card's size
 * (picture-size.ts, inside Thumb, which falls back to the link as it came), never the full posted
 * size: a long feed decodes hundreds of them.
 *
 * A post written in another language shows its English, with "Translated from <language>" and
 * "Show original" under it (shared/ui/Translated.tsx); a tap there swaps the words and never opens
 * the sheet.
 *
 * ★ A TAP ON THE CARD OPENS THE POST SHEET (features/post-sheet): the card, its title, Buy and View
 * coins. Two buttons go straight to where they say: Create coin opens the create flow from the
 * post, and See N coins opens the sheet on Choose coin, with its quick buy. The button's WORDS come
 * from the coin line below, so the card says what the post's coin is before anyone taps.
 * ★ A TAP ON THE CARD'S COIN (its logo and ticker, when the card names one coin) OPENS THAT COIN'S
 * TOKEN PAGE (`openCoin`, the owner 2026-10-14): every coin tap in the app opens the coin.
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
 * ★ ON TRENDING THE CARD SAYS HOW FAST IT IS GAINING (`sortLine`): "394 views a minute, up 2.1x in the last hour"
 * under its views, green when up, from its own readings as the read service counted them (the owner,
 * 2026-10-18). It is the fact the list is about, never the list's own key, which is not sent. On
 * Most viewed there is no line: the big views number is what the list is ordered by.
 *
 * ★ A POST THAT QUOTES ANOTHER SHOWS IT INSIDE THE CARD (QuoteInset.tsx, the owner 2026-10-24): the
 * quoted account's picture, name and @handle, its words and its picture. A quote with no picture of
 * its own leads with the quoted post's picture (the server's `thumbUrl`), so the meme shows at a
 * glance, and the box then shows no second copy of it.
 *
 * ★ A POST IN A REAL NARRATIVE CARRIES A SMALL TAG ("GTA 6 story, 12 posts", the read service's
 * `inStory`) that opens the narrative, when the screen passes `openStory`; the narrative's own page
 * does not, since the post is already in front of its narrative there.
 *
 * What breaks if changed carelessly: a button that skips `stopPropagation` fires the card's tap
 * as well, and a card that opens anything but the post sheet sends the person out of the flow.
 */

import type { ReactNode } from 'react';
import type { RisingPost } from '../api/index.ts';
import { quotePictureLeads, type PostInStory } from '../api/wire/rising.ts';
import { storyWords } from '../story-words.ts';
import { postCoinStatus, seeCoinsLabel, type PostAction } from '../coin-status.ts';
import { useCoinCap } from '../useCoinCap.ts';
import { formatAge } from '../format/duration.ts';
import { compact, formatCount } from '../format/number.ts';
import { tickerText } from '../format/ticker.ts';
import { platformOf } from '../platform.ts';
import { Button } from './Button.tsx';
import { CoinLogo } from './CoinLogo.tsx';
import { QuoteInset } from './QuoteInset.tsx';
import { usePosterPic } from './usePosterPic.ts';
import { Sparkline } from './Sparkline.tsx';
import { Thumb } from './Thumb.tsx';
import { TranslatedLine, useShownWords } from './Translated.tsx';
import { Value } from './Value.tsx';
import styles from './row.module.css';
import { Nums } from './Num.tsx';

export interface PostHandlers {
  /** Opens the post sheet: a tap on the card, its title, Buy or View coins. */
  readonly open: () => void;
  /** Opens the create flow from this post. */
  readonly create: () => void;
  /** Opens the post sheet on Choose coin: every coin with the post's name. */
  readonly seeCoins: () => void;
  /** Opens the token page of the coin the card names. Absent: the coin line is part of the card's tap. */
  readonly openCoin?: (coinId: string) => void;
  /** Opens the narrative the post is part of. Absent (as on that narrative's own page): no tag. */
  readonly openStory?: (storyId: string) => void;
}

const NO_COIN = { known: false, pending: 'not_minted' } as const;

/**
 * `extra`: a strip under the coin line that the card does not decide (the owner's controls).
 * `watch`: the Watch star, last on the coin line's row, drawn by the caller (shared/ui/WatchStar.tsx).
 * `cardRef`: the card's element, for a caller that times what is on screen (the owner's, features/owner/useSeen.ts).
 * `owner`: the owner is looking, so a list kept for the owner (`ownerList`) is offered; false for everyone else.
 */
export function PostRow({ post, now, handlers, extra = null, watch = null, sortLine = null, cardRef, owner = false }: { post: RisingPost; now: number; handlers: PostHandlers; extra?: ReactNode; watch?: ReactNode; sortLine?: { readonly text: string; readonly up: boolean } | null; cardRef?: ((el: Element | null) => void) | undefined; owner?: boolean }) {
  /* The coin line's cap is the shared one (shared/coin-cap.ts): live while a fresh price is held,
     so the card says what the sheet and token page say. The card itself never polls. */
  const own = post.coins.kind === 'one' || post.coins.kind === 'matched' ? post.coins.coin : null;
  const cap = useCoinCap(own?.address ?? '', own?.marketCapUsd ?? NO_COIN, false, own?.priceUsd ?? null);
  const coins = own !== null && (post.coins.kind === 'one' || post.coins.kind === 'matched') ? { ...post.coins, coin: { ...own, marketCapUsd: cap } } : post.coins;
  const status = postCoinStatus(coins, owner);
  /* The English when the post was written in another language, with its line (Translated.tsx). */
  const words = useShownWords(post);

  return (
    <article className={styles['card']} onClick={handlers.open} ref={cardRef}>
      <div className={styles['body']}>
        {/* A post with no picture or video has no thumbnail box: its words take the card's width. */}
        {post.thumbUrl !== null || post.thumbIsVideo ? (
          <Thumb
            url={post.thumbUrl}
            file={post.thumbFile}
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
              {words.text}
            </a>
            <TranslatedLine line={words.line} compact className={styles['translatedLine']} />
            <span className={styles['spark']}>
              <Sparkline points={post.spark.points} windowMs={post.spark.windowMs} width={44} label={`Views over time for this post by ${post.authorLabel}`} />
            </span>
            <div className={styles['views']}>
              <Value r={formatCount(post.reach)} className={styles['viewsN']} />
              <span className={styles['viewsL']}>views</span>
            </div>
            <div className={styles['byline']}>
              <span>
                <PosterPic key={`${post.authorPictureFile ?? ''} ${post.authorPictureUrl ?? ''}`} file={post.authorPictureFile} url={post.authorPictureUrl} label={post.authorLabel} />
                {post.authorLabel}
              </span>
              <Value r={formatAge(post.postedAt, now)} className={styles['age']} />
            </div>
            {sortLine !== null ? <span className={sortLine.up ? styles['gained'] : styles['speed']}>{sortLine.text}</span> : null}
          </div>
        </div>
      </div>

      {/* The post this one quotes, inside the card (QuoteInset.tsx); its picture only when it is not already the card's. */}
      {post.quote !== undefined ? <QuoteInset quote={post.quote} showPicture={!quotePictureLeads(post)} now={now} /> : null}

      {post.inStory !== undefined && handlers.openStory !== undefined ? <StoryTag tag={post.inStory} open={handlers.openStory} /> : null}

      <div className={status.actions.length > 1 ? `${styles['foot']} ${styles['footWrap']}` : styles['foot']}>
        <span
          className={styles['status']}
          onClick={own !== null && handlers.openCoin !== undefined ? (e) => { e.stopPropagation(); handlers.openCoin?.(own.coinId); } : undefined}
        >
          {post.coins.kind === 'one' || post.coins.kind === 'matched' ? (
            <span className={styles['statusLogo']}>
              <CoinLogo small address={post.coins.coin.address} ticker={post.coins.coin.ticker} imageUrl={post.coins.coin.imageUrl} size={22} />
            </span>
          ) : null}
          <Nums text={status.line} />
          {status.facts !== undefined && status.facts.length > 0 ? <span className={styles['facts']}><Nums text={status.facts.join(', ')} /></span> : null}
        </span>
        {status.actions.length > 0 || watch !== null ? (
          <span className={styles['actions']}>
            {status.actions.map((action) => <ActionButton key={action.kind} action={action} handlers={handlers} />)}
            {watch}
          </span>
        ) : null}
      </div>
      {extra}
    </article>
  );
}

/**
 * The poster's own profile picture beside the handle (the owner, 2026-10-13): our storage's copy,
 * else the source's link (usePosterPic.ts). The handle's first letter only when the account has no
 * picture stored or none of them will load.
 */
function PosterPic({ file, url, label }: { file: string | null; url: string | null; label: string }) {
  const { src, tryKey, onError } = usePosterPic(file, url);
  if (src !== null) return <img key={tryKey} className={styles['posterPic']} src={src} alt="" loading="lazy" onError={onError} />;
  return <span className={styles['posterLetter']} aria-hidden="true">{(label.replace(/^@/, '').trim()[0] ?? '?').toUpperCase()}</span>;
}

/**
 * The small narrative tag (the owner, 2026-10-16): "GTA 6 story, 12 posts", one line, the title
 * cut first. A tap opens the narrative, never the post sheet under it.
 */
function StoryTag({ tag, open }: { tag: PostInStory; open: (storyId: string) => void }) {
  const w = storyWords(tag.title, tag.posts);
  return (
    <button
      type="button"
      className={styles['storyTag']}
      onClick={(e) => {
        e.stopPropagation();
        open(tag.storyId);
      }}
    >
      <span className={styles['storyTagName']}>{w.name ?? 'Part of a'}</span>
      <span className={styles['storyTagRest']}>{` story${w.count !== null ? `, ${w.count}` : ''}`}</span>
    </button>
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
      return <button type="button" className={styles['buy']} aria-label={`Buy ${tickerText(action.coin.ticker)}`} onClick={tap(handlers.open)}>Buy</button>;
    case 'view':
      return <Button look="quiet" onClick={tap(handlers.open)}>View coins</Button>;
    case 'see':
      return <Button look="quiet" onClick={tap(handlers.seeCoins)}>{seeCoinsLabel(action.count, action.more)}</Button>;
  }
}
