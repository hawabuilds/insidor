/**
 * One single post on the For You or Popular feed, as a card, laid out like the feeds people already
 * scroll (the owner, 2026-11-10, feed-best): a head line, the post's words across the card's whole
 * width, its picture or video at full width, then the coin and Buy.
 *
 * ★ THE HEAD IS ONE LINE: the poster's picture, their @handle, the platform's mark, "·" and the
 * age on the left, and the views number on the right, all centred on the same line. A long handle
 * ends in "…"; the mark, the age and the views are never cut. Nothing hangs under the views: a
 * second line there is what made the head look misaligned in every earlier try.
 *
 * ★ THE WORDS GET THE CARD'S FULL WIDTH, up to three lines, then "Show more", which opens the rest
 * inside the card (it never opens the sheet). "Translated from …" sits under the words because it
 * is about the words, and the list's own line (today's gain, Trending's speed) under that.
 *
 * ★ THE MEDIA IS ONE FIXED HEIGHT ON EVERY CARD (row.module.css `.media`), so the feed scrolls with
 * an even rhythm. An X video or GIF plays in it, muted, while it is on screen (FeedVideo.tsx, the
 * server's `video`); a TikTok video shows its cover with a play icon and plays in the sheet, where
 * TikTok's player is. The narrative tag sits on the media's bottom left; a card with no media shows
 * it under the words. A post with no picture, or one that will not load, has no media box at all.
 *
 * A post written in another language shows its English, with "Translated from <language>" and
 * "Show original" under it (shared/ui/Translated.tsx); a tap there swaps the words and never opens
 * the sheet.
 *
 * ★ TWO WAYS OUT, THE WAY SOCIAL APPS DO THEM: the platform's mark beside the handle opens the post
 * on its source (as pump.fun's callouts do; a deleted post's mark is no link), and Share in the foot
 * row sends the post's page in the app (shared/share-link.ts, the sheet's own share).
 *
 * ★ THE CARD IS READ IN THE FEED; A TAP ON IT OPENS NOTHING (the owner, 2026-11-10: "get rid of the
 * view pop up", for For You cards only). Its words open with Show more, its video plays in place and
 * a tap on a video turns its sound on, a TikTok video plays in TikTok's player inside the card. Buy
 * opens the buy ticket at once (`buy`, BuyOpen.tsx), never the post sheet; the coin's name opens its
 * chart. The post sheet is still where a PvP's Buy, View coins and See N coins go (a choice between
 * coins, with its warnings), and where shared links and alerts open. Create coin opens the create
 * flow. The button's WORDS come from the coin line below, so the card says what the post's coin is
 * before anyone taps.
 * ★ A TAP ON THE CARD'S COIN (its logo and ticker, when the card names one coin) OPENS THAT COIN'S
 * TOKEN PAGE (`openCoin`, the owner 2026-10-14): every coin tap in the app opens the coin.
 *
 * ★ EVERY CARD ENDS IN ONE ROW, AND IT IS THE SERVER'S ANSWER, NOT OURS (coin-status.ts `cardRow`; the
 * owner's cards-clean.html, 2026-10-31): at the foot of the card (no divider), the coin (logo, ticker,
 * market cap) or a few grey words, then Share and the Watch star as plain icons with no box (the owner's
 * option E, 2026-11-10: Buy is the only solid shape on the card), then its buttons, 44px, last:
 *
 *   matched / one → the coin and Buy; no sentence and no tie line ("Links this post, Same picture…"
 *              is said in the post pop-up, PostSheet, never lost)
 *   unsure   → "3 coins use this name" and See 3 coins (the real count, "10+" when the search found
 *              more than it kept); never Buy on an unsure match
 *   none     → "No coin yet" and Create coin
 *   pending  → "— still checking", no button; unchecked → "Couldn't check", no button
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
 * ★ A POST DELETED FROM ITS SOURCE SAYS SO ("Deleted on X", the owner 2026-10-24) under the byline,
 * and keeps everything we stored: its words, picture and views as last read. The server sends
 * `deletedAt` only with proof (services/runner work/gone-posts.ts); a post we merely could not read
 * again carries nothing and shows as before.
 *
 * ★ A POST A HUGE ACCOUNT JUST SHARED SAYS WHO ("Quoted by @elonmusk · 2h", the server's
 * `sharedBy`), with that account's face, under the byline. It is why an older post is on For You,
 * said as a fact; the byline keeps the post's own age.
 *
 * ★ A POST WITH A PVP (two or more coins made for it being bought at once, shared/pvp.ts) has the same
 * row (the owner's option B, 2026-10-31): the leading coin (highest read cap), a quiet grey "PvP +N"
 * (N the other racing coins) that opens the sheet on its coins as "See N coins" does, and Buy, which
 * opens the post sheet like every card Buy. A tap on the coin opens its page.
 *
 * What breaks if changed carelessly: a button that skips `stopPropagation` fires the card's tap
 * as well, and a card that opens anything but the post sheet sends the person out of the flow.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { RisingPost } from '../api/index.ts';
import type { Measured } from '../format/measure.ts';
import { quotePictureLeads, sharedByLabel, type PostInStory } from '../api/wire/rising.ts';
import { storyWords } from '../story-words.ts';
import { cardRow, seeCoinsLabel, type CardAction } from '../coin-status.ts';
import { pvpCoins } from '../pvp.ts';
import { formatUsd } from '../format/number.ts';
import { useCoinCap } from '../useCoinCap.ts';
import { formatAge } from '../format/duration.ts';
import { formatCount } from '../format/number.ts';
import { tickerText } from '../format/ticker.ts';
import { deletedLine, platformOf } from '../platform.ts';
import { postPicSources } from '../post-pic.ts';
import { CoinLogo } from './CoinLogo.tsx';
import { FeedVideo } from './FeedVideo.tsx';
import { TikTokPlayer } from '../../features/post-sheet/TikTokPlayer.tsx';
import { Viewer, type Full } from '../../features/post-sheet/PostMedia.tsx';
import { tiktokVideoId } from '../../features/post-sheet/tiktok-player.ts';
import { PlayIcon, ShareIcon } from './icons.tsx';
import { sharePage } from '../share-link.ts';
import { useToast } from './ComingSoon.tsx';
import { HeadLine } from './HeadLine.tsx';
import { POST_PIC_BASE } from './post-pic-base.ts';
import { QuoteInset } from './QuoteInset.tsx';
import { usePictureTries } from './usePictureTries.ts';
import { usePosterPic } from './usePosterPic.ts';
import { TranslatedLine, useShownWords } from './Translated.tsx';
import { Value } from './Value.tsx';
import styles from './row.module.css';

export interface PostHandlers {
  /** Opens the post sheet: View coins, and Buy when the card is a PvP or `buy` is absent. */
  readonly open: () => void;
  /** Opens the buy ticket for the card's one coin straight from the feed. Absent: Buy opens the post sheet. */
  readonly buy?: (coin: BuyCoin) => void;
  /** Opens the create flow from this post. */
  readonly create: () => void;
  /** Opens the post sheet on Choose coin: every coin with the post's name. */
  readonly seeCoins: () => void;
  /** Opens the token page of the coin the card names. Absent: the coin line is part of the card's tap. */
  readonly openCoin?: (coinId: string) => void;
  /** Opens the narrative the post is part of. Absent (as on that narrative's own page): no tag. */
  readonly openStory?: (storyId: string) => void;
}

