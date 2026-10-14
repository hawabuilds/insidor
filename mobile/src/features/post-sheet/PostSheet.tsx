/**
 * THE POST SHEET — one feed post, opened from its For You card or from a coin page's viral post
 * card: who posted it, the post itself (its video plays here), its views and how they grew, and
 * the post's main coin with Buy, Create and the full coin list (Choose coin, ChooseCoin.tsx).
 *
 * Its own feature folder because two screens open it (features/feed and features/token), and
 * neither should own the other's sheet. The props are the contract the token page builds on
 * (post-sheet-contract.md in the coordinator's notes): `postId` is the feed post's id
 * (`RisingPost.id`, the same id `AboutPost.postId` carries) and `onClose` puts the screen back as
 * it was, tab bar included — the sheet sits over it and takes nothing away.
 *
 * ★ TWO PARTS, as the owner laid it out. The head (who posted it, the Watch star, the open button and
 * the X) and the foot (the coin line, the coin with Buy, then Create and All coins) stay put; the
 * middle (the words, the media at its own shape, whole, the views, the chart, the tiles) scrolls when it
 * is taller than the phone. Nothing shrinks to fit. It is drawn with the shared Sheet
 * (shared/ui/Sheet.tsx), which gives it every way to close. ★ FACTS ONLY: who, when, how many,
 * and which coin; never how sure. ★ THE ONLY LINK OUT is the open button, to the post where it
 * was posted, an outlined square so it is never mistaken for the round X beside it.
 *
 * Buy opens the existing ticket unchanged (BuyOpen.tsx); there is no quick buy here — that is on
 * Choose coin only. Tapping the coin row anywhere else opens that coin's token page.
 *
 * `start: 'coins'` opens straight on Choose coin (a For You card's "See N coins"); its back arrow
 * still leads to the post.
 *
 * What breaks if changed carelessly: renaming or adding a required prop breaks the token page,
 * which renders this sheet knowing nothing else about the post.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ReadError, fetchPostSheet, type PostSheetData, type SheetCoin } from '../../shared/api/index.ts';
import { evidenceFacts } from '../../shared/coin-status.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { compact, formatCount } from '../../shared/format/number.ts';
import { useLoad, useNow } from '../../shared/hooks.ts';
import { platformOf } from '../../shared/platform.ts';
import { hrefFor } from '../../shared/route.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { WatchStar } from '../../shared/ui/WatchStar.tsx';
import { PlatformBadge } from '../../shared/ui/PlatformMark.tsx';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { CreateCoin } from '../create/CreateCoin.tsx';
import { usePreloadCreate } from '../create/preload.ts';
import { sheetCoinRoute } from '../token/coin-opening.ts';
import { BuyOpen, SheetToast, type SheetNote } from './BuyOpen.tsx';
import { ChooseCoin } from './ChooseCoin.tsx';
import { CoinLine } from './CoinLine.tsx';
import { PostMedia } from './PostMedia.tsx';
import { tiktokVideoId } from './tiktok-player.ts';
import { ReachChart } from './ReachChart.tsx';
import { OpenIcon } from './sheet-icons.tsx';
import { chartPlan, coinTag, firstCoinAfter, followersText, foundTag, gainText, provenWhy, recentGain } from './sheet-view.ts';
import styles from './post-sheet.module.css';

export interface PostSheetProps {
  /** The feed post's id: `RisingPost.id`, or `AboutPost.postId` on a coin page. */
  readonly postId: string;
  readonly onClose: () => void;
  /** Which view opens first: the post (the default) or Choose coin. */
  readonly start?: 'post' | 'coins';
}

const CHART_HEIGHT = 96;
/** The sheet's side padding, both sides, and the widest the app's column gets. */
const SIDES = 32;
/** The post card's own padding, both sides (post-sheet.module.css .postCard), inside the sheet's. */
const CARD_SIDES = 16;
const COLUMN = 480;
/**
 * The tallest the media box may be, in px (the owner, 2026-10-13): 200, so on a 390x844 phone the
 * whole sheet, post card, views, chart, tiles, coin row and buttons, fits without scrolling. A
 * taller or portrait frame is shown whole inside it with dark bars at the sides, never cropped or
 * squashed; a tap opens it full screen (PostMedia.tsx).
 */