/** The media box's height on every card, in px (row.module.css `.media`). */
const MEDIA_HEIGHT = 168;

/** The coin a card's Buy is for. */
export type BuyCoin = Extract<CardAction, { readonly kind: 'buy' }>['coin'];

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
  const row = cardRow(coins, owner);
  /* ★ A PvP (shared/pvp.ts), with this card's live cap for its own coin: the row names the leader, and
     "PvP +N" counts the others. Without the race's coins (an older server) it names the post's coin. */
  const pvp = own === null ? null : pvpCoins(post.coins, { address: own.address, cap });
  const leader = pvp?.[0] ?? null;
  const shown: RowCoin | null = leader !== null ? leader : row.coin;
  /* A PvP's Buy is the leader's and opens the post sheet, where every coin has its own ticket: always drawn. */
  const actions: readonly CardAction[] = pvp === null || own === null ? row.actions : [{ kind: 'pvp', others: pvp.length - 1 }, { kind: 'buy', coin: own }];
  const note = pvp === null ? row.note : null;
  /* The English when the post was written in another language, with its line (Translated.tsx). */
  const words = useShownWords(post);

  const platform = platformOf(post.sourceLabel);
  /* A deleted post's page is gone: its mark is no link out (RisingPost.deletedAt). */
  const sourceLink = post.permalink !== null && post.deletedAt === undefined ? post.permalink : null;
  const tag = post.inStory !== undefined && handlers.openStory !== undefined ? <StoryTag tag={post.inStory} open={handlers.openStory} /> : null;

  return (
    <article className={styles['card']} ref={cardRef}>
      {/* ★ THE HEAD (HeadLine.tsx, shared with every post in the app): picture, @handle, the platform's mark
         (a link to the post on its source), "·", the age; views on the right. */}
      <HeadLine
        face={{ file: post.authorPictureFile, url: post.authorPictureUrl }}
        label={post.authorLabel}
        platform={platform}
        sourceLabel={post.sourceLabel}
        sourceLink={sourceLink}
        age={formatAge(post.postedAt, now)}
        right={
          <span className={styles['views']}>
            <Value r={formatCount(post.reach)} className={styles['viewsN']} />
            <span className={styles['viewsL']}>views</span>
          </span>
        }
      />

      <PostWords text={words.text} />
      <TranslatedLine line={words.line} compact className={styles['translatedLine']} />
      {sortLine !== null ? <span className={sortLine.up ? styles['gained'] : styles['speed']}>{sortLine.text}</span> : null}
      {post.sharedBy !== undefined ? (
        <div className={styles['shared']}>
          <span>
            <PosterPic key={`${post.sharedBy.authorPictureFile ?? ''} ${post.sharedBy.authorPictureUrl ?? ''}`} file={post.sharedBy.authorPictureFile} url={post.sharedBy.authorPictureUrl} label={post.sharedBy.authorLabel} />
            {sharedByLabel(post.sharedBy)}
          </span>
          <Value r={formatAge(post.sharedBy.at, now)} className={styles['age']} />
        </div>
      ) : null}
      {post.deletedAt !== undefined ? <span className={styles['gone']}>{deletedLine(post.sourceLabel)}</span> : null}

      {/* The picture or video at full width, the narrative tag on it; with no media, the tag alone. */}
      <CardMedia post={post} tag={tag} />

      {/* The post this one quotes, inside the card (QuoteInset.tsx); its picture only when it is not already the card's. */}
      {post.quote !== undefined ? <QuoteInset quote={post.quote} showPicture={!quotePictureLeads(post)} now={now} /> : null}

      {/* ★ THE ONE ROW (coin-status.ts `cardRow`): the coin or a few grey words, then Share and the star as plain icons, then the row's buttons last, under the thumb. */}
      <div className={styles['row']}>
        {shown !== null ? (
          <span
            className={styles['coin']}
            onClick={handlers.openCoin !== undefined ? (e) => { e.stopPropagation(); handlers.openCoin?.(shown.coinId); } : undefined}
          >
            <CoinLogo small address={shown.address} ticker={shown.ticker} imageUrl={shown.imageUrl} size={32} />
            {/* The ticker over its cap (or the coin's grey words), so the whole ticker fits beside the buttons. */}
            <span className={styles['coinText']}>
              <b className={styles['ticker']}>{tickerText(shown.ticker)}</b>
              {note !== null ? (
                <span className={styles['coinNote']}>{note.replace(/^—\s*/, '')}</span>
              ) : (
                /* A cap not read is a dash with its reason (Value), never left blank or "$0". */
                <Value r={formatUsd(shown.marketCapUsd)} className={styles['cap']} num />
              )}
            </span>
          </span>
        ) : null}
        {note !== null && shown === null ? <span className={styles['note']}>{note}</span> : null}
        <span className={styles['actions']}>
          <ShareButton postId={post.id} title={`${post.authorLabel} on Insidor`} />
          {watch}
          {actions.map((action) => <ActionButton key={action.kind} action={action} handlers={handlers} buyDirect={pvp === null ? handlers.buy : undefined} />)}
        </span>
      </div>
      {extra}
    </article>
  );
}

/**
 * The post's words across the card's width: three lines, then "Show more", which opens the rest in
 * the card. "Show more" is there only when the words were really cut, measured after drawing, so a
 * short post never offers more than it has.
 */
function PostWords({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null || expanded) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, [text, expanded]);
  return (
    <div className={styles['words']}>
      <p ref={ref} className={expanded ? styles['postTextOpen'] : styles['postText']}>
        {text}
      </p>
      {cut && !expanded ? (
        <button type="button" className={styles['more']} onClick={() => setExpanded(true)}>
          Show more
        </button>
      ) : null}
    </div>
  );
}

/**
 * The card's picture or video at full width, one height on every card. Our stored copy at the
 * sheet's size first (post-pic.ts), then the link as it came. An X video or GIF plays in the box
 * (FeedVideo.tsx); a video that fails shows its still, and a still that will not load takes the box
 * away, leaving the narrative tag alone under the words.
 */
/** What a media box needs of a post: a For You card's post, or one post of a narrative's row (Story.rowPosts). */
export type MediaPost = Pick<RisingPost, 'id' | 'sourceLabel' | 'thumbUrl' | 'thumbFile' | 'thumbIsVideo' | 'video'>;

/**
 * `height`: the box's height (the card's MEDIA_HEIGHT by default). `badge`: something laid on the
 * box's bottom left, under nothing else (the narrative row's views); `tag` sits there on a card.
 */