const MEDIA_TALLEST = 200;
/** How many lines of the post's words show before a tap: fewer above media, more with none. */
const TEXT_LINES = { withMedia: 2, alone: 6 } as const;

/**
 * The media box's height: the media's own shape at the sheet's real width, so the whole frame
 * shows; a taller frame stops at MEDIA_TALLEST and is shown whole inside it. A post
 * that does not say its shape gets a square box. (PostMedia.tsx draws the media in it, contained.)
 */
function mediaHeight(width: number | null, height: number | null): number {
  const inner = Math.min(window.innerWidth, COLUMN) - SIDES - CARD_SIDES;
  const shape = width !== null && height !== null && width > 0 && height > 0 ? height / width : 1;
  return Math.round(Math.min(inner * shape, MEDIA_TALLEST));
}

export function PostSheet({ postId, onClose, start = 'post' }: PostSheetProps) {
  const [loaded, reload] = useLoad(`post-sheet:${postId}`, (signal) => fetchPostSheet(postId, signal));
  usePreloadCreate(postId); /* Create coin then opens on this post's own names, with nothing filling in. */
  const [view, setView] = useState<'post' | 'coins'>(start);
  const [buying, setBuying] = useState<SheetCoin | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<SheetNote | null>(null);
  const clearNote = useCallback(() => setNote(null), []);

  const data = loaded.state === 'ready' ? loaded.value : null;
  /* Leaving for another screen: the sheet closes, then the address changes (dismiss.ts steps over
     the sheet's history entry, so back from that screen comes straight here). */
  const go = (href: string) => {
    onClose();
    window.location.hash = href;
  };
  /* A coin's page, always (coin-opening.ts): the post's proven coin with its narrative around it,
     any other by its own id with the grey "not proven" line. */
  const openCoin = (c: SheetCoin) => go(hrefFor(sheetCoinRoute(c, data?.post.storyId ?? data?.narrative?.storyId ?? null)));

  return (
    <>
      <Sheet label={view === 'coins' ? 'Choose coin' : 'Post'} onClose={onClose} escape={buying === null && !creating}>
        {data === null ? (
          <>
            <SheetHead title="Post" />
            <SheetBody last>
              {loaded.state === 'loading' ? <p className={styles['note']}>Reading the post.</p> : null}
              {loaded.state === 'failed' ? (
                <div className={styles['note']}>
                  <p>
                    {loaded.error instanceof ReadError && loaded.error.said === 'not found'
                      ? 'This post has left the feed, so there is nothing more to show about it.'
                      : "Couldn't read this post just now."}
                  </p>
                  {!(loaded.error instanceof ReadError && loaded.error.said === 'not found') ? (
                    <button type="button" className={styles['dark']} onClick={reload}>Try again</button>
                  ) : null}
                </div>
              ) : null}
            </SheetBody>
          </>
        ) : view === 'post' ? (
          <PostView data={data} onBuy={setBuying} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onAll={() => setView('coins')} onNarrative={(id) => go(hrefFor({ screen: 'story', storyId: id }))} />
        ) : (
          <ChooseCoin data={data} onBack={() => setView('post')} onOpenCoin={openCoin} onCreate={() => setCreating(true)} onNote={setNote} />
        )}
      </Sheet>
      {buying !== null ? (
        <BuyOpen mint={buying.address} ticker={buying.ticker ?? buying.name ?? ''} onClose={() => setBuying(null)} onNote={setNote} />
      ) : null}
      {creating && data !== null ? (
        <CreateCoin
          from={{ title: data.post.excerpt, reach: data.post.reach, thumbUrl: data.post.thumbUrl, labelled: false, storyId: data.post.storyId, link: data.post.permalink, postId: data.post.id }}
          onClose={() => setCreating(false)}
        />
      ) : null}
      <SheetToast note={note} onDone={clearNote} />
    </>
  );
}

/**
 * The post's words, always at the top of the sheet: cut to `lines`, and when they are cut a tap
 * shows them all (and another tap cuts them again). Words that fit are plain text, not a button.
 */
function PostText({ text, lines }: { text: string; lines: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const p = ref.current;
    if (p !== null && !open) setCut(p.scrollHeight > p.clientHeight + 1);
  }, [text, lines, open]);
  return (
    <p
      ref={ref}
      className={`${styles['text']} ${cut ? styles['textCut'] : ''}`}
      style={open ? { WebkitLineClamp: 'unset', display: 'block' } : { WebkitLineClamp: lines }}
      {...(cut ? { role: 'button', tabIndex: 0, 'aria-expanded': open, onClick: () => setOpen((o) => !o), onKeyDown: (e: { key: string }) => e.key === 'Enter' && setOpen((o) => !o) } : {})}
    >
      {text}
    </p>
  );
}

function PostView({ data, onBuy, onOpenCoin, onCreate, onAll, onNarrative }: {
  data: PostSheetData;
  onBuy: (c: SheetCoin) => void;
  onOpenCoin: (c: SheetCoin) => void;
  onCreate: () => void;
  onAll: () => void;
  onNarrative: (storyId: string) => void;
}) {
  const now = useNow();
  const post = data.post;
  const platform = platformOf(post.sourceLabel);
  const [mediaGone, setMediaGone] = useState(false);
  const readings = data.views.length > 0 ? data.views : post.spark.points.map((p) => ({ atMs: p.atMs, value: p.value }));
  const gain = recentGain(readings);
  const firstCoin = firstCoinAfter(post.postedAt, data.coins.map((c) => c.launchedAt));
  const plan = useMemo(
    () => chartPlan(data.views, post.postedAt.known ? post.postedAt.at : null, { found: data.foundAt.known ? data.foundAt.at : null, coin: firstCoin }),
    [data, firstCoin, post.postedAt],
  );
  const found = foundTag(post.postedAt, data.foundAt);
  const coinAt = coinTag(post.postedAt, firstCoin);
  const media = data.media !== null && !mediaGone ? data.media : null;
  const handle = post.authorLabel;
  /* With no name stored, the handle is the name, said once. */
  const name = data.author.name ?? handle;
  const age = formatAge(post.postedAt, now);

  const proven = data.coins.find((c) => c.proven) ?? null;
  const main = proven ?? data.coins[0] ?? null;
  const matched = post.coins.kind === 'matched';
  const why = proven !== null ? provenWhy(post.coins, evidenceFacts) : null;

  return (
    <>
      <SheetHead>
        <span className={styles['avatar']}>
          <Avatar url={data.author.pictureUrl} letter={name.replace(/^@/, '')} />
          {platform !== null ? <PlatformBadge platform={platform} label={post.sourceLabel} /> : null}
        </span>
        <span className={styles['whoText']}>
          <b className={styles['name']}>{name}</b>
          <span className={styles['byline']}>
            {data.author.name !== null && handle.startsWith('@') ? <span>{handle}</span> : null}
            {data.author.followers.known ? <span>{followersText(data.author.followers.amount)}</span> : null}
            {age.kind === 'value' ? <span>{age.text}</span> : null}
          </span>
        </span>
        {/* Watch this post (the owner, 2026-10-14): its coin, when one launches or is found, is pushed within seconds. */}
        <WatchStar postId={post.id} size="sheet" />
        {post.permalink !== null ? (
          <a className={styles['open']} href={post.permalink} target="_blank" rel="noopener noreferrer" aria-label={`Open the post on ${post.sourceLabel}`}>
            <OpenIcon size={18} />
          </a>
        ) : null}
      </SheetHead>

      <SheetBody>
        <div className={styles['scroll']}>
          {post.excerpt !== '' || media !== null ? (
            <section className={styles['postCard']}>
              {post.excerpt !== '' ? <PostText text={post.excerpt} lines={media !== null ? TEXT_LINES.withMedia : TEXT_LINES.alone} /> : null}
              {media !== null ? <PostMedia media={media} height={mediaHeight(media.width, media.height)} onGone={() => setMediaGone(true)} postUrl={post.permalink} sourceLabel={post.sourceLabel} tiktokId={platform === 'tiktok' ? tiktokVideoId(post.id) : null} /> : null}
            </section>
          ) : null}

          <section className={styles['views']}>
            <div className={styles['viewsLeft']}>
              <span className={styles['label']}>Views</span>
              <span className={styles['viewsLine']}>
                <Value r={formatCount(post.reach)} className={styles['bigNumber']} />
                {gainText(gain) !== null && gain !== null ? <span className={gain.gain >= 0 ? styles['up'] : styles['down']}>{gainText(gain)} {gain.minutes}m</span> : null}
              </span>
            </div>
            <span className={styles['tags']}>
              {found !== null ? <span className={styles['tagFound']}>{found}</span> : null}
              {coinAt !== null ? <span className={styles['tag']}>{coinAt}</span> : null}
            </span>
          </section>

          {plan !== null ? <ReachChart plan={plan} now={now} height={CHART_HEIGHT} /> : null}

          <Tiles data={data} onNarrative={onNarrative} />
        </div>
      </SheetBody>

      <SheetFoot>
        <section className={styles['coinArea']}>
          {main !== null ? (
            <>
              <div className={styles['coinHead']}>
                {proven !== null ? (
                  <>
                    <span>{matched ? 'Coin made from this post' : "This narrative's coin"}</span>
                    <span className={styles['upText']}>{why?.split(', ')[0]}</span>
                  </>
                ) : (
                  <>
                    <span>{topLine(main, data.coinName)}</span>
                    <span>Not proven from this post</span>
                  </>
                )}
              </div>
              <CoinLine coin={main} now={now} onOpen={() => onOpenCoin(main)} action={
                <button type="button" className={styles['buy']} onClick={(e) => {
                  e.stopPropagation();
                  onBuy(main);
                }}>Buy</button>
              } />
            </>
          ) : (
            <div className={styles['coinHead']}><span>No coin with this name yet</span></div>
          )}
          <div className={styles['pair']}>
            <button type="button" className={styles['dark']} onClick={onCreate}>Create</button>
            {data.coins.length > 0 ? (
              <button type="button" className={styles['dark']} onClick={onAll}>
                <span className={styles['stack']}>
                  {data.coins.slice(0, 3).map((c) => (
                    <span key={c.address} className={styles['stackItem']}><CoinLogo address={c.address} ticker={c.ticker ?? c.name} imageUrl={c.imageUrl} size={26} /></span>
                  ))}
                </span>
                {data.coins.length === 1 ? 'All 1 coin' : `All ${data.coins.length} coins`}
              </button>
            ) : null}
          </div>
        </section>
      </SheetFoot>
    </>
  );
}