export function CardMedia({ post, tag = null, badge = null, height = MEDIA_HEIGHT }: { post: MediaPost; tag?: ReactNode; badge?: ReactNode; height?: number }) {
  const sources = postPicSources(post.thumbFile, post.thumbUrl === null ? [] : [post.thumbUrl], POST_PIC_BASE, 'sheet');
  const { src, tryKey, fail } = usePictureTries(sources);
  const [videoFailed, setVideoFailed] = useState(false);
  /* A TikTok video has no file we can play: a tap puts TikTok's own player in the box (TikTokPlayer.tsx). */
  const tiktok = post.video === undefined && post.thumbIsVideo && platformOf(post.sourceLabel) === 'tiktok' ? tiktokVideoId(post.id) : null;
  const [tiktokOn, setTiktokOn] = useState(false);
  /* ★ A TAP ON THE MEDIA OPENS IT FULL SCREEN (the post sheet's Viewer): a picture whole, a video
     with sound and controls from the second it was at, a GIF looping. A TikTok video plays in
     TikTok's player in the box instead, whose own full-screen button is the way to full screen. */
  const [full, setFull] = useState<Full | null>(null);
  const video = post.video !== undefined && !videoFailed ? post.video : null;
  if (src === null && video === null) return tag;
  const tap = () => {
    if (tiktok !== null) setTiktokOn(true);
    else if (src !== null) setFull({ kind: 'picture' });
  };
  /* The viewer sits beside the box, not in it: a portal's taps still reach its React parents, and
     inside the box its X would reach `tap` and open it again. */
  return (
    <>
    {/* Its taps are stopped here too: on a narrative card (a tap target itself) the X would otherwise also open the narrative. */}
    {full !== null ? (
      <span onClick={(e) => e.stopPropagation()}>
        <Viewer media={{ playUrl: video?.playUrl ?? null, posterUrl: src ?? '' }} full={full} onClose={() => setFull(null)} />
      </span>
    ) : null}
    <div className={styles['media']} style={{ height }} onClick={tiktokOn ? undefined : (e) => { e.stopPropagation(); tap(); }}>
      {src !== null ? <img key={tryKey} className={styles['mediaImg']} src={src} alt="" loading="lazy" decoding="async" onError={() => fail(src)} /> : null}
      {video !== null ? (
        <FeedVideo
          src={video.playUrl}
          poster={src}
          silent={video.loops}
          hold={full !== null}
          onOpen={(at) => setFull({ kind: 'video', at, muted: video.loops, loop: video.loops })}
          onFail={() => setVideoFailed(true)}
        />
      ) : null}
      {tiktok !== null && tiktokOn && src !== null ? (
        <div className={styles['mediaFill']}>
          <TikTokPlayer id={tiktok} posterUrl={src} height={height} onFail={() => setTiktokOn(false)} />
        </div>
      ) : null}
      {video === null && post.thumbIsVideo && !tiktokOn ? (
        tiktok !== null ? (
          <button type="button" className={styles['mediaPlay']} aria-label="Play the video" onClick={(e) => { e.stopPropagation(); setTiktokOn(true); }}>
            <PlayIcon size={18} />
          </button>
        ) : (
          <span className={styles['mediaPlay']} aria-label="Video">
            <PlayIcon size={18} />
          </span>
        )
      ) : null}
      {tag !== null ? <div className={styles['mediaTag']}>{tag}</div> : null}
      {badge !== null ? <div className={styles['mediaBadge']}>{badge}</div> : null}
    </div>
    </>
  );
}

/** Share the post's page in the app (shared/share-link.ts): the phone's share sheet, or the link copied. */
function ShareButton({ postId, title }: { postId: string; title: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      className={styles['iconButton']}
      aria-label="Share this post"
      onClick={(e) => {
        e.stopPropagation();
        void sharePage({ screen: 'post', postId }, title).then((o) => {
          if (o === 'copied') toast('Link copied');
          else if (o === 'failed') toast("Couldn't share the link");
        });
      }}
    >
      <ShareIcon size={18} />
    </button>
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

/** What the row names of a coin: the card's own coin, or a PvP's leader. */
interface RowCoin {
  readonly coinId: string;
  readonly address: string;
  readonly ticker: string;
  readonly imageUrl: string | null;
  readonly marketCapUsd: Measured;
}

/** One button the row asked for, and never one it did not; all one height and corner (row.module.css). */
/** `buyDirect`: Buy opens the ticket at once; absent (a PvP, whose sheet warns of the bigger coin), Buy opens the post sheet. */
function ActionButton({ action, handlers, buyDirect }: { action: CardAction; handlers: PostHandlers; buyDirect?: ((coin: BuyCoin) => void) | undefined }) {
  const tap = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  switch (action.kind) {
    case 'create':
      return <button type="button" className={styles['create']} onClick={tap(handlers.create)}>Create coin</button>;
    case 'buy':
      return <button type="button" className={styles['buy']} aria-label={`Buy ${tickerText(action.coin.ticker)}`} onClick={tap(buyDirect !== undefined ? () => buyDirect(action.coin) : handlers.open)}>Buy</button>;
    case 'view':
      return <button type="button" className={styles['ghost']} onClick={tap(handlers.open)}>View coins</button>;
    case 'see':
      return <button type="button" className={styles['ghost']} onClick={tap(handlers.seeCoins)}>{seeCoinsLabel(action.count, action.more)}</button>;
    case 'pvp':
      return (
        <button type="button" className={styles['ghost']} aria-label={`PvP, ${action.others} more ${action.others === 1 ? 'coin' : 'coins'} for this post`} onClick={tap(handlers.seeCoins)}>
          <span className={styles['pvpTag']}>PvP</span>+{action.others}
        </button>
      );
  }
}