/** Narrative, views a minute, $tickers in replies: each only when we have it. */
function Tiles({ data, onNarrative }: { data: PostSheetData; onNarrative: (storyId: string) => void }) {
  const n = data.narrative;
  const tiles = [
    n !== null && n.title !== null ? (
      <button key="n" type="button" className={`${styles['tile']} ${styles['tileLink']}`} onClick={() => onNarrative(n.storyId)}>
        <span className={styles['label']}>Narrative</span>
        <span className={styles['tileValue']}><span className={styles['clip']}>{n.title}</span><ChevronIcon size={14} /></span>
      </button>
    ) : null,
    data.perMinute.known ? (
      <div key="m" className={styles['tile']}>
        <span className={styles['label']}>Per minute</span>
        <span className={styles['tileValue']}>{compact(data.perMinute.amount)}</span>
      </div>
    ) : null,
    data.tickersInReplies.known ? (
      <div key="r" className={styles['tile']}>
        <span className={styles['label']}>$ in replies</span>
        <span className={styles['tileValue']}>{compact(data.tickersInReplies.amount)}</span>
      </div>
    ) : null,
  ].filter((t) => t !== null);
  if (tiles.length === 0) return null;
  return <section className={styles['tiles']}>{tiles}</section>;
}

/** "Top Goliath coin by MC" when the top coin carries the shared name; otherwise without a name, never another coin's. */
function topLine(main: SheetCoin, shared: string | null): string {
  const same = (v: string | null) => v !== null && shared !== null && v.toLowerCase() === shared.toLowerCase();
  return shared !== null && (same(main.name) || same(main.ticker)) ? `Top ${shared} coin by MC` : 'Top coin by MC';
}

/** The poster's picture, or the first letter of their name when there is none or it will not load. */
function Avatar({ url, letter }: { url: string | null; letter: string }) {
  const [failed, setFailed] = useState(false);
  if (url !== null && !failed) return <img className={styles['avatarImg']} src={url} alt="" onError={() => setFailed(true)} />;
  return <span className={styles['avatarLetter']} aria-hidden="true">{(letter.trim()[0] ?? '?').toUpperCase()}</span>;
}
